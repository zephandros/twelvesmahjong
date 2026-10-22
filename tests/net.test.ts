// Multijugador de punta a punta, sin red: un anfitrión y dos invitados juegan
// sobre `MemoryBackend` (src/net/store.ts), el mismo contrato que Firebase.
//
// Lo que se ata aquí:
//  1. El lobby: sentarse, elegir personaje (único), empezar con bots de relleno.
//  2. El flujo autoritativo: cada cliente reproduce EXACTAMENTE el mismo log
//     que el árbitro, y el log reproduce (replay) el estado final.
//  3. Los plazos: a quien no contesta se le juega esa decisión; tras
//     ABANDON_AFTER seguidos, la IA lleva su asiento.
//  4. Fin de mano sincronizado: no se reparte hasta que todos confirman (o
//     vence la gracia).
//  5. Reconexión del anfitrión: el árbitro se reconstruye del log y sigue.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { MemoryBackend, type MemoryStore } from '../src/net/store'
import { createRoom, joinRoom, type ClientHandlers, type RoomConnection } from '../src/net/client'
import {
  ABANDON_AFTER, DEADLINE, PATH, countActions, logFromEntries, seatsOf,
  type LobbyView, type NetGame, type Resume, type LogEntry, type RoomMeta,
} from '../src/net/protocol'
import type { Action } from '../src/core/actions'
import type { Seat } from '../src/core/seat'
import { reduce } from '../src/core/reducer'
import { newGame, advanceGame, type GameState } from '../src/core/game'
import { replay } from '../src/core/replay'
import { DEFAULT_RULES } from '../src/core/rules-config'
import { makePolicy } from '../src/ai/bot'
import { DEFAULT_PROFILE } from '../src/ai/profiles'
import { makeRng } from '../src/core/rng'

const CODE = 'ABCDEF'

/** Vacía microtasks y timers pendientes hasta que nada más se mueva. */
async function settle(ms = 0): Promise<void> {
  for (let i = 0; i < 20; i++) {
    await Promise.resolve()
    await new Promise<void>((r) => process.nextTick(r))
  }
  if (ms > 0) {
    await vi.advanceTimersByTimeAsync(ms)
    await settle(0)
  }
}

/** Un jugador: su cliente, y un "controlador" mínimo que reproduce el log. */
class Player {
  lobby: LobbyView | null = null
  net: NetGame | null = null
  game: GameState | null = null
  log: Action[][] = [[]]
  errors: string[] = []
  dead: string | null = null
  deadline: { seats: Seat[]; ms: number } | null = null
  handEnd: { waiting: Seat[]; ms: number } | null = null
  notices: (string | null)[] = []
  nacks = 0
  conn: RoomConnection
  readonly policy = makePolicy(DEFAULT_PROFILE)
  readonly rng = makeRng(7)

  constructor(readonly store: MemoryStore, readonly uid: string, readonly name: string) {
    const h: ClientHandlers = {
      onLobby: (v) => { this.lobby = v },
      onStart: (net, _roster, resume) => this.start(net, resume),
      onError: (c) => this.errors.push(c),
      onDead: (c) => { this.dead = c },
    }
    this.conn = joinRoom(store, CODE, { uid, name }, h)
  }

  private start(net: NetGame, resume: Resume | null): void {
    this.net = net
    if (resume) {
      this.game = resume.game
      this.log = resume.log.hands.map((h) => [...h])
    } else {
      this.game = newGame(net.seed, {}, net.rules)
      this.log = [[]]
    }
    net.onAction((a) => this.apply(a))
    net.onDeadline((seats, ms) => { this.deadline = { seats, ms } })
    net.onHandEnd((waiting, ms) => { this.handEnd = { waiting, ms } })
    net.onNotice((n) => this.notices.push(n))
    net.onNack(() => { this.nacks++ })
    net.onClose((c) => { this.dead = c })
  }

  /** Cola de entrada, como el `inbox` del controlador: con la mano acabada
   *  se espera a CONTINUAR (la gracia del árbitro puede repartir antes). */
  private readonly inbox: Action[] = []

  private apply(a: Action): void {
    this.inbox.push(a)
    this.drain()
  }

  private drain(): void {
    while (this.inbox.length > 0 && this.game!.hand.phase !== 'ended') {
      const a = this.inbox.shift()!
      this.game = { ...this.game!, hand: reduce(this.game!.hand, a) }
      this.log[this.log.length - 1]!.push(a)
    }
  }

  get seq(): number {
    return this.log.reduce((n, h) => n + h.length, 0)
  }

  /** Pulsa CONTINUAR en la pantalla de resultados. */
  continueHand(): void {
    this.net!.ready()
    this.game = advanceGame(this.game!)
    this.log.push([])
    this.drain()
  }

