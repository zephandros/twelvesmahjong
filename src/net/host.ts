// El árbitro: corre en el cliente del ANFITRIÓN.
//
// No hay servidor de juego. Quien crea la sala (una cuenta de Kovalt en la
// lista blanca) es quien tiene el GameState de verdad, valida quién manda cada
// acción (room-logic.ts) y escribe el log autoritativo en el almacén; los
// demás clientes —y el suyo propio— lo reproducen (client.ts). Es el mismo
// bucle que tenía el Durable Object, con dos cambios de plataforma:
//
//  - los plazos son timers normales (no hay "una sola alarma");
//  - nada se difunde: se ESCRIBE en la sala y Firebase avisa a los demás.
//
// Las escrituras de una pasada del bucle se juntan en UN `update` atómico:
// cinco acciones seguidas (robo, descarte de un bot, tres pases) llegan a los
// clientes en orden y de golpe, y cada uno las aplica a su ritmo (DELAY).
//
// Si el anfitrión se desconecta, la mesa se para: nadie más tiene el mando.
// Al volver, `start()` reconstruye el estado del log y retoma el bucle.

import type { Action } from '../core/actions'
import type { Seat } from '../core/seat'
import { SEATS } from '../core/seat'
import { reduce } from '../core/reducer'
import { newGame, advanceGame, type GameState } from '../core/game'
import { newLog, replay, type GameLog } from '../core/replay'
import { DEFAULT_RULES, type RuleSet } from '../core/rules-config'
import type { Rng } from '../core/rng'
import { makePolicy, type BotPolicy } from '../ai/bot'
import { makeBotRngs } from '../ai/bot-seats'
import { CHARACTER_IDS, CHARACTER_STYLES, type CharacterId } from '../ai/roster'
import { skillFor, type Difficulty } from '../ai/profiles'
import {
  authorize, nextStep, waitingOn, timeoutAction, pendingReady, canAdvance, type ReadySeat,
} from './room-logic'
import {
  ABANDON_AFTER, DEADLINE, PATH, logKey, logFromEntries, countActions, seatsOf,
  type GameSetup, type Intent, type LogEntry, type Phase, type RoomMeta, type SeatSlot,
} from './protocol'
import type { RoomStore, Unsub } from './store'

export class RoomHost {
  private phase: Phase = 'lobby'
  private seats: (SeatSlot | null)[] = [null, null, null, null]
  private setup: GameSetup | null = null
  private log: GameLog | null = null
  private game: GameState | null = null
  private readonly misses: number[] = [0, 0, 0, 0]
  private readonly absent: boolean[] = [false, false, false, false]
  /** Última lista de ausentes escrita en la sala (`PATH.absent`), para no reescribirla igual. */
  private publishedAbsent: string | null = null
  private ready: boolean[] = [false, false, false, false]
  private online = new Set<string>()
  private deadlineAt = 0
  private readyAt = 0
  private deadlineTimer: ReturnType<typeof setTimeout> | null = null
  private readyTimer: ReturnType<typeof setTimeout> | null = null
  private readonly unsubs: Unsub[] = []
  private pending: Record<string, unknown> = {}
  private stopped = false
  private busy: Promise<void> = Promise.resolve()
  private policies: Partial<Record<Seat, BotPolicy>> = {}
  private rngs: Record<Seat, Rng> | null = null

  constructor(
    private readonly store: RoomStore,
    private readonly uid: string,
  ) {}

  /**
   * Lee la sala y, si la partida está en marcha, retoma el bucle. Va por la
   * cola `serial` como todo lo demás: así `begin()` nunca adelanta al arranque.
   */
  start(): Promise<void> {
    return this.serial(async () => {
      const meta = await this.store.get<RoomMeta>(PATH.meta)
      if (!meta || meta.host !== this.uid) throw new Error('not_host')
      this.phase = meta.phase
      this.seats = seatsOf(await this.store.get(PATH.seats))

      this.unsubs.push(
        this.store.watch<Record<string, boolean>>(PATH.presence, (p) => this.onPresence(p)),
        this.store.watch(PATH.seats, (raw) => { this.seats = seatsOf(raw) }),
      )
      if (this.phase === 'playing') await this.resume()
    })
  }

