// Una sala de multijugador = un Durable Object.
//
// El DO es el ÁRBITRO: tiene el GameState de verdad, valida quién manda cada
// acción (room-logic.ts) y difunde el flujo autoritativo. Los clientes no
// deciden nada; reproducen.
//
// Notas de plataforma que condicionan el diseño:
//
//  - WEBSOCKET HIBERNATION (`acceptWebSocket`, no `server.accept()`): una sala
//    parada no factura duración y sobrevive a que el objeto se descargue. A
//    cambio, NADA que viva solo en memoria es fiable entre mensajes: todo el
//    estado se lee y se escribe en `storage`.
//  - UNA SOLA ALARMA por objeto. Sirve a la vez de plazo de decisión y de
//    caducidad de la sala, así que se recalcula entera tras cada evento.

import { DurableObject } from 'cloudflare:workers'
import type { Env } from './index'
import {
  authorize, nextStep, waitingOn, timeoutAction,
  pendingReady, canAdvance, nextAlarm, type ReadySeat,
} from './room-logic'
import { checkHostTicket } from './ticket'
import type { Action } from '../src/core/actions'
import type { Seat } from '../src/core/seat'
import { SEATS } from '../src/core/seat'
import { reduce } from '../src/core/reducer'
import { newGame, advanceGame, type GameState } from '../src/core/game'
import { newLog, replay, type GameLog } from '../src/core/replay'
import { DEFAULT_RULES, type RuleSet } from '../src/core/rules-config'
import { makePolicy, type BotPolicy } from '../src/ai/bot'
import { makeBotRngs } from '../src/ai/bot-seats'
import { CHARACTER_IDS, CHARACTER_STYLES, isCharacterId, type CharacterId } from '../src/ai/roster'
import { skillFor, type Difficulty } from '../src/ai/profiles'
import type { Rng } from '../src/core/rng'
import {
  DEADLINE, LIMITS, ROOM_TTL,
  type ClientMessage, type ErrorCode, type PlayerView, type ServerMessage,
} from '../src/net/protocol'

interface SeatSlot {
  /** Identidad del jugador; es lo que permite recuperar el asiento al reconectar. */
  token: string
  name: string
  characterId: CharacterId | null
  /** Asiento de relleno: nunca hubo humano. */
  bot: boolean
  /**
   * Humano dado por ABANDONADO tras fallar varios plazos seguidos: a partir de
   * ahí la IA juega por él a toda velocidad, como un bot más.
   *
   * No se activa al primer plazo fallido a propósito. Si lo hiciera, una
   * desconexión de treinta segundos se comería varias manos de golpe (el
   * servidor no tiene pausas: las pone el cliente), y el jugador volvería a una
   * partida irreconocible. Hasta `ABANDON_AFTER`, cada plazo vencido solo le
   * cuesta ESA decisión.
   */
  absent: boolean
  /** Plazos seguidos sin contestar. Se pone a cero al jugar o al reconectar. */
  misses: number
}

/** Plazos fallidos seguidos antes de dar el asiento por abandonado. */
const ABANDON_AFTER = 3

interface RoomData {
  v: 1
  phase: 'lobby' | 'playing' | 'done'
  code: string
  hostToken: string
  seats: (SeatSlot | null)[]
  rules: RuleSet
  difficulty: Difficulty
  botSeed: number
  log: GameLog | null
  /** Vencimiento del plazo de decisión en curso (epoch ms), o 0. */
  deadlineAt: number
  /**
   * Fin de mano: mientras sea >0 el árbitro NO reparte la siguiente, está
   * esperando a que todos cierren la pantalla de resultados. Es el vencimiento
   * del plazo de gracia (epoch ms) tras el cual reparte igualmente.
   */
  readyAt: number
  /** Quién ya confirmó estar listo para la mano siguiente. */
  ready: boolean[]
  /** Caducidad de la sala (epoch ms). */
  expiresAt: number
}

/** Lo que cada socket lleva pegado; sobrevive a la hibernación. */
interface SocketMeta {
  seat: Seat
  token: string
}

const STORAGE_KEY = 'room'

export class GameRoom extends DurableObject<Env> {
  // Caché de proceso. NO es la fuente de verdad (la hibernación se la lleva por
  // delante): solo evita releer storage varias veces dentro del mismo mensaje.
  #data: RoomData | null = null
  #game: GameState | null = null

