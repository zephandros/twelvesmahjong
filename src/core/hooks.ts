// Puntos de intercepción para habilidades (能力) al estilo Saki Portable.
// v1 juega riichi estricto: todos son no-op. Añadir una habilidad más adelante
// es implementar un `Ability`, no refactorizar el motor. Deben ser funciones
// puras de (state, rng) para no romper determinismo ni replays.

import type { TileId } from './tile'
import type { Rng } from './rng'
import type { Seat } from './seat'
import type { HandState } from './state'
import type { WinScore } from './score'

export interface Ability {
  /** Reordena/altera el muro recién construido (antes del reparto). */
  onBuildWall?(wall: TileId[], rng: Rng): TileId[]
  /**
   * Sustituye el robo normal: devuelve el TileId que este asiento roba en su
   * lugar (debe existir en el muro vivo). `null` = robo normal.
   */
  beforeDraw?(state: HandState, seat: Seat): TileId | null
  /** Fuerza/permite una reacción en una oportunidad de llamada. `null` = normal. */
  onCallOpportunity?(state: HandState, seat: Seat): null
  /** Transforma el resultado de una victoria (p. ej. multiplicadores). */
  onWin?(state: HandState, win: WinScore): WinScore
}

/** Habilidades por asiento. Ausencia = sin habilidad. */
export type Abilities = Partial<Record<Seat, Ability>>

export const NO_ABILITIES: Abilities = {}
