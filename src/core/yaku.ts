// Catálogo de yaku. Cada evaluación recibe una interpretación concreta de la
// mano (descomposición con espera) más el contexto; score.ts prueba todas las
// interpretaciones y se queda con la mejor.
//
// Decisiones de regla (documentadas, estilo Tenhou salvo indicación):
//  - kuitan permitido (tanyao abierto).
//  - Yakuman siempre sencillos (sin dobles por suuankou tanki, kokushi 13
//    lados ni junsei chuuren), pero yakuman distintos APILAN (p. ej.
//    tsuuiisou + daisangen).
//  - Con yakuman no cuentan ni yaku normales ni dora.

import type { Tile34 } from './tile'
import { isDragon, isWind, isHonor, isTerminalOrHonor, label34 } from './tile'
import type { WinContext, Decomposition, Block } from './win'
import { allTile34s } from './win'

export interface YakuHit {
  readonly id: string
  readonly name: string
  readonly han: number
  readonly yakuman?: true
}

const isTerminal = (t: Tile34): boolean => t < 27 && (t % 9 === 0 || t % 9 === 8)
/** Corrida [t..t+2] que toca 1 o 9. */
const runHasTerminal = (t: Tile34): boolean => t % 9 === 0 || t % 9 === 6
/** Fichas "verdes" de ryuuiisou: 2,3,4,6,8 de sou + hatsu. */
const GREEN = new Set<Tile34>([19, 20, 21, 23, 25, 32])

export function isMenzen(ctx: WinContext): boolean {
  return ctx.melds.every((m) => m.kind === 'ankan')
}

/** Trío cerrado a efectos de sanankou/suuankou: el completado por ron es abierto. */
function isAnkou(b: Block, tsumo: boolean): boolean {
  if (b.type !== 'triplet' || b.open) return false
  if (b.wait === 'shanpon' && !tsumo) return false
  return true
}

// --- yaku situacionales (independientes de la forma) --------------------------

export function situationalYaku(
  ctx: WinContext,
  menzen: boolean,
): { yakuman: YakuHit[]; normal: YakuHit[] } {
  const yakuman: YakuHit[] = []
  const normal: YakuHit[] = []

  if (ctx.tenhou && ctx.dealer && ctx.tsumo) {
    yakuman.push({ id: 'tenhou', name: 'Tenhou', han: 13, yakuman: true })
  }
  if (ctx.chiihou && !ctx.dealer && ctx.tsumo) {
    yakuman.push({ id: 'chiihou', name: 'Chiihou', han: 13, yakuman: true })
  }

  if (ctx.riichi === 2) normal.push({ id: 'double-riichi', name: 'Double Riichi', han: 2 })
  else if (ctx.riichi === 1) normal.push({ id: 'riichi', name: 'Riichi', han: 1 })
  if (ctx.ippatsu && ctx.riichi > 0) normal.push({ id: 'ippatsu', name: 'Ippatsu', han: 1 })
  if (ctx.tsumo && menzen) normal.push({ id: 'tsumo', name: 'Menzen Tsumo', han: 1 })
  if (ctx.haitei && ctx.tsumo) normal.push({ id: 'haitei', name: 'Haitei', han: 1 })
  if (ctx.houtei && !ctx.tsumo) normal.push({ id: 'houtei', name: 'Houtei', han: 1 })
  if (ctx.rinshan && ctx.tsumo) normal.push({ id: 'rinshan', name: 'Rinshan Kaihou', han: 1 })
  if (ctx.chankan && !ctx.tsumo) normal.push({ id: 'chankan', name: 'Chankan', han: 1 })

  return { yakuman, normal }
}

// --- yaku de forma estándar ----------------------------------------------------