  /** EMPEZAR: rellena los asientos vacíos con bots y reparte. */
  begin(rules: RuleSet, difficulty: Difficulty): Promise<void> {
    return this.serial(async () => {
      if (this.phase !== 'lobby') return
      this.seats = seatsOf(await this.store.get(PATH.seats))
      const used = new Set(this.seats.map((s) => s?.characterId).filter(Boolean) as CharacterId[])
      for (const seat of SEATS) {
        const slot = this.seats[seat]
        if (slot && slot.characterId) continue
        const free = CHARACTER_IDS.filter((id) => !used.has(id))
        const pick = free[Math.floor(Math.random() * free.length)]!
        used.add(pick)
        if (slot) slot.characterId = pick
        else this.seats[seat] = { uid: '', name: '', characterId: pick, bot: true }
      }
      // Semilla de partida de un CSPRNG, no del reloj: quien la conoce conoce
      // el muro entero, así que no puede ser adivinable desde fuera.
      this.setup = {
        seed: randomU32(),
        botSeed: randomU32(),
        rules: sanitizeRules(rules),
        difficulty: sanitizeDifficulty(difficulty),
        roster: this.seats.map((s) => s?.characterId ?? 'alice'),
        // null = asiento de la IA. Un humano sin nombre también cuenta como
        // sin nombre: la UI enseñará solo su personaje.
        players: this.seats.map((s) => (s && !s.bot && s.name ? s.name : null)),
      }
      this.log = newLog(this.setup.seed, this.setup.rules)
      this.game = newGame(this.setup.seed, {}, this.setup.rules)
      this.phase = 'playing'
      this.arm()
      this.pending[`${PATH.meta}/phase`] = 'playing'
      this.pending[PATH.game] = this.setup
      for (const seat of SEATS) this.pending[PATH.seat(seat)] = this.seats[seat]
      this.subscribePlay()
      await this.pump()
    })
  }

  stop(): void {
    this.stopped = true
    for (const u of this.unsubs) u()
    this.unsubs.length = 0
    this.clearTimers()
  }

  // --- reanudación --------------------------------------------------------------

  private async resume(): Promise<void> {
    const setup = await this.store.get<GameSetup>(PATH.game)
    if (!setup) throw new Error('no_game')
    this.setup = setup
    const raw = (await this.store.get<Record<string, LogEntry>>(PATH.log)) ?? {}
    const entries = Object.keys(raw).sort().map((k) => raw[k]!)
    this.log = logFromEntries(setup.seed, setup.rules, entries)
    this.game = replay(this.log)
    this.arm()
    this.subscribePlay()
    // Quien ya hubiera confirmado el fin de mano antes de caerse el anfitrión
    // sigue confirmado: el nodo `ready` sobrevive en la sala.
    const ready = (await this.store.get<Record<string, boolean>>(PATH.ready)) ?? {}
    for (const uid of Object.keys(ready)) {
      const seat = this.seatOf(uid)
      if (seat !== null) this.ready[seat] = true
    }
    if (this.game.hand.phase === 'ended' && !this.game.finished) {
      this.readyAt = Date.now() + DEADLINE.handEnd
    }
    await this.pump()
  }

  private arm(): void {
    const s = this.setup!
    const skill = skillFor(s.difficulty)
    this.policies = {}
    for (const seat of SEATS) {
      this.policies[seat] = makePolicy({ style: CHARACTER_STYLES[s.roster[seat] ?? 'alice'], skill })
    }
    this.rngs = makeBotRngs(s.botSeed)
  }

  private subscribePlay(): void {
    this.unsubs.push(
      this.store.watch<Record<string, Intent>>(PATH.intents, (all) => {
        if (all) void this.serial(() => this.onIntents(all))
      }),
      this.store.watch<Record<string, boolean>>(PATH.ready, (all) => {
        if (all) void this.serial(() => this.onReady(all))
      }),
    )
  }

  // --- entradas -------------------------------------------------------------------

  private async onIntents(all: Record<string, Intent>): Promise<void> {
    if (this.phase !== 'playing' || !this.game || !this.log) return
    let moved = false
    for (const [uid, intent] of Object.entries(all)) {
      this.pending[PATH.intent(uid)] = null
      const seat = this.seatOf(uid)
      if (seat === null || !intent || typeof intent !== 'object') continue
      // Escribir una intención, valga o no, demuestra que hay alguien: si se
      // le había dado por ausente, recupera el mando. El `resume` es solo eso:
      // una intención sin jugada, para volver sin esperar a que toque algo.
      this.misses[seat] = 0
      if (this.absent[seat]) {
        this.absent[seat] = false
        moved = true // hay que recalcular a quién se espera y publicar el relevo
      }
      const a = intent.a as Intent['a'] | null
      if (a !== null && typeof a === 'object' && a.type === 'resume') continue
      // Guarda de orden: el cliente dice cuántas acciones había visto. Si no
      // cuadra, actuó sobre un estado viejo (doble clic, carrera con una
      // jugada ajena) y su intención se tira. Se le avisa (`nack`) para que
      // desbloquee su input sin esperar a que llegue otra cosa.
      const ok =
        intent.seq === countActions(this.log) &&
        !this.game.finished &&
        a !== null && typeof a === 'object' && typeof a.type === 'string' &&
        authorize(this.game.hand, seat, a as Action) && // LA comprobación anti-trampas
        this.apply(a as Action)
      if (!ok) {
        this.pending[PATH.nack(uid)] = { seq: intent.seq, at: Date.now() }
        continue
      }
      moved = true
    }
    if (moved) await this.pump()
    else await this.flush()
  }

