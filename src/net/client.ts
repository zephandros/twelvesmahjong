// El cliente de una sala: lobby + flujo autoritativo, sobre un `RoomStore`.
//
// Lo usa cada jugador, anfitrión incluido (el anfitrión además corre el
// árbitro, host.ts; su propio tablero se alimenta por aquí como el de todos,
// así no hay dos caminos). Sin DOM ni Firebase: ui/net.ts le pone el almacén
// real y traduce los códigos de error.

import type { Seat } from '../core/seat'
import { replay } from '../core/replay'
import type { RuleSet } from '../core/rules-config'
import type { CharacterId } from '../ai/roster'
import type { Difficulty } from '../ai/profiles'
import type { Action } from '../core/actions'
import { RoomHost } from './host'
import {
  PATH, MAX_NAME, logKey, logIndex, logFromEntries, seatsOf, fourOf,
  type Clock, type ErrorCode, type GameSetup, type HandEndWait, type Intent, type LobbyView,
  type LogEntry, type NetGame, type Notice, type Resume, type RoomMeta, type SeatSlot,
} from './protocol'
import type { RoomStore, Unsub } from './store'

export interface Me {
  uid: string
  name: string
}

export interface ClientHandlers {
  /** Estado del lobby (asientos, quién es anfitrión, personajes cogidos). */
  onLobby(view: LobbyView): void
  /** La partida arranca: hay que montar el tablero. */
  onStart(game: NetGame, roster: CharacterId[], resume: Resume | null): void
  /** Aviso no fatal (p. ej. el personaje elegido se lo acaba de pillar otro). */
  onError(code: ErrorCode): void
  /** Se acabó y no se puede recuperar. */
  onDead(code: ErrorCode): void
}

export interface RoomConnection {
  pick(characterId: CharacterId): void
  /** Solo el anfitrión. Los asientos vacíos se rellenan con bots. */
  begin(rules: RuleSet, difficulty: Difficulty): void
  /** Salir. El anfitrión cierra la sala para todos. */
  close(): void
}

/** Crea la sala con el anfitrión sentado en el asiento 0. */
export async function createRoom(store: RoomStore, me: Me): Promise<void> {
  const meta: Omit<RoomMeta, 'createdAt'> & { createdAt: unknown } = {
    host: me.uid,
    phase: 'lobby',
    createdAt: store.serverTimestamp(),
  }
  await store.update({
    [PATH.meta]: meta,
    [PATH.seat(0)]: slotFor(me),
  })
}

const slotFor = (me: Me): SeatSlot => ({
  uid: me.uid,
  name: me.name.trim().slice(0, MAX_NAME),
  characterId: null,
})

