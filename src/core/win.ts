// Contexto de una victoria y descomposición de la mano ganadora en bloques.
// Una mano puede descomponerse de varias formas y la ficha ganadora puede
// pertenecer a distintos bloques (cambia la espera y con ella fu y yaku):
// se enumeran TODAS las variantes y score.ts se queda con la mejor.

import type { Tile34, TileId } from './tile'
import { tile34Of } from './tile'
import type { Meld } from './meld'
import { meldTile, isKan, isOpenMeld } from './meld'
import { countsOf } from './shanten'

export interface WinContext {
  /** Fichas ocultas SIN la ganadora (13 − 3·melds fichas). */
  readonly concealed: readonly TileId[]
  readonly winTile: TileId
  readonly melds: readonly Meld[]
  readonly tsumo: boolean
  /** Viento de asiento y de ronda como Tile34 (27..30). */
  readonly seatWind: Tile34
  readonly roundWind: Tile34
  /** 0 = sin riichi, 1 = riichi, 2 = double riichi. */
  readonly riichi: 0 | 1 | 2
  readonly ippatsu: boolean
  readonly doraIndicators: readonly TileId[]
  /** Solo cuenta si riichi > 0. */
  readonly uraIndicators: readonly TileId[]
  readonly haitei: boolean
  readonly houtei: boolean
  readonly rinshan: boolean
  readonly chankan: boolean
  readonly tenhou: boolean
  readonly chiihou: boolean
  readonly dealer: boolean
  readonly honba: number
  /** Palos de riichi sobre la mesa (cada uno vale 1000 para el ganador). */
  readonly riichiSticks: number
}

export type Wait = 'ryanmen' | 'kanchan' | 'penchan' | 'shanpon' | 'tanki'

export interface Block {
  readonly type: 'run' | 'triplet' | 'pair'
  /** Tipo mínimo del bloque (inicio de la corrida). */
  readonly tile: Tile34
  /** Proviene de un meld abierto (chi/pon/kan). */
  readonly open: boolean
  readonly kan: boolean
  /** Espera con la que se completó — solo en el bloque de la ficha ganadora. */
  readonly wait?: Wait
}

/** Una interpretación completa de la mano: 4 grupos + par (con melds fijos). */
export interface Decomposition {
  readonly blocks: readonly Block[]
  readonly wait: Wait
}

interface RawBlock {
  type: 'run' | 'triplet'
  tile: Tile34
}

/** Enumera pares + grupos de un conteo (todo cerrado, debe consumirse entero). */
function enumerate(counts: number[]): Array<{ pair: Tile34; sets: RawBlock[] }> {
  const out: Array<{ pair: Tile34; sets: RawBlock[] }> = []
  for (let p = 0; p < 34; p++) {
    if (counts[p]! < 2) continue
    counts[p]! -= 2
    const sets: RawBlock[] = []
    const dfs = (i: number): void => {
      while (i < 34 && counts[i] === 0) i++
      if (i === 34) {
        out.push({ pair: p, sets: sets.slice() })
        return
      }
      if (counts[i]! >= 3) {
        counts[i]! -= 3
        sets.push({ type: 'triplet', tile: i })
        dfs(i)
        sets.pop()
        counts[i]! += 3
      }
      if (i < 27 && i % 9 <= 6 && counts[i + 1]! > 0 && counts[i + 2]! > 0) {
        counts[i]!--; counts[i + 1]!--; counts[i + 2]!--
        sets.push({ type: 'run', tile: i })
        dfs(i)
        sets.pop()
        counts[i]!++; counts[i + 1]!++; counts[i + 2]!++
      }
    }
    dfs(0)
    counts[p]! += 2
  }
  return out
}

/** Espera de una corrida [t, t+1, t+2] completada con `w`. */
function runWait(t: Tile34, w: Tile34): Wait {
  if (w === t + 1) return 'kanchan'
  if (w === t + 2 && t % 9 === 0) return 'penchan' // 12 esperando 3
  if (w === t && t % 9 === 6) return 'penchan' // 89 esperando 7
  return 'ryanmen'
}

/**
 * Todas las interpretaciones (descomposición × colocación de la ganadora) de
 * una mano estándar. Vacío si la mano no forma 4 grupos + par.
 */
export function decompose(ctx: WinContext): Decomposition[] {
  const counts = countsOf([...ctx.concealed.map(tile34Of), tile34Of(ctx.winTile)])
  const w = tile34Of(ctx.winTile)

  const meldBlocks: Block[] = ctx.melds.map((m) => ({
    type: m.kind === 'chi' ? 'run' : 'triplet',
    tile: meldTile(m),
    open: isOpenMeld(m),
    kan: isKan(m),
  }))

  const out: Decomposition[] = []
  for (const { pair, sets } of enumerate(counts)) {
    // colocaciones posibles de la ficha ganadora
    const placements: Array<{ index: number | 'pair'; wait: Wait }> = []
    if (pair === w) placements.push({ index: 'pair', wait: 'tanki' })
    sets.forEach((s, i) => {
      if (s.type === 'triplet' && s.tile === w) {
        placements.push({ index: i, wait: 'shanpon' })
      } else if (s.type === 'run' && w >= s.tile && w <= s.tile + 2) {
        placements.push({ index: i, wait: runWait(s.tile, w) })
      }
    })

    for (const pl of placements) {
      const blocks: Block[] = [
        ...sets.map((s, i): Block => ({
          type: s.type,
          tile: s.tile,
          open: false,
          kan: false,
          ...(pl.index === i ? { wait: pl.wait } : {}),
        })),
        {
          type: 'pair',
          tile: pair,
          open: false,
          kan: false,
          ...(pl.index === 'pair' ? { wait: 'tanki' as const } : {}),
        },
        ...meldBlocks,
      ]
      out.push({ blocks, wait: pl.wait })
    }
  }
  return out
}

/** Los 14 tipos de la mano completa (ocultas + ganadora + melds), con repetición. */
export function allTile34s(ctx: WinContext): Tile34[] {
  return [
    ...ctx.concealed.map(tile34Of),
    tile34Of(ctx.winTile),
    ...ctx.melds.flatMap((m) => m.tiles.map(tile34Of)),
  ]
}

/** Todos los TileId de la mano (para aka dora). */
export function allTileIds(ctx: WinContext): TileId[] {
  return [...ctx.concealed, ctx.winTile, ...ctx.melds.flatMap((m) => [...m.tiles])]
}
