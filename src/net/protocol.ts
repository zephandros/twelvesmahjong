// Protocolo de multijugador. Vive en src/net/ y NO en worker/ ni en ui/ porque
// lo comparten los dos lados: el Durable Object lo importa para construir los
// mensajes y ui/net.ts para leerlos. Solo tipos y constantes; cero lógica y
// cero dependencias de plataforma.

import type { Action } from '../core/actions'
import type { Seat } from '../core/seat'
import type { RuleSet } from '../core/rules-config'
import type { CharacterId } from '../ai/roster'
import type { Difficulty } from '../ai/profiles'
import type { GameLog } from '../core/replay'

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

/** Caducidad de la sala, recalculada en cada evento (ms). */
export const ROOM_TTL = {
  /** Lobby con menos de dos jugadores: nadie viene, se recoge pronto. */
  empty: 5 * 60_000,
  /** Lobby con gente, o partida sin nadie conectado. */
  idle: 30 * 60_000,
}

/** Higiene por conexión: no fiarse del cliente. */
export const LIMITS = {
  /** Tamaño máximo de un mensaje entrante. */
  messageBytes: 4096,
  /** Mensajes por segundo antes de cerrar el socket por inundación. */
  messagesPerSecond: 20,
}

export interface PlayerView {
  name: string
  characterId: CharacterId | null
  connected: boolean
  /** El árbitro está jugando por él (bot de relleno, o humano ausente). */
  auto: boolean
}

// --- servidor → cliente ---------------------------------------------------------

export type ServerMessage =
  /** Estado del lobby. Se reenvía entero en cada cambio: son cuatro asientos. */
  | {
      t: 'lobby'
      code: string
      you: Seat
      host: boolean
      seats: (PlayerView | null)[]
      /** Personajes ya cogidos por otro (la selección los bloquea). */
      taken: CharacterId[]
    }
  /** La partida arranca (o se reanuda tras reconectar). */
  | {
      t: 'start'
      you: Seat
      seed: number
      botSeed: number
      rules: RuleSet
      difficulty: Difficulty
      roster: CharacterId[]
      /**
       * Nombre del jugador de cada asiento; null = lo lleva la IA. El personaje
       * y la persona son cosas distintas: el panel del tablero enseña los dos.
       */
      players: (string | null)[]
      /** Todo lo jugado hasta ahora: al reconectar se reproduce sin pedir nada. */
      log: GameLog
      seq: number
    }
  /** Una acción aceptada por el árbitro. `seq` = cuántas van, contando esta. */
  | { t: 'action'; seq: number; action: Action }
  /**
   * A quién se espera y cuánto queda, para pintar el reloj.
   *
   * `ms` es una DURACIÓN, no una marca de tiempo: el reloj del cliente puede ir
   * desfasado respecto al del servidor, y con un plazo de 20 s ese desfase se
   * vería. Cada cliente calcula el vencimiento con su propio reloj.
   */
  | { t: 'deadline'; seats: Seat[]; ms: number }
  /**
   * La mano acabó y el árbitro espera a que todos cierren la pantalla de
   * resultados. `waiting` son los asientos que faltan por confirmar; `ms`, lo
   * que queda antes de repartir de todas formas.
   */
  | { t: 'handend'; waiting: Seat[]; ms: number }
  | { t: 'error'; code: ErrorCode }

export type ErrorCode =
  | 'no_room' // el código no corresponde a ninguna sala viva
  | 'bad_ticket' // abrir sala sin haber pasado Turnstile
  | 'room_full'
  | 'already_started'
  | 'character_taken'
  | 'not_host'
  | 'flood'
  | 'bad_message'

// --- cliente → servidor ---------------------------------------------------------

export type ClientMessage =
  /** Primer mensaje. Con `token` se recupera el asiento tras una reconexión. */
  | { t: 'join'; name: string; token?: string }
  | { t: 'pick'; characterId: CharacterId }
  /** Solo el anfitrión. Los asientos vacíos se rellenan con bots. */
  | { t: 'start'; rules: RuleSet; difficulty: Difficulty }
  /** Intención de jugada. `seq` = acciones vistas; si no cuadra, se descarta. */
  | { t: 'intent'; seq: number; action: Action }
  /** "He cerrado la pantalla de resultados": reparte cuando estemos todos. */
  | { t: 'ready' }

/**
 * Respuesta de `POST /api/room`. No trae identidad de jugador: el `token` con
 * el que se reclama un asiento lo sortea el propio cliente y lo presenta en
 * `join`; el árbitro se limita a recordar cuál fue el primero en cada asiento.
 */
export interface CreateRoomResponse {
  code: string
  /** Prueba de haber pasado Turnstile; se presenta al abrir el WebSocket. */
  hostTicket: string
}