  /** Juega lo que le toque ahora mismo, con la IA, como haría una persona. */
  act(): boolean {
    const s = this.game!.hand
    const me = this.net!.seat
    if (s.phase === 'discard' && s.turn === me) {
      this.net!.send(this.policy.turn(s, this.rng), this.seq)
      return true
    }
    if (s.phase === 'reaction' && s.reaction) {
      const offer = s.reaction.offers.find((o) => o.seat === me)
      if (offer && s.reaction.responses[me] === null) {
        this.net!.send(this.policy.reaction(s, offer, this.rng), this.seq)
        return true
      }
    }
    return false
  }
}

describe('multijugador sobre el almacén en memoria', () => {
  let backend: MemoryBackend

  beforeEach(() => {
    vi.useFakeTimers()
    backend = new MemoryBackend()
    backend.now = () => Date.now()
    // Partidas reproducibles: el árbitro sortea semillas con el CSPRNG y los
    // bots de relleno con Math.random; aquí los dos salen de un contador.
    let n = 0x1234
    vi.spyOn(crypto, 'getRandomValues').mockImplementation(<T extends ArrayBufferView | null>(arr: T): T => {
      if (arr instanceof Uint32Array) for (let i = 0; i < arr.length; i++) arr[i] = (n = (n * 1103515245 + 12345) >>> 0)
      return arr
    })
    vi.spyOn(Math, 'random').mockImplementation(() => ((n = (n * 1103515245 + 12345) >>> 0) % 1000) / 1000)
  })
  afterEach(() => {
    vi.restoreAllMocks()
    vi.useRealTimers()
  })

  async function lobbyWith(n: 1 | 2 | 3): Promise<Player[]> {
    const hostStore = backend.room(CODE)
    await createRoom(hostStore, { uid: 'host', name: 'Ana' })
    const host = new Player(hostStore, 'host', 'Ana')
    const players = [host]
    for (let i = 1; i < n; i++) {
      players.push(new Player(backend.room(CODE), `g_${i}`, `Invitado ${i}`))
    }
    await settle()
    return players
  }

  it('el lobby sienta a cada uno y el anfitrión es el asiento 0', async () => {
    const [host, g1, g2] = await lobbyWith(3)
    expect(host!.lobby?.you).toBe(0)
    expect(host!.lobby?.host).toBe(true)
    expect(g1!.lobby?.you).toBe(1)
    expect(g1!.lobby?.host).toBe(false)
    expect(g2!.lobby?.you).toBe(2)
    expect(host!.lobby?.seats.filter(Boolean)).toHaveLength(3)
    // todos conectados (presencia)
    expect(host!.lobby?.seats[1]?.connected).toBe(true)
    expect(g1!.lobby?.hostOnline).toBe(true)
  })

  it('dos jugadores no pueden llevar el mismo personaje', async () => {
    const [host, g1] = await lobbyWith(2)
    host!.conn.pick('alice')
    await settle()
    g1!.conn.pick('alice')
    await settle()
    expect(g1!.errors).toContain('character_taken')
    expect(g1!.lobby?.taken).toEqual(['alice'])
    g1!.conn.pick('dorian')
    await settle()
    expect(host!.lobby?.taken).toEqual(['alice', 'dorian'])
  })

  it('un quinto jugador no cabe', async () => {
    await lobbyWith(3)
    const g3 = new Player(backend.room(CODE), 'g_3', 'Cuarto')
    const g4 = new Player(backend.room(CODE), 'g_4', 'Quinto')
    await settle()
    expect(g3.lobby?.you).toBe(3)
    expect(g4.dead).toBe('room_full')
  })

  it('un código sin sala no entra', async () => {
    const p = new Player(backend.room('ZZZZZZ'), 'g_x', 'Nadie')
    await settle()
    expect(p.dead).toBe('no_room')
  })

  it('solo el anfitrión puede empezar', async () => {
    const [, g1] = await lobbyWith(2)
    g1!.conn.begin(DEFAULT_RULES, 'normal')
    await settle()
    expect(g1!.errors).toContain('not_host')
  })

  it('una partida entera entre tres personas y un bot reproduce el mismo log en todos', async () => {
    const players = await lobbyWith(3)
    const [host] = players
    host!.conn.pick('alice')
    await settle()
    host!.conn.begin(DEFAULT_RULES, 'normal')
    await settle()
    for (const p of players) {
      expect(p.net).not.toBeNull()
      expect(p.net!.players).toEqual(['Ana', 'Invitado 1', 'Invitado 2', null])
    }

    // Bucle de "personas": cada vez que a alguien le toca, juega. Cuando una
    // mano acaba, todos pulsan CONTINUAR. Hasta que la partida termine.
    for (let round = 0; round < 4000; round++) {
      await settle()
      const g = host!.game!
      if (g.finished) break
      if (g.hand.phase === 'ended') {
        // todos ven la misma mano acabada antes de continuar
        for (const p of players) expect(p.game!.hand.phase).toBe('ended')
        for (const p of players) p.continueHand()
        await settle()
        continue
      }
      let moved = false
      for (const p of players) moved = p.act() || moved
      if (!moved) {
        // nadie tiene nada que hacer: o el bot está en ello (el árbitro lo
        // juega de inmediato), o hay un plazo que vencer
        await settle(50)
        if (!players.some((p) => p.act())) await settle(DEADLINE.turn + DEADLINE.grace)
      }
    }

    expect(host!.game!.finished).toBe(true)
    // Todos acabaron en el mismo sitio, y el log reproduce ese estado.
    const meta = await host!.store.get<RoomMeta>(PATH.meta)
    expect(meta?.phase).toBe('done')
    for (const p of players) {
      expect(p.game!.finished).toBe(true)
      expect(p.log).toEqual(host!.log)
      expect(p.game!.hand.seats.map((s) => s.points))
        .toEqual(host!.game!.hand.seats.map((s) => s.points))
    }
    const raw = (await host!.store.get<Record<string, LogEntry>>(PATH.log)) ?? {}
    const entries = Object.keys(raw).sort().map((k) => raw[k]!)
    const fromStore = logFromEntries(host!.net!.seed, host!.net!.rules, entries)
    expect(countActions(fromStore)).toBe(host!.seq)
    const replayed = replay(fromStore)
    expect(replayed.hand.seats.map((s) => s.points))
      .toEqual(host!.game!.hand.seats.map((s) => s.points))
  }, 60_000)

  it('una intención rancia se descarta y se avisa (nack)', async () => {
    const [host, g1] = await lobbyWith(2)
    host!.conn.begin(DEFAULT_RULES, 'normal')
    await settle()
    // el asiento 1 manda un descarte con un seq viejo
    g1!.net!.send({ type: 'tsumo' }, 0)
    await settle()
    expect(g1!.nacks).toBe(1)
    // y una jugada firmada por otro asiento tampoco pasa
    g1!.net!.send({ type: 'pass', seat: 2 }, g1!.seq)
    await settle()
    expect(g1!.nacks).toBe(2)
  })

  it('a quien no contesta se le juega la decisión; tras varias seguidas lo lleva la IA', async () => {
    const [host, g1] = await lobbyWith(2)
    host!.conn.begin(DEFAULT_RULES, 'normal')
    await settle()
    // Solo juega el anfitrión; el invitado no toca nada. La partida tiene que
    // avanzar igual: cada plazo del invitado vence y se le juega.
    let guestTurns = 0
    for (let i = 0; i < 400 && guestTurns < ABANDON_AFTER + 2; i++) {
      await settle()
      const s = host!.game!.hand
      if (s.phase === 'ended') {
        host!.continueHand()
        g1!.continueHand()
        continue
      }
      if (host!.act()) continue
      if (s.phase === 'discard' && s.turn === 1) guestTurns++
      await settle(DEADLINE.turn + DEADLINE.grace + 1)
    }
    expect(guestTurns).toBeGreaterThanOrEqual(ABANDON_AFTER)
    // El invitado, que nunca jugó, tiene el mismo estado que el anfitrión:
    // el relevo del árbitro le llega por el mismo log.
    expect(g1!.log).toEqual(host!.log)
    expect(host!.deadline).not.toBeNull()
  })

  it('quien fue dado por ausente ve el aviso y recupera el mando con un `resume`, sin salir de la sala', async () => {
    const [host, g1] = await lobbyWith(2)
    host!.conn.begin(DEFAULT_RULES, 'normal')
    await settle()
    // el invitado no toca nada hasta que la IA lleva su asiento
    const playUntil = async (stop: () => boolean, guestPlays: boolean): Promise<void> => {
      for (let i = 0; i < 600 && !stop(); i++) {
        await settle()
        const s = host!.game!.hand
        if (s.phase === 'ended') {
          host!.continueHand()
          g1!.continueHand()
          continue
        }
        if (host!.act()) continue
        if (guestPlays && g1!.act()) continue
        if (stop()) break
        await settle(DEADLINE.turn + DEADLINE.grace + 1)
      }
    }
    await playUntil(() => g1!.notices.at(-1) === 'autopilot', false)
    expect(g1!.notices.at(-1)).toBe('autopilot')
    expect(await backend.room(CODE).get(PATH.absent)).toEqual([1])
    // el anfitrión no está ausente: su cliente no ve ese aviso
    expect(host!.notices).not.toContain('autopilot')

    // "Toca para retomar el control": el árbitro deja de jugar por él…
    g1!.net!.resume()
    await settle()
    expect(g1!.notices.at(-1)).toBeNull()
    expect(await backend.room(CODE).get(PATH.absent)).toBeNull()
    expect(g1!.nacks).toBe(0) // el `resume` no es una jugada rancia

    // …y en su siguiente turno se le espera de verdad, con reloj, y su jugada entra.
    const guestTurn = (): boolean => {
      const s = host!.game!.hand
      return s.phase === 'discard' && s.turn === 1
    }
    await playUntil(guestTurn, false)
    expect(guestTurn()).toBe(true)
    expect(host!.deadline?.seats).toContain(1)
    const before = host!.seq
    expect(g1!.act()).toBe(true)
    await settle()
    expect(host!.seq).toBeGreaterThan(before)
    expect(g1!.nacks).toBe(0)
    expect(g1!.log).toEqual(host!.log)
  })

  it('no se reparte la mano siguiente hasta que todos confirman, salvo que venza la gracia', async () => {
    const [host, g1] = await lobbyWith(2)
    host!.conn.begin(DEFAULT_RULES, 'normal')
    await settle()
    // jugar hasta que acabe una mano (mirando el estado DESPUÉS de asentar:
    // esperar un plazo entero con la mano ya acabada agotaría la gracia)
    for (let i = 0; i < 2000; i++) {
      await settle()
      if (host!.game!.hand.phase === 'ended') break
      if (!host!.act() && !g1!.act()) await settle(DEADLINE.turn + DEADLINE.grace + 1)
    }
    expect(host!.game!.hand.phase).toBe('ended')
    const before = host!.seq
    expect(host!.handEnd?.waiting).toEqual([0, 1])
    // solo confirma el anfitrión: no debe llegar ninguna acción nueva
    host!.continueHand()
    await settle(1000)
    expect(g1!.seq).toBe(before)
    expect(host!.handEnd?.waiting).toEqual([1])
    expect(g1!.handEnd?.waiting).toEqual([1])
    // el invitado confirma: se reparte
    g1!.continueHand()
    await settle()
    expect(host!.seq).toBeGreaterThan(before)
    expect(g1!.log.length).toBe(host!.log.length)
  }, 30_000)

  it('si el anfitrión se cae, la mesa espera; al volver retoma del log', async () => {
    const [host, g1] = await lobbyWith(2)
    host!.conn.begin(DEFAULT_RULES, 'normal')
    await settle()
    for (let i = 0; i < 40; i++) {
      await settle()
      if (!host!.act() && !g1!.act()) await settle(DEADLINE.turn + DEADLINE.grace + 1)
    }
    // se va el anfitrión (cierra la pestaña sin cerrar la sala)
    backend.disconnect(host!.store)
    await settle()
    expect(g1!.notices[g1!.notices.length - 1]).toBe('host-away')
    // nadie reparte: el invitado puede intentar jugar, pero no llega nada
    // nadie reparte ni juega por nadie: el log de la sala no crece
    const logSize = async (): Promise<number> =>
      Object.keys((await g1!.store.get<Record<string, unknown>>(PATH.log)) ?? {}).length
    const logAtDrop = await logSize()
    g1!.act()
    await settle(DEADLINE.turn + DEADLINE.grace + 1)
    expect(await logSize()).toBe(logAtDrop)

    // vuelve, con un cliente NUEVO (recarga): reconstruye del log y sigue
    const store2 = backend.room(CODE)
    const host2 = new Player(store2, 'host', 'Ana')
    await settle()
    expect(host2.net).not.toBeNull()
    // reconstruye TODO lo que había en la sala (puede ir una mano por delante
    // de lo que el jugador había llegado a ver, si la gracia venció)
    expect(host2.seq).toBe(logAtDrop)
    expect(g1!.notices[g1!.notices.length - 1]).toBeNull()
    for (let i = 0; i < 20; i++) {
      await settle()
      // cada uno pulsa CONTINUAR cuando SU pantalla de resultados lo pide (el
      // invitado puede ir una mano por detrás del anfitrión recién vuelto)
      const ended = [host2, g1!].filter((p) => p.game!.hand.phase === 'ended')
      for (const p of ended) p.continueHand()
      if (ended.length > 0) continue
      if (!host2.act() && !g1!.act()) await settle(DEADLINE.turn + DEADLINE.grace + 1)
    }
    expect(await logSize()).toBeGreaterThan(logAtDrop)
    expect(g1!.log).toEqual(host2.log)
  }, 30_000)

  it('el anfitrión se lleva la sala al salir', async () => {
    const [host, g1] = await lobbyWith(2)
    host!.conn.close()
    await settle()
    expect(g1!.dead).toBe('closed')
    expect(seatsOf(await backend.room(CODE).get(PATH.seats)).every((s) => s === null)).toBe(true)
  })

  it('un invitado que sale del lobby libera su asiento', async () => {
    const [host, g1] = await lobbyWith(2)
    g1!.conn.close()
    await settle()
    expect(host!.lobby?.seats[1]).toBeNull()
  })
})
