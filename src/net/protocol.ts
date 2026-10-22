// Modelo de datos de una sala de multijugador, y nada más: tipos y constantes.
//
// Una sala es un subárbol `rooms/{code}` de Firebase Realtime Database. No hay
// servidor de juego: el ÁRBITRO es el cliente del anfitrión (ver net/host.ts),
// que escribe el log autoritativo; los demás clientes lo reproducen
// (net/client.ts). Las Security Rules (firebase/database.rules.json) replican
// quién puede escribir qué, así que este archivo y las reglas van a la par.
//
// Vive en src/net/ y no en ui/ porque lo comparten el cliente, el árbitro y
// los tests de node: cero DOM, cero Firebase.

import type { Action } from '../core/actions'
import type { Seat } from '../core/seat'
import type { RuleSet } from '../core/rules-config'
import type { CharacterId } from '../ai/roster'
import type { Difficulty } from '../ai/profiles'
import type { GameLog } from '../core/replay'
import type { GameState } from '../core/game'

/** Plazos de decisión (ms). Vencido el plazo, el árbitro juega por el ausente. */
export const DEADLINE = {
  /** Turno: elegir descarte, o cantar tsumo/kan/riichi. */
  turn: 20_000,
  /** Reacción a un descarte ajeno: chi/pon/kan/ron o pasar. */
  reaction: 8_000,
  /** Margen extra antes de dar por ausente a quien acaba de perder la conexión. */
  grace: 5_000,
  /**
   * Fin de mano: cuánto se espera a que TODOS cierren la pantalla de
   * resultados antes de repartir la siguiente.
   *
   * Sin esta espera el árbitro repartía en cuanto acababa la mano, y quien se
   * entretuviera leyendo la pantalla de victoria perdía turnos sin verlos
   * pasar: su reloj de decisión ya corría por detrás. El tope existe para que
   * un ausente no congele la mesa.
   */
  handEnd: 15_000,
}

/** Plazos fallidos seguidos antes de dar el asiento por abandonado. */
export const ABANDON_AFTER = 3

/** Nombre visible: lo que cabe en un panel de esquina. */
export const MAX_NAME = 16

// --- el subárbol rooms/{code} -------------------------------------------------------

export type Phase = 'lobby' | 'playing' | 'done'

export interface RoomMeta {
  /** uid del anfitrión: la cuenta de Kovalt que creó la sala y hace de árbitro. */
  host: string
  phase: Phase
  /** Marca de tiempo del servidor; las reglas dejan borrar salas viejas. */
  createdAt: number
}

export interface SeatSlot {
  /** uid de Firebase del jugador; vacío en un asiento de la IA. */
  uid: string
  name: string
  characterId: CharacterId | null
  /** Asiento de relleno: nunca hubo humano. Solo lo escribe el anfitrión al empezar. */
  bot?: true
}

/** Lo que el anfitrión fija al empezar y ya no cambia. */
export interface GameSetup {
  seed: number
  botSeed: number
  rules: RuleSet
  difficulty: Difficulty
  roster: CharacterId[]
  /** Nombre de la persona de cada asiento; null = lo lleva la IA. */
  players: (string | null)[]
}

/** Una acción aceptada. `h` = índice de mano, para reconstruir `GameLog.hands`. */
export interface LogEntry {
  h: number
  a: Action
}

/**
 * "Vuelvo a llevar mi asiento": lo manda quien, dado por ausente, quiere
 * recuperar el mando sin salir y entrar de la sala. Viaja por `intents/{uid}`
 * como una jugada más (misma ruta, mismas reglas: no hace falta tocar
 * Firebase), pero no es una acción del motor y nunca entra en el log.
 */
export interface ResumeMark {
  type: 'resume'
}

/** Intención de jugada de un asiento. `seq` = acciones vistas; si no cuadra, se descarta. */
export interface Intent {
  seq: number
  a: Action | ResumeMark
}

/**
 * Reloj de decisión. `ms` es una DURACIÓN y `at` la marca del servidor al
 * escribirlo: cada cliente calcula lo que queda con su propio desfase
 * (`.info/serverTimeOffset`), así el reloj no depende de la hora de nadie.
 */
export interface Clock {
  seats: Seat[]
  ms: number
  at: number
}

/** Fin de mano: a quién se espera para repartir, y cuánto queda de gracia. */
export interface HandEndWait {
  waiting: Seat[]
  ms: number
  at: number
}

/** Rutas relativas a `rooms/{code}`. Las reglas conocen exactamente estas. */
export const PATH = {
  meta: 'meta',
  seats: 'seats',
  seat: (i: Seat): string => `seats/${i}`,
  game: 'game',
  log: 'log',
  intents: 'intents',
  intent: (uid: string): string => `intents/${uid}`,
  /** Intención rechazada por el árbitro: el cliente desbloquea su input. */
  nack: (uid: string): string => `nack/${uid}`,
  ready: 'ready',
  readyOf: (uid: string): string => `ready/${uid}`,
  presence: 'presence',
  presenceOf: (uid: string): string => `presence/${uid}`,
  clock: 'clock',
  handEnd: 'handEnd',
  /**
   * Asientos humanos que el árbitro lleva por ausencia (`Seat[]`, nunca los
   * bots de relleno). Lo escribe el árbitro; cada cliente mira si está el
   * suyo para avisar "la IA juega por ti" y ofrecer recuperar el mando.
   */
  absent: 'absent',
  /**
   * Candado de árbitro: `{ id, at }` de la INSTANCIA de `RoomHost` que lleva
   * la sala. El anfitrión puede tener la sala abierta en dos pestañas (PWA +
   * navegador, o una pestaña vieja que sobrevivió a un refresh) y cada una
   * crea su árbitro: sin candado los dos escriben en el mismo log con estados
   * distintos y lo corrompen. Gana la última en arrancar; la otra cede.
   */
  arbiter: 'arbiter',
} as const

