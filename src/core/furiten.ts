// Esperas y furiten. Las tres variantes:
//  - permanente (de descarte): alguna de TUS esperas está en TU historial de
//    descartes. Se evalúa sobre el historial completo, no sobre el pond visual
//    (una ficha llamada desaparece del pond pero el furiten persiste).
//  - temporal: dejaste pasar una ficha que completaba tu mano; dura hasta tu
//    siguiente robo.
//  - de riichi: dejaste pasar una espera estando en riichi; permanente el
//    resto de la mano.
// El furiten bloquea el ron (incluido chankan) pero nunca el tsumo.

import type { Tile34 } from './tile'
import { countsOf, shanten } from './shanten'

/** Esperas reales de una mano de 13−3·melds fichas (con o sin yaku). */
export function waitsOf(hand34: readonly Tile34[], melds: number): Tile34[] {
  const c = countsOf(hand34)
  const out: Tile34[] = []
  for (let t = 0; t < 34; t++) {
    if (c[t]! >= 4) continue
    c[t]!++
    if (shanten(c, melds) === -1) out.push(t)
    c[t]!--
  }
  return out
}

export function isFuriten(
  waits: readonly Tile34[],
  discarded: readonly Tile34[],
  missedRon: boolean,
  riichiFuriten: boolean,
): boolean {
  if (missedRon || riichiFuriten) return true
  return waits.some((w) => discarded.includes(w))
}
