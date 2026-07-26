// Transporte de multijugador: el WebSocket con la sala, y nada más.
//
// El controlador solo ve la interfaz `NetGame` (ver ui/controller.ts), así que
// no sabe que existen los WebSockets. Aquí se concentra todo lo feo: el
// handshake, la reconexión con backoff y la reconciliación del log.

import type { Action } from '../core/actions'
import type { Seat } from '../core/seat'
import { replay, type GameLog } from '../core/replay'
import type { NetGame, Resume } from './controller'
import type {
  ClientMessage, CreateRoomResponse, ErrorCode, PlayerView, ServerMessage,
} from '../net/protocol'
import type { CharacterId } from '../ai/roster'
import type { RuleSet } from '../core/rules-config'
import type { Difficulty } from '../ai/profiles'
import { t } from './i18n'

/** Identidad del jugador en las salas. Es lo que permite recuperar el asiento. */
const TOKEN_KEY = 'tm-mp-token-v1'

export function playerToken(): string {
  let tok = ''
  try {
    tok = localStorage.getItem(TOKEN_KEY) ?? ''
  } catch { /* modo privado: token de un solo uso */ }
  if (!tok) {
    tok = crypto.randomUUID()
    try { localStorage.setItem(TOKEN_KEY, tok) } catch { /* da igual */ }
  }
  return tok
}

/** Mensaje traducido de un código de error del servidor. */
export function errorMessage(code: ErrorCode | 'turnstile' | 'turnstile-blocked' | 'offline' | 'disabled' | 'network'): string {
  // Los códigos del protocolo van en snake_case y las claves i18n en kebab.
  return t(`mp.error.${code.replace(/_/g, '-')}` as Parameters<typeof t>[0])
}

// --- crear sala -------------------------------------------------------------------

export class CreateRoomError extends Error {
  constructor(readonly code: 'turnstile' | 'disabled' | 'network') {
    super(code)
  }
}

/**
 * `POST /api/room`. No instancia ninguna sala: devuelve un código y el ticket
 * que prueba que se pasó Turnstile (ver worker/ticket.ts).
 */
export async function createRoom(turnstileToken: string): Promise<CreateRoomResponse> {
  let res: Response
  try {
    res = await fetch('/api/room', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ turnstileToken }),
    })
  } catch {
    throw new CreateRoomError('network')
  }
  if (res.status === 503) throw new CreateRoomError('disabled')
  if (res.status === 403) throw new CreateRoomError('turnstile')
  if (!res.ok) throw new CreateRoomError('network')
  return (await res.json()) as CreateRoomResponse
}

// --- conexión con la sala ----------------------------------------------------------

export interface RoomHandlers {
  /** Estado del lobby (asientos, quién es anfitrión, personajes cogidos). */
  onLobby(view: LobbyView): void
  /** La partida arranca: hay que montar el tablero. */
  onStart(game: NetGame, roster: CharacterId[], resume: Resume | null): void
  /** Aviso no fatal (p. ej. el personaje elegido se lo acaba de pillar otro). */
  onError(code: ErrorCode): void
  /** Estado de la conexión, para pintar "conectando…" / "reconectando…". */
  onStatus(status: 'connecting' | 'open' | 'reconnecting'): void
  /** Se acabó y no se puede recuperar. */
  onDead(message: string): void
}

export interface LobbyView {
  code: string
  you: Seat
  host: boolean
  seats: (PlayerView | null)[]
  taken: CharacterId[]
}

export interface RoomConnection {
  pick(characterId: CharacterId): void
  begin(rules: RuleSet, difficulty: Difficulty): void
  close(): void
}

const RETRY_MS = [500, 1000, 2000, 4000, 8000]

/**
 * Abre (o reabre) la sala `code`. `hostTicket` solo hace falta la primera vez
 * que se crea; al unirse a una sala existente no se manda.
 */