  /**
   * "He cerrado la pantalla de resultados". Solo cuenta mientras se esté
   * esperando de verdad (`readyAt > 0`): fuera de ese momento es ruido, y
   * apuntarlo antes de tiempo dejaría a ese asiento listo para la mano
   * SIGUIENTE sin haberla visto.
   */
  private async onReady(all: Record<string, boolean>): Promise<void> {
    if (this.phase !== 'playing' || this.readyAt === 0) return
    let changed = false
    for (const uid of Object.keys(all)) {
      const seat = this.seatOf(uid)
      if (seat === null || this.ready[seat]) continue
      this.ready[seat] = true
      this.misses[seat] = 0
      this.absent[seat] = false
      changed = true
    }
    if (changed) await this.pump()
  }

  private onPresence(p: Record<string, boolean> | null): void {
    const next = new Set(Object.keys(p ?? {}))
    const came: Seat[] = []
    for (const uid of next) {
      if (this.online.has(uid)) continue
      const seat = this.seatOf(uid)
      if (seat !== null && this.absent[seat]) came.push(seat)
    }
    const left = [...this.online].some((uid) => !next.has(uid))
    this.online = next
    if (this.phase !== 'playing') return
    // Quien vuelve deja de estar ausente y recupera el mando; y si alguien se
    // fue mientras se le esperaba al final de una mano, ya no se le espera.
    for (const seat of came) {
      this.absent[seat] = false
      this.misses[seat] = 0
    }
    if (came.length > 0 || (left && this.readyAt > 0)) void this.serial(() => this.pump())
  }

  // --- bucle autoritativo ------------------------------------------------------------

  private apply(action: Action): boolean {
    if (!this.game || !this.log) return false
    let next: GameState
    try {
      next = { ...this.game, hand: reduce(this.game.hand, action) }
    } catch {
      return false // `reduce` lanza ante cualquier jugada ilegal: ese es el validador
    }
    this.game = next
    const h = this.log.hands.length - 1
    const n = countActions(this.log)
    this.log.hands[h]!.push(action)
    this.pending[`${PATH.log}/${logKey(n)}`] = { h, a: action } satisfies LogEntry
    return true
  }

  /**
   * Avanza todo lo que pueda avanzar sin humanos y se para cuando toca esperar
   * a alguien. Sin pausas — el ritmo lo pone cada cliente.
   */
  private async pump(): Promise<void> {
    if (this.stopped || this.phase !== 'playing' || !this.game || !this.log) return
    const auto = this.autoSeats()
    const policyOf = (seat: Seat): BotPolicy => this.policies[seat]!
    const rngOf = (seat: Seat): Rng => this.rngs![seat]

    // El plazo se recalcula ENTERO en cada pasada: solo lo fija la rama 'await'.
    this.deadlineAt = 0
    let clock: unknown = null
    let handEnd: unknown = null

    for (let guard = 0; guard < 3000; guard++) {
      const step = nextStep(this.game, auto, policyOf, rngOf)
      if (step.kind === 'finished') {
        this.phase = 'done'
        break
      }
      if (step.kind === 'await') {
        this.deadlineAt = Date.now() + deadlineFor(this.game)
        clock = {
          seats: waitingOn(this.game, auto),
          ms: deadlineFor(this.game),
          at: this.store.serverTimestamp(),
        }
        break
      }
      if (step.kind === 'advance') {
        if (!canAdvance(this.readySeats(), this.readyAt, Date.now())) {
          if (this.readyAt === 0) {
            this.readyAt = Date.now() + DEADLINE.handEnd
            this.ready = [false, false, false, false]
          }
          handEnd = {
            waiting: pendingReady(this.readySeats()),
            ms: Math.max(0, this.readyAt - Date.now()),
            at: this.store.serverTimestamp(),
          }
          break
        }
        this.readyAt = 0
        this.ready = [false, false, false, false]
        this.pending[PATH.ready] = null
        this.game = advanceGame(this.game)
        if (this.game.finished) {
          this.phase = 'done'
          break
        }
        this.log.hands.push([]) // la mano siguiente abre su tramo del log
        continue
      }
      if (!this.apply(step.action)) break // no debería pasar: lo generó el árbitro
    }

    if (this.phase !== 'playing') {
      this.deadlineAt = 0
      this.readyAt = 0
      this.pending[`${PATH.meta}/phase`] = 'done'
      this.pending[PATH.ready] = null
    }
    this.pending[PATH.clock] = clock
    this.pending[PATH.handEnd] = handEnd
    await this.flush()
    this.armTimers()
  }