export function standardYaku(
  ctx: WinContext,
  d: Decomposition,
  menzen: boolean,
): { yakuman: YakuHit[]; normal: YakuHit[] } {
  const yakuman: YakuHit[] = []
  const normal: YakuHit[] = []

  const blocks = d.blocks
  const sets = blocks.filter((b) => b.type !== 'pair')
  const pair = blocks.find((b) => b.type === 'pair')!
  const runs = sets.filter((b) => b.type === 'run')
  const triplets = sets.filter((b) => b.type === 'triplet')
  const ankouCount = triplets.filter((b) => isAnkou(b, ctx.tsumo)).length
  const kanCount = sets.filter((b) => b.kan).length
  const tiles = allTile34s(ctx)

  // ---- yakuman de forma ----
  if (ankouCount === 4) {
    yakuman.push({ id: 'suuankou', name: 'Suuankou', han: 13, yakuman: true })
  }
  const dragonTriplets = triplets.filter((b) => isDragon(b.tile)).length
  if (dragonTriplets === 3) {
    yakuman.push({ id: 'daisangen', name: 'Daisangen', han: 13, yakuman: true })
  }
  const windTriplets = triplets.filter((b) => isWind(b.tile)).length
  if (windTriplets === 4) {
    yakuman.push({ id: 'daisuushi', name: 'Daisuushi', han: 13, yakuman: true })
  } else if (windTriplets === 3 && isWind(pair.tile)) {
    yakuman.push({ id: 'shousuushi', name: 'Shousuushi', han: 13, yakuman: true })
  }
  if (tiles.every(isHonor)) {
    yakuman.push({ id: 'tsuuiisou', name: 'Tsuuiisou', han: 13, yakuman: true })
  }
  if (tiles.every(isTerminal)) {
    yakuman.push({ id: 'chinroutou', name: 'Chinroutou', han: 13, yakuman: true })
  }
  if (tiles.every((t) => GREEN.has(t))) {
    yakuman.push({ id: 'ryuuiisou', name: 'Ryuuiisou', han: 13, yakuman: true })
  }
  if (kanCount === 4) {
    yakuman.push({ id: 'suukantsu', name: 'Suukantsu', han: 13, yakuman: true })
  }
  if (ctx.melds.length === 0 && !tiles.some(isHonor)) {
    const suit = Math.floor(tiles[0]! / 9)
    if (tiles.every((t) => Math.floor(t / 9) === suit)) {
      const c = new Array<number>(9).fill(0)
      for (const t of tiles) c[t % 9]!++
      if (c[0]! >= 3 && c[8]! >= 3 && c.every((n) => n >= 1)) {
        yakuman.push({ id: 'chuuren', name: 'Chuuren Poutou', han: 13, yakuman: true })
      }
    }
  }
  if (yakuman.length > 0) return { yakuman, normal: [] }

  // ---- yaku normales ----

  // pinfu: menzen, 4 corridas, par no yakuhai, espera ryanmen
  const pairIsYakuhai =
    isDragon(pair.tile) || pair.tile === ctx.seatWind || pair.tile === ctx.roundWind
  if (menzen && runs.length === 4 && !pairIsYakuhai && d.wait === 'ryanmen') {
    normal.push({ id: 'pinfu', name: 'Pinfu', han: 1 })
  }

  // tanyao (kuitan permitido)
  const hasTerminalOrHonor = blocks.some((b) =>
    b.type === 'run' ? runHasTerminal(b.tile) : isTerminalOrHonor(b.tile),
  )
  if (!hasTerminalOrHonor) normal.push({ id: 'tanyao', name: 'Tanyao', han: 1 })

  // iipeiko / ryanpeiko (solo menzen)
  if (menzen) {
    const runCounts = new Map<Tile34, number>()
    for (const r of runs) runCounts.set(r.tile, (runCounts.get(r.tile) ?? 0) + 1)
    let dupPairs = 0
    for (const n of runCounts.values()) dupPairs += Math.floor(n / 2)
    if (dupPairs === 2) normal.push({ id: 'ryanpeiko', name: 'Ryanpeiko', han: 3 })
    else if (dupPairs === 1) normal.push({ id: 'iipeiko', name: 'Iipeiko', han: 1 })
  }

  // yakuhai por cada trío/kan de dragón o viento propio/de ronda
  for (const b of triplets) {
    if (isDragon(b.tile)) {
      normal.push({ id: `yakuhai-${label34(b.tile)}`, name: `Yakuhai: ${label34(b.tile)}`, han: 1 })
    }
    if (b.tile === ctx.seatWind) {
      normal.push({ id: 'yakuhai-seat', name: `Yakuhai: viento de asiento`, han: 1 })
    }
    if (b.tile === ctx.roundWind) {
      normal.push({ id: 'yakuhai-round', name: `Yakuhai: viento de ronda`, han: 1 })
    }
  }

  // sanshoku doujun / doukou
  const runRanksBySuit = [new Set<number>(), new Set<number>(), new Set<number>()]
  for (const r of runs) runRanksBySuit[Math.floor(r.tile / 9)]!.add(r.tile % 9)
  for (let rank = 0; rank <= 6; rank++) {
    if (runRanksBySuit.every((s) => s.has(rank))) {
      normal.push({ id: 'sanshoku', name: 'Sanshoku Doujun', han: menzen ? 2 : 1 })
      break
    }
  }
  const tripRanksBySuit = [new Set<number>(), new Set<number>(), new Set<number>()]
  for (const t of triplets) {
    if (t.tile < 27) tripRanksBySuit[Math.floor(t.tile / 9)]!.add(t.tile % 9)
  }
  for (let rank = 0; rank <= 8; rank++) {
    if (tripRanksBySuit.every((s) => s.has(rank))) {
      normal.push({ id: 'sanshoku-doukou', name: 'Sanshoku Doukou', han: 2 })
      break
    }
  }

  // ittsu: 123 456 789 del mismo palo
  for (let suit = 0; suit < 3; suit++) {
    const ranks = runRanksBySuit[suit]!
    if (ranks.has(0) && ranks.has(3) && ranks.has(6)) {
      normal.push({ id: 'ittsu', name: 'Ittsu', han: menzen ? 2 : 1 })
      break
    }
  }

  // toitoi / sanankou / sankantsu
  if (triplets.length === 4) normal.push({ id: 'toitoi', name: 'Toitoi', han: 2 })
  if (ankouCount === 3) normal.push({ id: 'sanankou', name: 'Sanankou', han: 2 })
  if (kanCount === 3) normal.push({ id: 'sankantsu', name: 'Sankantsu', han: 2 })

  // familia chanta: honroutou > junchan > chanta (no apilan entre sí)
  const everyBlockTH = blocks.every((b) =>
    b.type === 'run' ? runHasTerminal(b.tile) : isTerminalOrHonor(b.tile),
  )
  if (everyBlockTH) {
    if (runs.length === 0) {
      normal.push({ id: 'honroutou', name: 'Honroutou', han: 2 })
    } else if (!tiles.some(isHonor)) {
      normal.push({ id: 'junchan', name: 'Junchan', han: menzen ? 3 : 2 })
    } else {
      normal.push({ id: 'chanta', name: 'Chanta', han: menzen ? 2 : 1 })
    }
  }

  // shousangen
  if (dragonTriplets === 2 && isDragon(pair.tile)) {
    normal.push({ id: 'shousangen', name: 'Shousangen', han: 2 })
  }

  // honitsu / chinitsu
  const suits = new Set(tiles.filter((t) => t < 27).map((t) => Math.floor(t / 9)))
  if (suits.size === 1) {
    if (tiles.some(isHonor)) {
      normal.push({ id: 'honitsu', name: 'Honitsu', han: menzen ? 3 : 2 })
    } else {
      normal.push({ id: 'chinitsu', name: 'Chinitsu', han: menzen ? 6 : 5 })
    }
  }

  return { yakuman, normal }
}

