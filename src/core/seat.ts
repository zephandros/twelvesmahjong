// ÚNICO punto de verdad del mapeo asiento ↔ viento ↔ posición en pantalla.
// El material de referencia (mockup) tiene los vientos cruzados; NADA fuera de
// este archivo debe razonar sobre orientación. Ver CLAUDE.md, trampa 1.

import type { Tile34 } from './tile'

/** Asiento absoluto en orden de turno. 0..3. El reparto decide quién es oya. */
export type Seat = 0 | 1 | 2 | 3
export const SEATS: readonly Seat[] = [0, 1, 2, 3] as const

/** Posición relativa a "yo" (el humano), en sentido de turno (antihorario). */
export type RelSeat =
  | 'self' // yo
  | 'shimo' // siguiente en jugar — a mi DERECHA
  | 'toimen' // enfrente
  | 'kami' // jugador anterior — a mi IZQUIERDA

/** Borde de la mesa donde va la MANO de cada jugador. */
export type Edge = 'bottom' | 'right' | 'top' | 'left'

/** Esquina donde va el RETRATO de cada jugador. */
export type Corner = 'bl' | 'br' | 'tr' | 'tl'

// Vientos como Tile34: E=27, S=28, W=29, N=30.
export const WIND_EAST: Tile34 = 27
export const WIND_SOUTH: Tile34 = 28
export const WIND_WEST: Tile34 = 29
export const WIND_NORTH: Tile34 = 30

/**
 * Viento de asiento. El turno va E→S→W→N en sentido antihorario, es decir cada
 * asiento siguiente (seat+1) toma el viento siguiente respecto del oya.
 */
export function seatWind(seat: Seat, dealer: Seat): Tile34 {
  const offset = (seat - dealer + 4) % 4
  return (27 + offset) as Tile34
}

export const isDealer = (seat: Seat, dealer: Seat): boolean => seat === dealer

/** Posición relativa de `seat` vista desde `self`, en orden de turno. */
export function relSeat(seat: Seat, self: Seat): RelSeat {
  const offset = (seat - self + 4) % 4
  return (['self', 'shimo', 'toimen', 'kami'] as const)[offset]!
}

/**
 * Colocación en pantalla. Con "yo" abajo y el turno antihorario, el ciclo
 * self→shimo→toimen→kami recorre los bordes bottom→right→top→left y las esquinas
 * bl→br→tr→tl. Así el retrato de cada jugador toca el borde de su propia mano.
 * (Difiere a propósito del mockup, que tiene los rótulos mal — trampa 1.)
 */
const REL_EDGE: Record<RelSeat, Edge> = {
  self: 'bottom',
  shimo: 'right',
  toimen: 'top',
  kami: 'left',
}
const REL_CORNER: Record<RelSeat, Corner> = {
  self: 'bl',
  shimo: 'br',
  toimen: 'tr',
  kami: 'tl',
}

export const edgeOf = (rel: RelSeat): Edge => REL_EDGE[rel]
export const cornerOf = (rel: RelSeat): Corner => REL_CORNER[rel]

/** Color de fondo del recuadro de viento, según tokens del plan. */
export function windColor(wind: Tile34): string {
  switch (wind) {
    case WIND_EAST: return '#c0392b'
    case WIND_SOUTH: return '#2a5f7a'
    case WIND_WEST: return '#4a4a4a'
    case WIND_NORTH: return '#1f7a45'
    default: return '#4a4a4a'
  }
}

/** Kanji del viento, para páginas de debug (la UI real traduce windName vía i18n). */
export function windKanji(wind: Tile34): string {
  return (['東', '南', '西', '北'] as const)[wind - 27] ?? '東'
}

/** Id canónico del viento; la UI lo traduce como `wind.${windName(w)}`. */
export type WindName = 'east' | 'south' | 'west' | 'north'
export function windName(wind: Tile34): WindName {
  return (['east', 'south', 'west', 'north'] as const)[wind - 27] ?? 'east'
}