  // --- entrada ------------------------------------------------------------------

  override async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url)
    const code = url.searchParams.get('code') ?? ''
    const ticket = url.searchParams.get('ticket')

    let data = await this.#load()
    if (!data) {
      // Sala aún inexistente: solo se puede CREAR con un ticket de anfitrión
      // válido, que es lo que prueba que se pasó por Turnstile. Sin él no se
      // escribe nada y el objeto se queda como estaba (vacío).
      const secret = this.env.TURNSTILE_SECRET
      if (!ticket || !secret || !(await checkHostTicket(secret, code, ticket))) {
        return errorResponse(ticket ? 'bad_ticket' : 'no_room', 403)
      }
      data = this.#blank(code)
      await this.#save(data)
    }

    const pair = new WebSocketPair()
    const [client, server] = [pair[0], pair[1]]
    // Hibernación: la acepta el runtime, no nosotros.
    this.ctx.acceptWebSocket(server)
    await this.#armAlarm(data)
    return new Response(null, { status: 101, webSocket: client })
  }

  // --- mensajes -----------------------------------------------------------------

  override async webSocketMessage(ws: WebSocket, raw: string | ArrayBuffer): Promise<void> {
    if (typeof raw !== 'string' || raw.length > LIMITS.messageBytes) {
      return this.#kick(ws, 'bad_message')
    }
    if (this.#flooding(ws)) return this.#kick(ws, 'flood')

    let msg: ClientMessage
    try {
      msg = JSON.parse(raw) as ClientMessage
    } catch {
      return this.#kick(ws, 'bad_message')
    }

    const data = await this.#load()
    if (!data) return this.#kick(ws, 'no_room')

    switch (msg.t) {
      case 'join': return this.#onJoin(ws, data, msg)
      case 'pick': return this.#onPick(ws, data, msg)
      case 'start': return this.#onStart(ws, data, msg)
      case 'intent': return this.#onIntent(ws, data, msg)
      case 'ready': return this.#onReady(ws, data)
      default: return this.#kick(ws, 'bad_message')
    }
  }

  override async webSocketClose(_ws: WebSocket): Promise<void> {
    const data = await this.#load()
    if (!data) return
    // El asiento NO se libera: sigue siendo suyo hasta que caduque la sala. Lo
    // que cambia es que a partir de ahora cuenta como desconectado, y el plazo
    // de decisión lo relevará el árbitro.
    this.#broadcastLobbyIfWaiting(data)
    // Si se fue justo mientras se le esperaba al final de una mano, ya no se le
    // espera: se reevalúa para que su marcha no congele la mesa hasta agotar la
    // gracia entera.
    if (data.phase === 'playing' && data.readyAt > 0) {
      await this.#pump(data)
      return
    }
    await this.#armAlarm(data)
  }

  // --- lobby --------------------------------------------------------------------

  async #onJoin(ws: WebSocket, data: RoomData, msg: { name?: string; token?: string }): Promise<void> {
    const token = typeof msg.token === 'string' && msg.token.length > 0 ? msg.token : null
    const name = typeof msg.name === 'string' ? msg.name.slice(0, 24) : ''

    // ¿reconexión? El token manda: recupera SU asiento, esté la sala donde esté.
    const found = token === null ? -1 : data.seats.findIndex((s) => s?.token === token)
    let seat: Seat

    if (found < 0) {
      if (data.phase !== 'lobby') return this.#kick(ws, 'already_started')
      const free = data.seats.findIndex((s) => s === null)
      if (free < 0) return this.#kick(ws, 'room_full')
      if (token === null) return this.#kick(ws, 'bad_message')
      seat = free as Seat
      data.seats[seat] = { token, name, characterId: null, bot: false, absent: false, misses: 0 }
      // el primero que entra es el anfitrión
      if (data.hostToken === '') data.hostToken = token
    } else {
      seat = found as Seat
      // vuelve: deja de estar ausente y el árbitro le devuelve el mando
      data.seats[seat]!.absent = false
      data.seats[seat]!.misses = 0
      if (name) data.seats[seat]!.name = name
    }

    ws.serializeAttachment({ seat, token: data.seats[seat]!.token } satisfies SocketMeta)
    await this.#save(data)

    if (data.phase === 'lobby') {
      this.#broadcastLobby(data)
      await this.#armAlarm(data)
    } else {
      // partida en marcha: se le manda todo lo jugado y reproduce sin pedir nada
      this.#sendStart(ws, data, seat)
      // Y se vuelve a mover el bucle: acaba de dejar de ser automático, así que
      // hay que rearmarle el plazo. Sin esto, quien reconectaba se quedaba
      // mirando el tablero sin reloj y sin que nadie le pidiera jugar.
      await this.#pump(data)
    }
  }

  async #onPick(ws: WebSocket, data: RoomData, msg: { characterId?: unknown }): Promise<void> {
    const meta = this.#metaOf(ws)
    if (!meta || data.phase !== 'lobby') return this.#kick(ws, 'already_started')
    if (!isCharacterId(msg.characterId)) return this.#kick(ws, 'bad_message')
    // La unicidad se valida AQUÍ, no solo en la UI: dos jugadores no pueden
    // llevar el mismo personaje (el roster es asiento→personaje, y retratos y
    // voces van por personaje).
    const taken = data.seats.some((s, i) => i !== meta.seat && s?.characterId === msg.characterId)
    if (taken) return this.#send(ws, { t: 'error', code: 'character_taken' })

    data.seats[meta.seat]!.characterId = msg.characterId
    await this.#save(data)
    this.#broadcastLobby(data)
  }

  async #onStart(
    ws: WebSocket,
    data: RoomData,
    msg: { rules?: RuleSet; difficulty?: Difficulty },
  ): Promise<void> {
    const meta = this.#metaOf(ws)
    if (!meta) return this.#kick(ws, 'bad_message')
    if (data.phase !== 'lobby') return this.#send(ws, { t: 'error', code: 'already_started' })
    if (meta.token !== data.hostToken) return this.#send(ws, { t: 'error', code: 'not_host' })

    // Los asientos vacíos se rellenan con bots, con un personaje libre al azar.
    const used = new Set(data.seats.map((s) => s?.characterId).filter(Boolean) as CharacterId[])
    for (const seat of SEATS) {
      const slot = data.seats[seat]
      if (slot && slot.characterId) continue
      const free = CHARACTER_IDS.filter((id) => !used.has(id))
      const pick = free[Math.floor(Math.random() * free.length)]!
      used.add(pick)
      if (slot) slot.characterId = pick
      else {
        data.seats[seat] =
          { token: '', name: '', characterId: pick, bot: true, absent: false, misses: 0 }
      }
    }

    data.rules = sanitizeRules(msg.rules)
    data.difficulty = sanitizeDifficulty(msg.difficulty)
    data.botSeed = randomU32()
    // Semilla de partida de un CSPRNG, no del reloj: quien la conoce conoce el
    // muro entero, así que no puede ser adivinable desde fuera.
    data.log = newLog(randomU32(), data.rules)
    data.phase = 'playing'
    this.#game = newGame(data.log.seed, {}, data.rules)

    await this.#save(data)
    for (const sock of this.ctx.getWebSockets()) {
      const m = this.#metaOf(sock)
      if (m) this.#sendStart(sock, data, m.seat)
    }
    await this.#pump(data)
  }

  // --- partida ------------------------------------------------------------------

  async #onIntent(
    ws: WebSocket,
    data: RoomData,
    msg: { seq?: unknown; action?: unknown },
  ): Promise<void> {
    const meta = this.#metaOf(ws)
    if (!meta || data.phase !== 'playing' || !data.log) return
    const game = this.#state(data)
    if (game.finished) return

    // Guarda de orden: el cliente dice cuántas acciones había visto. Si no
    // cuadra, actuó sobre un estado viejo (doble clic, carrera con una jugada
    // ajena) y su intención se tira sin más.
    if (msg.seq !== countActions(data.log)) return
    const action = msg.action as Action
    if (!action || typeof action !== 'object' || typeof action.type !== 'string') return

    // LA comprobación anti-trampas.
    if (!authorize(game.hand, meta.seat, action)) return

    if (!this.#apply(data, action)) return
    // Ha jugado: está claramente ahí, así que recupera el mando y se le borra
    // la cuenta de plazos fallidos.
    const slot = data.seats[meta.seat]
    if (slot) {
      slot.absent = false
      slot.misses = 0
    }
    await this.#pump(data)
  }

  /**
   * "He cerrado la pantalla de resultados". Solo cuenta mientras se esté
   * esperando de verdad (`readyAt > 0`): fuera de ese momento es ruido, y
   * apuntarlo antes de tiempo dejaría a ese asiento listo para la mano
   * SIGUIENTE sin haberla visto.
   */
  async #onReady(ws: WebSocket, data: RoomData): Promise<void> {
    const meta = this.#metaOf(ws)
    if (!meta || data.phase !== 'playing' || data.readyAt === 0) return
    if (data.ready[meta.seat]) return
    data.ready[meta.seat] = true
    // Confirmar prueba que está delante: se le devuelve el mando si estaba dado
    // por ausente, igual que al jugar.
    const slot = data.seats[meta.seat]
    if (slot) {
      slot.absent = false
      slot.misses = 0
    }
    await this.#pump(data)
  }

  /**
   * Aplica una acción al estado autoritativo y la difunde. Devuelve false si el
   * núcleo la rechaza: `reduce` lanza ante cualquier jugada ilegal, y ese es el
   * validador de reglas del árbitro (no hay uno propio que pueda desincronizarse).
   */
  #apply(data: RoomData, action: Action): boolean {
    const game = this.#state(data)
    let next: GameState
    try {
      next = { ...game, hand: reduce(game.hand, action) }
    } catch {
      return false
    }
    this.#game = next
    data.log!.hands[data.log!.hands.length - 1]!.push(action)
    this.#broadcast({ t: 'action', seq: countActions(data.log!), action })
    return true
  }

  /**
   * Bucle autoritativo: avanza todo lo que pueda avanzar sin humanos y se para
   * cuando toca esperar a alguien. Sin pausas — el ritmo lo pone el cliente.
   */
  async #pump(data: RoomData): Promise<void> {
    const auto = this.#autoSeats(data)
    const policyOf = this.#policies(data)
    const rngs = makeBotRngs(data.botSeed)
    const rngOf = (seat: Seat): Rng => rngs[seat]

    // El plazo de decisión se recalcula ENTERO en cada pasada: solo lo fija la
    // rama 'await', abajo. Arrastrar el de la pasada anterior colgaba la sala —
    // al abrirse la espera de fin de mano quedaba un `deadlineAt` ya vencido,
    // `#armAlarm` cogía ese instante pasado como el más próximo, y la alarma se
    // disparaba en bucle sin nadie a quien jugarle.
    data.deadlineAt = 0

    // Cota dura: una mano son ~70 acciones; 3000 es el mismo guardarraíl que
    // usa ai/sim.ts. Si se dispara, algo está mal y es mejor cortar que colgar
    // el objeto en un bucle infinito.
    for (let guard = 0; guard < 3000; guard++) {
      const step = nextStep(this.#state(data), auto, policyOf, rngOf)

      if (step.kind === 'finished') {
        data.phase = 'done'
        break
      }
      if (step.kind === 'await') {
        data.deadlineAt = Date.now() + deadlineFor(this.#state(data))
        this.#broadcastDeadline(data)
        break
      }
      if (step.kind === 'advance') {
        // NO se reparte en cuanto acaba la mano: primero hay que dejar que
        // todos cierren la pantalla de resultados. Antes se repartía aquí
        // mismo, y quien se entretuviera leyéndola perdía turnos sin verlos
        // pasar — su reloj de decisión ya corría por detrás.
        if (!this.#canAdvance(data)) {
          if (data.readyAt === 0) {
            data.readyAt = Date.now() + DEADLINE.handEnd
            data.ready = [false, false, false, false]
          }
          this.#broadcastHandEnd(data)
          break
        }
        data.readyAt = 0
        data.ready = [false, false, false, false]
        const advanced = advanceGame(this.#state(data))
        this.#game = advanced
        if (advanced.finished) {
          data.phase = 'done'
          break
        }
        data.log!.hands.push([]) // la mano siguiente abre su tramo del log
        continue
      }
      if (!this.#apply(data, step.action)) break // no debería pasar: lo generó el árbitro
    }

    if (data.phase !== 'playing') {
      data.deadlineAt = 0
      data.readyAt = 0 // partida acabada: ya no se espera a nadie
    }
    await this.#save(data)
    await this.#armAlarm(data)
  }

  // --- alarma: plazos y caducidad ---------------------------------------------------

  override async alarm(): Promise<void> {
    const data = await this.#load()
    if (!data) return
    const now = Date.now()

    if (data.expiresAt <= now) return this.#destroy()

    // Se acabó la gracia de fin de mano: se reparte sin esperar a quien falte.
    if (data.phase === 'playing' && data.readyAt > 0 && data.readyAt <= now) {
      await this.#pump(data)
      return
    }

    if (data.phase === 'playing' && data.deadlineAt > 0 && data.deadlineAt <= now) {
      // `waitingOn` vacío = no hay a quién jugarle (p. ej. la mano ya acabó):
      // se deja que #pump recalcule en vez de girar sobre un plazo muerto.
      if (waitingOn(this.#state(data), this.#autoSeats(data)).length === 0) {
        await this.#pump(data)
        return
      }
      const policyOf = this.#policies(data)
      const rngs = makeBotRngs(data.botSeed)
      // A quien se esperaba y no contestó se le juega ESA decisión y nada más.
      // Solo tras varios plazos seguidos se le da por abandonado (ver
      // ABANDON_AFTER): así una desconexión corta cuesta un descarte, no la
      // partida entera.
      for (const seat of waitingOn(this.#state(data), this.#autoSeats(data))) {
        const slot = data.seats[seat]
        if (slot) {
          slot.misses++
          if (slot.misses >= ABANDON_AFTER) slot.absent = true
        }
        const hand = this.#state(data).hand
        // En una reacción se PASA, y no se deja que la IA cante por él: pasar
        // nunca perjudica a quien no estaba, pero un ron o un pon sorpresa sí le
        // cambiarían la partida sin su permiso.
        const forced = timeoutAction(hand, seat) ?? policyOf(seat).turn(hand, rngs[seat])
        this.#apply(data, forced)
      }
      await this.#pump(data)
      return
    }

    await this.#armAlarm(data)
  }

  /**
   * Una sola alarma para dos cosas: el plazo de decisión y la caducidad de la
   * sala. Se recalcula entera tras cada evento y se arma la más próxima.
   */
  async #armAlarm(data: RoomData): Promise<void> {
    const connected = this.#connectedSeats().size
    const players = data.seats.filter((s) => s && !s.bot).length
    // Una sala en lobby a la que no llega nadie se recoge enseguida: es lo que
    // hace que "crear salas y largarse" no acumule nada.
    const ttl = data.phase === 'lobby' && players < 2 ? ROOM_TTL.empty : ROOM_TTL.idle
    data.expiresAt = Date.now() + (connected > 0 ? ttl : ROOM_TTL.empty)

    await this.#save(data)
    await this.ctx.storage.setAlarm(
      nextAlarm(data.deadlineAt, data.readyAt, data.expiresAt, DEADLINE.grace),
    )
  }

  /** Fin de la sala: sin storage y sin alarma, el objeto deja de existir. */
  async #destroy(): Promise<void> {
    for (const ws of this.ctx.getWebSockets()) {
      try { ws.close(1000, 'room_expired') } catch { /* ya cerrado */ }
    }
    await this.ctx.storage.deleteAlarm()
    await this.ctx.storage.deleteAll()
    this.#data = null
    this.#game = null
  }

  // --- utilidades ---------------------------------------------------------------

  #blank(code: string): RoomData {
    return {
      v: 1,
      phase: 'lobby',
      code,
      hostToken: '',
      seats: [null, null, null, null],
      rules: DEFAULT_RULES,
      difficulty: 'normal',
      botSeed: 0,
      log: null,
      deadlineAt: 0,
      readyAt: 0,
      ready: [false, false, false, false],
      expiresAt: Date.now() + ROOM_TTL.empty,
    }
  }

  async #load(): Promise<RoomData | null> {
    if (this.#data) return this.#data
    const d = await this.ctx.storage.get<RoomData>(STORAGE_KEY)
    if (!d || d.v !== 1) return null
    this.#data = d
    return d
  }

  async #save(data: RoomData): Promise<void> {
    this.#data = data
    await this.ctx.storage.put(STORAGE_KEY, data)
  }

  /**
   * Estado autoritativo. Tras una hibernación no queda nada en memoria, así que
   * se reconstruye del log — que es exactamente lo que hace el guardado local
   * (ui/persist.ts). El determinismo del núcleo se cobra aquí otra vez.
   */
  #state(data: RoomData): GameState {
    if (this.#game) return this.#game
    this.#game = data.log ? replay(data.log) : newGame(0, {}, data.rules)
    return this.#game
  }

  /** Asientos que mueve el árbitro: bots de relleno y humanos ausentes. */
  /** Traduce los asientos de la sala a lo que necesita `room-logic`. */
  #readySeats(data: RoomData): ReadySeat[] {
    const connected = this.#connectedSeats()
    return SEATS.map((seat) => {
      const slot = data.seats[seat]
      return {
        human: slot !== null && slot !== undefined && !slot.bot && !slot.absent,
        connected: connected.has(seat),
        ready: data.ready[seat] === true,
      }
    })
  }

  #pendingReady(data: RoomData): Seat[] {
    return pendingReady(this.#readySeats(data))
  }

  #canAdvance(data: RoomData): boolean {
    return canAdvance(this.#readySeats(data), data.readyAt, Date.now())
  }

  #autoSeats(data: RoomData): Set<Seat> {
    const out = new Set<Seat>()
    for (const seat of SEATS) {
      const slot = data.seats[seat]
      if (!slot || slot.bot || slot.absent) out.add(seat)
    }
    return out
  }

  #policies(data: RoomData): (seat: Seat) => BotPolicy {
    const skill = skillFor(data.difficulty)
    const cache = new Map<Seat, BotPolicy>()
    return (seat) => {
      let p = cache.get(seat)
      if (!p) {
        const id = data.seats[seat]?.characterId ?? 'alice'
        p = makePolicy({ style: CHARACTER_STYLES[id], skill })
        cache.set(seat, p)
      }
      return p
    }
  }

  #metaOf(ws: WebSocket): SocketMeta | null {
    const a = ws.deserializeAttachment() as SocketMeta | null
    return a && typeof a.seat === 'number' ? a : null
  }

  #connectedSeats(): Set<Seat> {
    const out = new Set<Seat>()
    for (const ws of this.ctx.getWebSockets()) {
      const m = this.#metaOf(ws)
      if (m) out.add(m.seat)
    }
    return out
  }

  /** Ventana deslizante de un segundo por socket, contra la inundación. */
  #flooding(ws: WebSocket): boolean {
    const now = Date.now()
    const a = this.#metaOf(ws) as (SocketMeta & { win?: number; n?: number }) | null
    if (!a) return false
    if (a.win === undefined || now - a.win > 1000) {
      a.win = now
      a.n = 1
    } else {
      a.n = (a.n ?? 0) + 1
    }
    ws.serializeAttachment(a)
    return (a.n ?? 0) > LIMITS.messagesPerSecond
  }

  #send(ws: WebSocket, msg: ServerMessage): void {
    try { ws.send(JSON.stringify(msg)) } catch { /* socket muerto */ }
  }

  #broadcast(msg: ServerMessage): void {
    const raw = JSON.stringify(msg)
    for (const ws of this.ctx.getWebSockets()) {
      try { ws.send(raw) } catch { /* socket muerto */ }
    }
  }

  #kick(ws: WebSocket, code: ErrorCode): void {
    this.#send(ws, { t: 'error', code })
    try { ws.close(1008, code) } catch { /* ya cerrado */ }
  }

  #sendStart(ws: WebSocket, data: RoomData, seat: Seat): void {
    if (!data.log) return
    this.#send(ws, {
      t: 'start',
      you: seat,
      seed: data.log.seed,
      botSeed: data.botSeed,
      rules: data.rules,
      difficulty: data.difficulty,
      roster: data.seats.map((s) => s?.characterId ?? 'alice'),
      // null = asiento de la IA. Un humano sin nombre escrito también cuenta
      // como sin nombre: la UI enseñará solo su personaje.
      players: data.seats.map((s) => (s && !s.bot && s.name ? s.name : null)),
      log: data.log,
      seq: countActions(data.log),
    })
  }

  #broadcastLobby(data: RoomData): void {
    const connected = this.#connectedSeats()
    const auto = this.#autoSeats(data)
    const view = (s: SeatSlot | null, i: number): PlayerView | null =>
      s === null ? null : {
        name: s.name,
        characterId: s.characterId,
        connected: connected.has(i as Seat),
        auto: auto.has(i as Seat),
      }
    const taken = data.seats.map((s) => s?.characterId).filter(Boolean) as CharacterId[]
    for (const ws of this.ctx.getWebSockets()) {
      const m = this.#metaOf(ws)
      if (!m) continue
      this.#send(ws, {
        t: 'lobby',
        code: data.code,
        you: m.seat,
        host: m.token === data.hostToken,
        seats: data.seats.map(view),
        taken,
      })
    }
  }

  #broadcastLobbyIfWaiting(data: RoomData): void {
    if (data.phase === 'lobby') this.#broadcastLobby(data)
  }

  #broadcastDeadline(data: RoomData): void {
    if (data.deadlineAt <= 0) return
    const seats = waitingOn(this.#state(data), this.#autoSeats(data))
    // Se manda lo que QUEDA, no el vencimiento: así el desfase entre el reloj
    // del servidor y el del cliente no falsea la cuenta atrás.
    const ms = Math.max(0, data.deadlineAt - Date.now())
    if (seats.length > 0) this.#broadcast({ t: 'deadline', seats, ms })
  }

  /** Fin de mano: a quién se espera y cuánto queda de la gracia. */
  #broadcastHandEnd(data: RoomData): void {
    if (data.readyAt <= 0) return
    this.#broadcast({
      t: 'handend',
      waiting: this.#pendingReady(data),
      ms: Math.max(0, data.readyAt - Date.now()),
    })
  }
}