// --- formas especiales -----------------------------------------------------------

/** Yaku de forma para chiitoitsu (la mano ya validada como 7 pares distintos). */
export function chiitoiYaku(ctx: WinContext): { yakuman: YakuHit[]; normal: YakuHit[] } {
  const tiles = allTile34s(ctx)
  if (tiles.every(isHonor)) {
    return {
      yakuman: [{ id: 'tsuuiisou', name: 'Tsuuiisou', han: 13, yakuman: true }],
      normal: [],
    }
  }
  const normal: YakuHit[] = [{ id: 'chiitoi', name: 'Chiitoitsu', han: 2 }]
  if (!tiles.some(isTerminalOrHonor)) normal.push({ id: 'tanyao', name: 'Tanyao', han: 1 })
  if (tiles.every(isTerminalOrHonor)) normal.push({ id: 'honroutou', name: 'Honroutou', han: 2 })
  const suits = new Set(tiles.filter((t) => t < 27).map((t) => Math.floor(t / 9)))
  if (suits.size === 1) {
    if (tiles.some(isHonor)) normal.push({ id: 'honitsu', name: 'Honitsu', han: 3 })
    else normal.push({ id: 'chinitsu', name: 'Chinitsu', han: 6 })
  }
  return { yakuman: [], normal }
}

export function kokushiYaku(): { yakuman: YakuHit[]; normal: YakuHit[] } {
  return {
    yakuman: [{ id: 'kokushi', name: 'Kokushi Musou', han: 13, yakuman: true }],
    normal: [],
  }
}
