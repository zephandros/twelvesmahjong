// Puntuación de una victoria: prueba todas las interpretaciones de la mano
// (estándar × colocaciones de la ganadora, chiitoi, kokushi), aplica yaku,
// dora y fu, y elige la de más puntos. Devuelve null si no hay ningún yaku:
// esa mano no puede ganar (el dora solo no habilita la victoria).
//
// Decisiones de regla (documentadas):
//  - Sin kiriage mangan (30fu/4han = 7700, no se redondea a mangan).
//  - Kazoe yakuman a partir de 13 han.
//  - Honba: +300 en ron, +100 por cabeza en tsumo. Palos de riichi al ganador.

import { doraFromIndicator, isAka, tile34Of } from './tile'
import { countsOf } from './shanten'
import type { WinContext } from './win'
import { decompose, allTile34s, allTileIds } from './win'
import type { YakuHit } from './yaku'
import {
  isMenzen, situationalYaku, standardYaku, chiitoiYaku, kokushiYaku,
} from './yaku'
import { computeFu, CHIITOI_FU } from './fu'
import { DEFAULT_RULES } from './rules-config'

export type Limit =
  | 'mangan' | 'haneman' | 'baiman' | 'sanbaiman' | 'yakuman' | 'kazoe'

export interface WinScore {
  readonly yaku: readonly YakuHit[]
  readonly han: number
  readonly fu: number
  /** Nº de yakuman apilados (0 = mano normal). */
  readonly yakuman: number
  readonly limit: Limit | null
  readonly basePoints: number
  /** Total que recibe el ganador, con honba y palos de riichi. */
  readonly total: number
  /** Ron: pago del que descartó (sin palos). */
  readonly ron?: number
  /** Tsumo de no-oya: pago del oya / de cada uno de los otros dos. */
  readonly fromDealer?: number
  readonly fromEach?: number
}

const ceil100 = (x: number): number => Math.ceil(x / 100) * 100

/** Puntos base según han/fu, con límites. `yakuman` > 0 ignora han/fu. */
export function basePoints(han: number, fu: number, yakuman = 0): number {
  if (yakuman > 0) return 8000 * yakuman
  if (han >= 13) return 8000
  if (han >= 11) return 6000
  if (han >= 8) return 4000
  if (han >= 6) return 3000
  if (han >= 5) return 2000
  return Math.min(fu * 2 ** (2 + han), 2000)
}

export function limitOf(han: number, fu: number, yakuman: number): Limit | null {
  if (yakuman > 0) return 'yakuman'
  if (han >= 13) return 'kazoe'
  if (han >= 11) return 'sanbaiman'
  if (han >= 8) return 'baiman'
  if (han >= 6) return 'haneman'
  if (han >= 5) return 'mangan'
  return fu * 2 ** (2 + han) > 2000 ? 'mangan' : null
}

// --- dora ---------------------------------------------------------------------

function doraHits(ctx: WinContext): YakuHit[] {
  const tiles = allTile34s(ctx)
  const hits: YakuHit[] = []

  const countMatches = (indicators: readonly number[]): number => {
    let n = 0
    for (const ind of indicators) {
      const d = doraFromIndicator(tile34Of(ind))
      for (const t of tiles) if (t === d) n++
    }
    return n
  }

  const dora = countMatches(ctx.doraIndicators)
  if (dora > 0) hits.push({ id: 'dora', han: dora })

  if (ctx.riichi > 0) {
    const ura = countMatches(ctx.uraIndicators)
    if (ura > 0) hits.push({ id: 'ura', han: ura })
  }

  const aka = (ctx.rules ?? DEFAULT_RULES).aka
    ? allTileIds(ctx).filter(isAka).length
    : 0
  if (aka > 0) hits.push({ id: 'aka', han: aka })

  return hits
}

// --- formas especiales -----------------------------------------------------------

function isChiitoiForm(ctx: WinContext): boolean {
  if (ctx.melds.length > 0) return false
  const counts = countsOf(allTile34s(ctx))
  let pairs = 0
  for (const n of counts) {
    if (n === 2) pairs++
    else if (n !== 0) return false
  }
  return pairs === 7
}

