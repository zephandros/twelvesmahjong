// Conteo de fu para una interpretación concreta de la mano.
//
// Decisiones de regla (documentadas):
//  - Par de viento doble (asiento Y ronda): +2 por cada aspecto → 4 fu.
//  - Rinshan cuenta como tsumo normal (+2).
//  - Mano abierta que queda en 20 fu con ron ("kuipinfu") → 30 fu forzados.
//  - Chiitoitsu: 25 fu fijos, sin redondeo.
//  - El trío completado por ron (shanpon) cuenta como abierto.

import { isDragon, isTerminalOrHonor } from './tile'
import type { WinContext, Decomposition, Block } from './win'

/** Fu de un trío/kan según abierto/cerrado y ficha simple/terminal-honor. */
function setFu(b: Block, tsumo: boolean): number {
  if (b.type !== 'triplet') return 0
  // el trío ganado por ron en shanpon se considera abierto
  const open = b.open || (b.wait === 'shanpon' && !tsumo)
  let fu = open ? 2 : 4
  if (isTerminalOrHonor(b.tile)) fu *= 2
  if (b.kan) fu *= 4
  return fu
}

export const CHIITOI_FU = 25

export function computeFu(
  ctx: WinContext,
  d: Decomposition,
  menzen: boolean,
  pinfu: boolean,
): number {
  if (pinfu) return ctx.tsumo ? 20 : 30

  let fu = 20
  if (menzen && !ctx.tsumo) fu += 10
  if (ctx.tsumo) fu += 2

  if (d.wait === 'kanchan' || d.wait === 'penchan' || d.wait === 'tanki') fu += 2

  const pair = d.blocks.find((b) => b.type === 'pair')!
  if (isDragon(pair.tile)) fu += 2
  if (pair.tile === ctx.seatWind) fu += 2
  if (pair.tile === ctx.roundWind) fu += 2

  for (const b of d.blocks) fu += setFu(b, ctx.tsumo)

  // kuipinfu: mano abierta, ron, sin ningún fu extra → 30 fijos
  if (fu === 20) fu = 30

  return Math.ceil(fu / 10) * 10
}
