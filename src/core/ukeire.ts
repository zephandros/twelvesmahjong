// Ukeire: qué robos mejoran la mano y cuántas copias quedan disponibles.
// Es la métrica sobre la que decidirá la IA (fase 6) y la que alimenta el
// indicador de tenpai. Construido sobre shanten (memoizado).

import type { Tile34 } from './tile'
import { shanten } from './shanten'

export interface Acceptance {
  readonly tile: Tile34
  /** Copias de este tipo aún disponibles (no visibles para el jugador). */
  readonly count: number
}

export interface Ukeire {
  /** Shanten actual de la mano de 13−3·melds fichas. */
  readonly shanten: number
  /** Tipos cuyo robo reduce el shanten, con sus copias disponibles. */
  readonly accepts: readonly Acceptance[]
  /** Suma de copias disponibles de todos los tipos aceptados. */
  readonly total: number
}

/**
 * Ukeire de una mano lista para robar (13−3·melds fichas).
 * `remaining[t]` = copias de t que el jugador no ve (muro + manos ajenas);
 * si se omite, se aproxima con 4 − copias en mano.
 */
export function ukeire(
  counts: readonly number[],
  melds = 0,
  remaining?: readonly number[],
): Ukeire {
  const c = counts.slice()
  const s = shanten(c, melds)

  const accepts: Acceptance[] = []
  let total = 0
  for (let t = 0; t < 34; t++) {
    if (c[t]! >= 4) continue
    const avail = remaining ? remaining[t]! : 4 - c[t]!
    if (avail <= 0) continue
    c[t]!++
    if (shanten(c, melds) < s) {
      accepts.push({ tile: t, count: avail })
      total += avail
    }
    c[t]!--
  }
  return { shanten: s, accepts, total }
}

export interface DiscardOption {
  readonly discard: Tile34
  /** Ukeire de la mano resultante tras este descarte. */
  readonly after: Ukeire
}

/**
 * Opciones de descarte de una mano con ficha robada (14−3·melds fichas),
 * ordenadas de mejor a peor: shanten ascendente, luego ukeire descendente,
 * luego índice de ficha (desempate estable).
 */
export function discardOptions(
  counts: readonly number[],
  melds = 0,
  remaining?: readonly number[],
): DiscardOption[] {
  const c = counts.slice()
  const out: DiscardOption[] = []
  for (let t = 0; t < 34; t++) {
    if (c[t]! === 0) continue
    c[t]!--
    out.push({ discard: t, after: ukeire(c, melds, remaining) })
    c[t]!++
  }
  out.sort(
    (a, b) =>
      a.after.shanten - b.after.shanten ||
      b.after.total - a.after.total ||
      a.discard - b.discard,
  )
  return out
}