  private async flush(): Promise<void> {
    // La lista de ausentes va en el mismo `update` que la jugada que la cambió:
    // quien vuelve ve su aviso quitarse a la vez que le llega su reloj.
    const absent = SEATS.filter((seat) => this.absent[seat] && this.seats[seat] && !this.seats[seat]!.bot)
    const key = absent.join(',')
    if (key !== this.publishedAbsent) {
      this.publishedAbsent = key
      // null y no []: RTDB no guarda arrays vacíos (volvería como {} o nada)
      this.pending[PATH.absent] = absent.length > 0 ? absent : null
    }
    const batch = this.pending
    this.pending = {}
    if (Object.keys(batch).length === 0) return
    await this.store.update(batch)
  }

  // --- plazos ------------------------------------------------------------------------

  private armTimers(): void {
    this.clearTimers()
    if (this.stopped || this.phase !== 'playing') return
    if (this.deadlineAt > 0) {
      const ms = Math.max(0, this.deadlineAt + DEADLINE.grace - Date.now())
      this.deadlineTimer = setTimeout(() => void this.serial(() => this.onDeadline()), ms)
    }
    if (this.readyAt > 0) {
      const ms = Math.max(0, this.readyAt - Date.now())
      this.readyTimer = setTimeout(() => void this.serial(() => this.pump()), ms)
    }
  }

  private clearTimers(): void {
    if (this.deadlineTimer !== null) clearTimeout(this.deadlineTimer)
    if (this.readyTimer !== null) clearTimeout(this.readyTimer)
    this.deadlineTimer = null
    this.readyTimer = null
  }

  private async onDeadline(): Promise<void> {
    if (this.phase !== 'playing' || !this.game || this.deadlineAt === 0) return
    if (Date.now() < this.deadlineAt) {
      this.armTimers()
      return
    }
    const waiting = waitingOn(this.game, this.autoSeats())
    // A quien se esperaba y no contestó se le juega ESA decisión y nada más.
    // Solo tras varios plazos seguidos se le da por abandonado: así una
    // desconexión corta cuesta un descarte, no la partida entera.
    for (const seat of waiting) {
      const slot = this.seats[seat]
      if (slot && !slot.bot) {
        const misses = (this.misses[seat] ?? 0) + 1
        this.misses[seat] = misses
        if (misses >= ABANDON_AFTER) this.absent[seat] = true
      }
      // En una reacción se PASA, y no se deja que la IA cante por él: pasar
      // nunca perjudica a quien no estaba, pero un ron o un pon sorpresa sí.
      const forced =
        timeoutAction(this.game.hand, seat) ??
        this.policies[seat]!.turn(this.game.hand, this.rngs![seat])
      this.apply(forced)
    }
    await this.pump()
  }

  // --- utilidades -----------------------------------------------------------------

  private seatOf(uid: string): Seat | null {
    if (!uid) return null
    const i = this.seats.findIndex((s) => s !== null && s.uid === uid)
    return i < 0 ? null : (i as Seat)
  }

  /** Asientos que mueve el árbitro: bots de relleno y humanos ausentes. */
  private autoSeats(): Set<Seat> {
    const out = new Set<Seat>()
    for (const seat of SEATS) {
      const slot = this.seats[seat]
      if (!slot || slot.bot || this.absent[seat]) out.add(seat)
    }
    return out
  }

  private readySeats(): ReadySeat[] {
    return SEATS.map((seat) => {
      const slot = this.seats[seat]
      return {
        human: slot !== null && slot !== undefined && !slot.bot && !this.absent[seat],
        connected: slot !== null && slot !== undefined && this.online.has(slot.uid),
        ready: this.ready[seat] === true,
      }
    })
  }

  /** Las entradas llegan de Firebase en paralelo; aquí se procesan de una en una. */
  private serial(fn: () => Promise<void>): Promise<void> {
    this.busy = this.busy.then(fn, fn).catch((err: unknown) => {
      console.error('árbitro', err)
    })
    return this.busy
  }
}

// --- helpers de módulo -------------------------------------------------------------

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
 * El reglamento sale de los ajustes del anfitrión: se valida campo a campo
 * contra DEFAULT_RULES y se descarta cualquier cosa rara, en lugar de confiar
 * en la forma del JSON (que además viaja por la sala a los demás).
 */
export function sanitizeRules(r: unknown): RuleSet {
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