const TH = [0, 8, 9, 17, 18, 26, 27, 28, 29, 30, 31, 32, 33]

function isKokushiForm(ctx: WinContext): boolean {
  if (ctx.melds.length > 0) return false
  const counts = countsOf(allTile34s(ctx))
  let kinds = 0
  let hasPair = false
  for (let t = 0; t < 34; t++) {
    const n = counts[t]!
    if (n > 0 && !TH.includes(t)) return false
    if (n > 0) kinds++
    if (n >= 2) hasPair = true
  }
  return kinds === 13 && hasPair
}

// --- evaluación de variantes ------------------------------------------------------

interface Variant {
  yaku: YakuHit[]
  han: number
  fu: number
  yakuman: number
}

function evalVariant(
  ctx: WinContext,
  form: { yakuman: YakuHit[]; normal: YakuHit[] },
  fu: number,
): Variant | null {
  const menzen = isMenzen(ctx)
  const sit = situationalYaku(ctx, menzen)
  const yakumanHits = [...sit.yakuman, ...form.yakuman]

  if (yakumanHits.length > 0) {
    return {
      yaku: yakumanHits,
      han: 13 * yakumanHits.length,
      fu: 0,
      yakuman: yakumanHits.length,
    }
  }

  const base = [...sit.normal, ...form.normal]
  if (base.length === 0) return null // sin yaku no hay victoria

  const withDora = [...base, ...doraHits(ctx)]
  const han = withDora.reduce((s, y) => s + y.han, 0)
  return { yaku: withDora, han, fu, yakuman: 0 }
}

/** Compara variantes: más puntos primero; a igualdad, más han y luego más fu. */
function better(a: Variant, b: Variant): boolean {
  const pa = basePoints(a.han, a.fu, a.yakuman)
  const pb = basePoints(b.han, b.fu, b.yakuman)
  if (pa !== pb) return pa > pb
  if (a.han !== b.han) return a.han > b.han
  return a.fu > b.fu
}

// --- entrada principal --------------------------------------------------------------

export function scoreWin(ctx: WinContext): WinScore | null {
  const menzen = isMenzen(ctx)
  const variants: Variant[] = []

  if (isKokushiForm(ctx)) {
    const v = evalVariant(ctx, kokushiYaku(), 0)
    if (v) variants.push(v)
  }
  if (isChiitoiForm(ctx)) {
    const v = evalVariant(ctx, chiitoiYaku(ctx), CHIITOI_FU)
    if (v) variants.push(v)
  }
  for (const d of decompose(ctx)) {
    const form = standardYaku(ctx, d, menzen)
    const pinfu = form.normal.some((y) => y.id === 'pinfu')
    const v = evalVariant(ctx, form, computeFu(ctx, d, menzen, pinfu))
    if (v) variants.push(v)
  }

  if (variants.length === 0) return null

  let best = variants[0]!
  for (const v of variants.slice(1)) if (better(v, best)) best = v

  return { ...best, ...payments(ctx, best) }
}

function payments(
  ctx: WinContext,
  v: Variant,
): Pick<WinScore, 'limit' | 'basePoints' | 'total' | 'ron' | 'fromDealer' | 'fromEach'> {
  const base = basePoints(v.han, v.fu, v.yakuman)
  const limit = limitOf(v.han, v.fu, v.yakuman)
  const sticks = ctx.riichiSticks * 1000

  if (!ctx.tsumo) {
    const ron = ceil100(base * (ctx.dealer ? 6 : 4)) + ctx.honba * 300
    return { limit, basePoints: base, ron, total: ron + sticks }
  }
  if (ctx.dealer) {
    const fromEach = ceil100(base * 2) + ctx.honba * 100
    return { limit, basePoints: base, fromEach, total: fromEach * 3 + sticks }
  }
  const fromDealer = ceil100(base * 2) + ctx.honba * 100
  const fromEach = ceil100(base) + ctx.honba * 100
  return {
    limit, basePoints: base, fromDealer, fromEach,
    total: fromDealer + fromEach * 2 + sticks,
  }
}