/**
 * Clave de la entrada `n` del log. Con prefijo y relleno: ordena como número al
 * ordenar como texto, y nunca parece un índice entero (RTDB convertiría el
 * nodo en array, ver `seatsOf`).
 */
export function logKey(n: number): string {
  return `n${String(n).padStart(6, '0')}`
}

export function logIndex(key: string): number {
  return Number(key.slice(1))
}

/**
 * RTDB devuelve como ARRAY cualquier nodo cuyas claves sean 0..n casi
 * completas, y como objeto si no. Los asientos son cuatro claves 0..3, así que
 * llegan de las dos formas según cuántos estén ocupados: se normaliza aquí.
 */
export function seatsOf(raw: unknown): (SeatSlot | null)[] {
  const out: (SeatSlot | null)[] = [null, null, null, null]
  if (!raw || typeof raw !== 'object') return out
  for (const i of [0, 1, 2, 3]) {
    const v = (raw as Record<string, unknown>)[String(i)]
    if (v && typeof v === 'object' && typeof (v as SeatSlot).uid === 'string') {
      out[i] = v as SeatSlot
    }
  }
  return out
}

/** Cuatro valores, uno por asiento, pase lo que pase con la forma del nodo. */
export function fourOf<T>(raw: unknown, fallback: T): T[] {
  const out: T[] = [fallback, fallback, fallback, fallback]
  if (!raw || typeof raw !== 'object') return out
  for (const i of [0, 1, 2, 3]) {
    const v = (raw as Record<string, unknown>)[String(i)]
    if (v !== undefined && v !== null) out[i] = v as T
  }
  return out
}

/** Entradas `log/{key}` → `GameLog.hands`, agrupadas por mano y en orden. */
export function logFromEntries(
  seed: number,
  rules: RuleSet,
  entries: readonly LogEntry[],
): GameLog {
  const hands: Action[][] = [[]]
  for (const e of entries) {
    while (hands.length <= e.h) hands.push([])
    hands[e.h]!.push(e.a)
  }
  return { seed, rules, hands }
}

export function countActions(log: GameLog): number {
  let n = 0
  for (const hand of log.hands) n += hand.length
  return n
}

// --- vista del lobby --------------------------------------------------------------

export interface PlayerView {
  name: string
  characterId: CharacterId | null
  connected: boolean
}

export interface LobbyView {
  code: string
  you: Seat
  host: boolean
  /** El anfitrión está conectado (sin él no se puede empezar ni jugar). */
  hostOnline: boolean
  seats: (PlayerView | null)[]
  /** Personajes ya cogidos por otro (la selección los bloquea). */
  taken: CharacterId[]
}

export type ErrorCode =
  | 'no_room' // el código no corresponde a ninguna sala viva
  | 'room_full'
  | 'already_started'
  | 'character_taken'
  | 'not_host'
  | 'closed' // el anfitrión cerró la sala
  | 'session' // la sesión de Firebase caducó o no vale para esta sala
  | 'network'
  | 'desync' // el log llegó con huecos: el cliente corta antes que corromperse

// --- lo que ve el controlador ---------------------------------------------------

/**
 * Avisos no fatales. `host-away`: el árbitro no está y nada se mueve.
 * `autopilot`: el árbitro juega por ESTE asiento (se le dio por ausente); un
 * toque lo recupera. El primero manda si coinciden.
 */
export type Notice = 'host-away' | 'autopilot'

/** Partida reanudada desde un log (guardado local o sala con historia). */
export interface Resume {
  game: GameState
  log: GameLog
  botSeed: number
  difficulty: Difficulty
}

/**
 * Partida en red, vista desde el controlador (ui/controller.ts), que así no
 * sabe nada de Firebase: solo recibe el flujo autoritativo y manda intenciones.
 */
export interface NetGame {
  /** Asiento que juega ESTE cliente. */
  readonly seat: Seat
  readonly seed: number
  readonly rules: RuleSet
  readonly botSeed: number
  readonly difficulty: Difficulty
  /** Nombre de la persona de cada asiento; null = lo lleva la IA. */
  readonly players: readonly (string | null)[]
  /** Acciones ya aceptadas por el árbitro, en orden estricto. */
  onAction(cb: (a: Action) => void): void
  /**
   * A quién se espera y cuántos ms quedan. Alimenta la cuenta atrás de los
   * paneles: en red hay un plazo real, y si vence juega la IA por ti.
   */
  onDeadline(cb: (seats: Seat[], ms: number) => void): void
  /**
   * Fin de mano: a qué asientos se espera para repartir la siguiente, y cuánto
   * queda antes de repartir igualmente.
   */
  onHandEnd(cb: (waiting: Seat[], ms: number) => void): void
  /** Aviso no fatal en pantalla; null lo quita. */
  onNotice(cb: (notice: Notice | null) => void): void
  /** "He cerrado la pantalla de resultados." */
  ready(): void
  /** "Vuelvo a llevar mi asiento": pide al árbitro que deje de jugar por mí. */
  resume(): void
  /** La partida se acabó por el lado de la red (sala cerrada, sesión caducada). */
  onClose(cb: (code: ErrorCode) => void): void
  /** Manda una intención. `seq` = acciones vistas, para que el árbitro descarte las rancias. */
  send(a: Action, seq: number): void
  /** Intención descartada por el árbitro: toca desbloquear el input. */
  onNack(cb: () => void): void
  close(): void
}