export function connectRoom(
  code: string,
  name: string,
  hostTicket: string | null,
  h: RoomHandlers,
): RoomConnection {
  const token = playerToken()
  let ws: WebSocket | null = null
  let closed = false
  let attempt = 0
  let retryTimer: ReturnType<typeof setTimeout> | null = null

  // Enganches del controlador: se rellenan cuando empieza la partida.
  let onAction: ((a: Action) => void) | null = null
  let onNetClose: ((reason: string) => void) | null = null
  let onDeadline: ((seats: Seat[], ms: number) => void) | null = null
  /** Último plazo llegado antes de que el tablero se enganchara. */
  let pendingDeadline: { seats: Seat[]; ms: number } | null = null
  let onHandEnd: ((waiting: Seat[], ms: number) => void) | null = null
  let pendingHandEnd: { waiting: Seat[]; ms: number } | null = null
  // Acciones llegadas antes de que el controlador se enganche (el tablero tarda
  // un frame en montarse): no se pierde ninguna.
  const buffered: Action[] = []
  let started = false
  /** Acciones ya entregadas: descarta los duplicados de una reconexión. */
  let seen = 0

  const send = (m: ClientMessage): void => {
    if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(m))
  }

  const open = (): void => {
    if (closed) return
    h.onStatus(attempt === 0 ? 'connecting' : 'reconnecting')
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:'
    const qs = hostTicket && attempt === 0 ? `?ticket=${encodeURIComponent(hostTicket)}` : ''
    ws = new WebSocket(`${proto}//${location.host}/api/room/${code}/ws${qs}`)

    ws.onopen = () => {
      attempt = 0
      h.onStatus('open')
      send({ t: 'join', name, token })
    }
    ws.onmessage = (ev) => handle(JSON.parse(String(ev.data)) as ServerMessage)
    ws.onclose = () => {
      if (closed) return
      // La sala guarda el asiento por token, así que reconectar recupera la
      // partida entera: el servidor reenvía el log al volver a entrar.
      if (attempt >= RETRY_MS.length) {
        const msg = t('net.error.dropped')
        if (onNetClose) onNetClose(msg)
        else h.onDead(msg)
        return
      }
      const wait = RETRY_MS[attempt]!
      attempt++
      retryTimer = setTimeout(open, wait)
    }
  }

  const handle = (m: ServerMessage): void => {
    switch (m.t) {
      case 'lobby':
        h.onLobby({ code: m.code, you: m.you, host: m.host, seats: m.seats, taken: m.taken })
        return

      case 'start': {
        if (started) return // reconexión a media partida: el tablero ya está
        started = true
        seen = m.seq
        // Si la sala ya tenía historia (reconexión, o entrar tarde), se
        // reconstruye con el mismo `replay` del guardado local en vez de
        // reproducir las jugadas por pantalla: nadie quiere ver otra vez las
        // pantallas de victoria de las manos anteriores.
        const resume = hasActions(m.log)
          ? { game: replay(m.log), log: m.log, botSeed: m.botSeed, difficulty: m.difficulty }
          : null
        h.onStart(
          makeNetGame(m.you, m.seed, m.rules, m.botSeed, m.difficulty, m.players),
          m.roster,
          resume,
        )
        return
      }

      case 'action':
        // `seq` es acumulativo: tras reconectar el servidor reenvía desde el
        // principio y aquí se ignora lo ya visto.
        if (m.seq <= seen) return
        seen = m.seq
        if (onAction) onAction(m.action)
        else buffered.push(m.action)
        return

      case 'deadline':
        // Puede llegar antes de que el tablero se enganche (justo tras 'start'):
        // se guarda y se entrega en cuanto haya quien lo escuche.
        if (onDeadline) onDeadline(m.seats, m.ms)
        else pendingDeadline = { seats: m.seats, ms: m.ms }
        return

      case 'handend':
        if (onHandEnd) onHandEnd(m.waiting, m.ms)
        else pendingHandEnd = { waiting: m.waiting, ms: m.ms }
        return

      case 'error':
        h.onError(m.code)
        return
    }
  }

  const makeNetGame = (
    seat: Seat,
    seed: number,
    rules: RuleSet,
    botSeed: number,
    difficulty: Difficulty,
    players: (string | null)[],
  ): NetGame => ({
    seat,
    seed,
    rules,
    botSeed,
    difficulty,
    players,
    onAction(cb) {
      onAction = cb
      // lo que llegó mientras el tablero se montaba
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
    ready() {
      send({ t: 'ready' })
    },
    onClose(cb) {
      onNetClose = cb
    },
    send(a, seq) {
      send({ t: 'intent', seq, action: a })
    },
    close() {
      closeAll()
    },
  })

  const closeAll = (): void => {
    closed = true
    if (retryTimer !== null) clearTimeout(retryTimer)
    retryTimer = null
    if (ws) {
      ws.onclose = null
      try { ws.close(1000, 'leave') } catch { /* ya cerrado */ }
    }
    ws = null
  }

  open()

  return {
    pick: (characterId) => send({ t: 'pick', characterId }),
    begin: (rules, difficulty) => send({ t: 'start', rules, difficulty }),
    close: closeAll,
  }
}

function hasActions(log: GameLog): boolean {
  return log.hands.some((h) => h.length > 0)
}