// --- helpers de módulo ------------------------------------------------------------

function countActions(log: GameLog): number {
  let n = 0
  for (const hand of log.hands) n += hand.length
  return n
}

function deadlineFor(g: GameState): number {
  return g.hand.phase === 'reaction' ? DEADLINE.reaction : DEADLINE.turn
}

function randomU32(): number {
  const b = new Uint32Array(1)
  crypto.getRandomValues(b)
  return b[0]! >>> 0
}

function sanitizeDifficulty(d: unknown): Difficulty {
  return d === 'easy' || d === 'hard' ? d : 'normal'
}

/**
 * El reglamento llega del anfitrión, o sea de un cliente: se valida campo a
 * campo contra DEFAULT_RULES y se descarta cualquier cosa rara, en lugar de
 * confiar en la forma del JSON.
 */
function sanitizeRules(r: unknown): RuleSet {
  if (!r || typeof r !== 'object') return DEFAULT_RULES
  const raw = r as Record<string, unknown>
  const bool = (k: keyof RuleSet): boolean =>
    typeof raw[k] === 'boolean' ? (raw[k] as boolean) : (DEFAULT_RULES[k] as boolean)
  const int = (k: keyof RuleSet): number =>
    Number.isFinite(raw[k]) ? Math.trunc(raw[k] as number) : (DEFAULT_RULES[k] as number)
  return {
    ...DEFAULT_RULES,
    length: raw['length'] === 'hanchan' ? 'hanchan' : 'tonpuusen',
    agariYame: bool('agariYame'),
    tobi: bool('tobi'),
    aka: bool('aka'),
    kuitan: bool('kuitan'),
    nagashiMangan: bool('nagashiMangan'),
    startPoints: int('startPoints'),
    returnPoints: int('returnPoints'),
    uma: umaOf(raw['uma']),
  }
}

function umaOf(v: unknown): RuleSet['uma'] {
  if (!Array.isArray(v) || v.length !== 4) return DEFAULT_RULES.uma
  const n = (i: number): number => (Number.isFinite(v[i]) ? Math.trunc(v[i] as number) : 0)
  return [n(0), n(1), n(2), n(3)]
}

function errorResponse(code: ErrorCode, status: number): Response {
  return new Response(JSON.stringify({ error: code }), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  })
}