export function joinRoom(store: RoomStore, code: string, me: Me, h: ClientHandlers): RoomConnection {
  const unsubs: Unsub[] = []
  let closed = false
  let meta: RoomMeta | null = null
  let seats: (SeatSlot | null)[] = [null, null, null, null]
  let online = new Set<string>()
  let host: RoomHost | null = null
  let claiming: Promise<void> | null = null
  let started = false
  let finished = false

  // Enganches del controlador: se rellenan cuando el tablero se monta.
  let onAction: ((a: Action) => void) | null = null
  let onDeadline: ((seats: Seat[], ms: number) => void) | null = null
  let onHandEnd: ((waiting: Seat[], ms: number) => void) | null = null
  let onNotice: ((n: Notice | null) => void) | null = null
  /** Asientos que el árbitro lleva por ausencia (`PATH.absent`). */
  let absent: Seat[] = []
  let onNack: (() => void) | null = null
  let onNetClose: ((code: ErrorCode) => void) | null = null
  const buffered: Action[] = []
  let pendingDeadline: { seats: Seat[]; ms: number } | null = null
  let pendingHandEnd: { waiting: Seat[]; ms: number } | null = null

  const die = (code: ErrorCode): void => {
    if (closed) return
    teardown()
    if (onNetClose) onNetClose(code)
    else h.onDead(code)
  }

  const teardown = (): void => {
    closed = true
    for (const u of unsubs) u()
    unsubs.length = 0
    host?.stop()
    host = null
  }

  const mySeat = (): Seat | null => {
    const i = seats.findIndex((s) => s !== null && s.uid === me.uid)
    return i < 0 ? null : (i as Seat)
  }

  const isHost = (): boolean => meta !== null && meta.host === me.uid

  /** Lo que queda de un plazo escrito por el árbitro, con el reloj del servidor. */
  const remaining = (ms: number, at: number): number =>
    Math.max(0, ms - (Date.now() + store.serverOffset() - at))

  // --- lobby ------------------------------------------------------------------------

  const paintLobby = (): void => {
    if (closed || !meta || meta.phase !== 'lobby') return
    const you = mySeat()
    if (you === null) return // aún sin asiento
    const taken = seats.map((s) => s?.characterId).filter(Boolean) as CharacterId[]
    h.onLobby({
      code,
      you,
      host: isHost(),
      hostOnline: online.has(meta.host),
      seats: seats.map((s) =>
        s === null ? null : { name: s.name, characterId: s.characterId, connected: online.has(s.uid) },
      ),
      taken,
    })
  }

  /** Sin asiento: se reclama el primero libre (transacción, contra carreras). */
  const ensureSeat = async (): Promise<void> => {
    if (mySeat() !== null) return
    if (!meta || meta.phase !== 'lobby') {
      die('already_started')
      return
    }
    try {
      for (const seat of [0, 1, 2, 3] as Seat[]) {
        if (seats[seat] !== null) continue
        if (await store.claim(PATH.seat(seat), slotFor(me))) return
      }
    } catch {
      die('session') // las reglas no dejan sentarse: la sesión no vale para esta sala
      return
    }
    die('room_full')
  }

  // --- partida ------------------------------------------------------------------------

  const startPlay = async (): Promise<void> => {
    if (started) return
    started = true
    const you = mySeat()
    const setup = await store.get<GameSetup>(PATH.game)
    if (you === null || !setup) {
      die('already_started')
      return
    }
    const raw = (await store.get<Record<string, LogEntry>>(PATH.log)) ?? {}
    const keys = Object.keys(raw).sort()
    const log = logFromEntries(setup.seed, setup.rules, keys.map((k) => raw[k]!))
    let seen = keys.length
    // Si la sala ya tenía historia (reconexión, o entrar tarde), se
    // reconstruye con el mismo `replay` del guardado local en vez de
    // reproducir las jugadas por pantalla.
    const resume: Resume | null = seen > 0
      ? { game: replay(log), log, botSeed: setup.botSeed, difficulty: setup.difficulty }
      : null

    unsubs.push(
      store.watchAppend<LogEntry>(PATH.log, logKey(seen), (key, e) => {
        // tras reconectar, Firebase reenvía desde `fromKey`: lo visto se ignora
        const n = logIndex(key)
        if (n < seen) return
        seen = n + 1
        if (onAction) onAction(e.a)
        else buffered.push(e.a)
      }),
      store.watch<Clock>(PATH.clock, (c) => {
        if (!c) return
        const ms = remaining(c.ms, c.at)
        if (onDeadline) onDeadline(c.seats, ms)
        else pendingDeadline = { seats: c.seats, ms }
      }),
      store.watch<HandEndWait>(PATH.handEnd, (w) => {
        if (!w) return
        const ms = remaining(w.ms, w.at)
        if (onHandEnd) onHandEnd(w.waiting, ms)
        else pendingHandEnd = { waiting: w.waiting, ms }
      }),
      store.watch<{ seq: number; at: number }>(PATH.nack(me.uid), (n) => {
        if (n && onNack) onNack()
      }),
      store.watch<Seat[]>(PATH.absent, (a) => {
        absent = Array.isArray(a) ? a : []
        notice()
      }),
    )

    const net: NetGame = {
      seat: you,
      seed: setup.seed,
      rules: setup.rules,
      botSeed: setup.botSeed,
      difficulty: setup.difficulty,
      // RTDB devuelve un array con huecos como objeto: se normaliza a 4.
      players: fourOf<string | null>(setup.players, null),
      onAction(cb) {
        onAction = cb
        while (buffered.length > 0) cb(buffered.shift()!)
      },
      onDeadline(cb) {
        onDeadline = cb
        if (pendingDeadline) {
          cb(pendingDeadline.seats, pendingDeadline.ms)
          pendingDeadline = null
        }
      },
      onHandEnd(cb) {
        onHandEnd = cb
        if (pendingHandEnd) {
          cb(pendingHandEnd.waiting, pendingHandEnd.ms)
          pendingHandEnd = null
        }
      },
      onNotice(cb) {
        onNotice = cb
        notice()
      },
      onNack(cb) {
        onNack = cb
      },
      ready() {
        void store.set(PATH.readyOf(me.uid), true).catch(() => die('session'))
      },
      resume() {
        const mark: Intent = { seq: -1, a: { type: 'resume' } }
        void store.set(PATH.intent(me.uid), mark).catch(() => die('session'))
      },
      onClose(cb) {
        onNetClose = cb
      },
      send(a, seq) {
        void store.set(PATH.intent(me.uid), { seq, a }).catch(() => die('session'))
      },
      close: () => closeAll(),
    }
    h.onStart(net, setup.roster, resume)
  }

  const notice = (): void => {
    if (!onNotice || !meta || meta.phase !== 'playing') return
    const you = mySeat()
    onNotice(
      !online.has(meta.host) ? 'host-away'
        : you !== null && absent.includes(you) ? 'autopilot'
          : null,
    )
  }

  // --- suscripciones --------------------------------------------------------------

  // `meta` y `seats` llegan por separado y en cualquier orden; nada se decide
  // hasta tener las dos fotos (sentarse con `seats` aún vacío sentaría al
  // anfitrión dos veces).
  let metaSeen = false
  let seatsSeen = false

  const sync = (): void => {
    if (closed || !meta || !metaSeen || !seatsSeen) return
    if (meta.phase === 'lobby') {
      if (claiming === null && mySeat() === null) {
        claiming = ensureSeat().finally(() => { claiming = null })
      }
      paintLobby()
    } else {
      void startPlay()
    }
    notice()
  }

  unsubs.push(
    store.presence(PATH.presenceOf(me.uid)),
    store.watch<RoomMeta>(PATH.meta, (m) => {
      if (closed) return
      metaSeen = true
      if (!m) {
        // Nunca existió (código malo) o el anfitrión la cerró. Si la partida ya
        // acabó, la retirada de la sala no es noticia: cada uno está en su
        // pantalla de resultados.
        if (finished) return
        die(meta === null ? 'no_room' : 'closed')
        return
      }
      meta = m
      if (m.phase === 'done') finished = true
      if (isHost() && host === null) {
        host = new RoomHost(store, me.uid)
        void host.start().catch(() => die('network'))
      }
      sync()
    }),
    store.watch(PATH.seats, (raw) => {
      if (closed) return
      seatsSeen = true
      seats = seatsOf(raw)
      sync()
    }),
    store.watch<Record<string, boolean>>(PATH.presence, (p) => {
      if (closed) return
      online = new Set(Object.keys(p ?? {}))
      paintLobby()
      notice()
    }),
  )

  const closeAll = (): void => {
    if (closed) return
    // Una pestaña del anfitrión que cedió el arbitraje a otra NO se lleva la
    // sala al cerrarse: la partida sigue en la pestaña que arbitra.
    const wasHost = isHost() && (host === null || host.active)
    const seat = mySeat()
    teardown()
    if (wasHost) {
      // El anfitrión se lleva la sala: sin árbitro no hay partida posible.
      void store.remove('').catch(() => { /* ya no existe */ })
    } else if (seat !== null && meta?.phase === 'lobby') {
      // En el lobby un invitado libera su asiento al irse; en partida lo
      // conserva (reconectar lo recupera, y mientras tanto juega la IA).
      void store.remove(PATH.seat(seat)).catch(() => { /* sin permiso: da igual */ })
    }
  }

  return {
    pick(characterId) {
      const seat = mySeat()
      if (seat === null || !meta || meta.phase !== 'lobby') return
      // La unicidad la imponen también las reglas de la sala: dos jugadores no
      // pueden llevar el mismo personaje (retratos y voces van por personaje).
      const takenByOther = seats.some((s, i) => i !== seat && s?.characterId === characterId)
      if (takenByOther) {
        h.onError('character_taken')
        return
      }
      void store.set(`${PATH.seat(seat)}/characterId`, characterId)
        .catch(() => h.onError('character_taken'))
    },
    begin(rules, difficulty) {
      if (!host) {
        h.onError('not_host')
        return
      }
      void host.begin(rules, difficulty).catch(() => h.onError('network'))
    },
    close: closeAll,
  }
}
