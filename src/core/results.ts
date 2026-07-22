// Resultado final de una partida: puntos de mesa → puntos de tabla, con uma y
// oka. Puro y sin estado; la UI solo formatea.
//
// Reglas fijadas (documentadas):
//  - `raw` = (puntos − returnPoints) / 1000. La oka completa se la lleva el 1º.
//  - Empates: gana el asiento de índice menor (mismo criterio que `ranking`).
//  - Los palos de riichi que queden sobre la mesa al acabar se pierden, así que
//    la suma de totales puede quedar por debajo de la uma (comportamiento
//    estándar, no un descuadre).

import type { Seat } from './seat'
import type { RuleSet } from './rules-config'

export interface PlayerResult {
  readonly seat: Seat
  /** 1..4 */
  readonly place: number
  /** Puntos de mesa con los que acabó. */
  readonly points: number
  /** Puntos de tabla antes de bonificaciones (unidades de 1000). */
  readonly raw: number
  readonly uma: number
  /** Solo el 1º la cobra; 0 para el resto. */
  readonly oka: number
  readonly total: number
}

/** Clasificación con uma y oka aplicadas, del 1º al 4º. */
export function finalResults(
  points: readonly number[],
  rules: RuleSet,
): PlayerResult[] {
  const order = ([0, 1, 2, 3] as Seat[]).sort(
    (a, b) => points[b]! - points[a]! || a - b,
  )
  const oka = ((rules.returnPoints - rules.startPoints) * 4) / 1000

  return order.map((seat, i) => {
    const raw = (points[seat]! - rules.returnPoints) / 1000
    const uma = rules.uma[i] ?? 0
    const own = i === 0 ? oka : 0
    return { seat, place: i + 1, points: points[seat]!, raw, uma, oka: own, total: raw + uma + own }
  })
}
