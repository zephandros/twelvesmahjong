import { describe, it, expect } from 'vitest'
import type { Tile34, TileId } from '../src/core/tile'
import { parseTile, label34 } from '../src/core/tile'
import type { Meld } from '../src/core/meld'
import type { WinContext } from '../src/core/win'
import { scoreWin } from '../src/core/score'
import { YAKU_EXAMPLES, parseExample, type YakuExample } from '../src/ui/yaku-examples'
import { YAKU_GLOSSARY } from '../src/ui/yaku-info'

// ============================================================================
// Las manos de ejemplo del glosario son datos a mano; aquí el motor las
// certifica una a una: cada mano debe ser una victoria válida que contenga el
// yaku que ilustra (presencia, no exclusividad: toitoi arrastra sanankou, etc.)
// ============================================================================

const AKA_TYPES = new Set([4, 13, 22])

/**
 * Asigna TileIds con contador de copias compartido por toda la mano.
 * Para 5m/5p/5s reparte 1,2,3 y deja la aka (copia 0) para la 4.ª — solo los
 * kans de cincos la incluyen; la dora extra que aporte es invisible al test.
 */
function makeTake(): (t: Tile34) => TileId {
  const next: Record<number, number> = {}
  return (t) => {
    const k = next[t] ?? 0
    if (k > 3) throw new Error(`más de 4 copias de ${label34(t)}`)
    next[t] = k + 1
    return (t << 2) | (AKA_TYPES.has(t) ? (k + 1) % 4 : k)
  }
}

/** Monta el WinContext de un ejemplo: ankan como melds, win separada. */
function ctxOf(ex: YakuExample): WinContext {
  const groups = parseExample(ex)
  const winT = parseTile(ex.win)
  const rest = groups.filter((g) => !g.kan).flatMap((g) => [...g.tiles])
  const wi = rest.indexOf(winT)
  expect(wi, `win ${ex.win} ausente de la mano de ${ex.id}`).toBeGreaterThanOrEqual(0)
  rest.splice(wi, 1)

  const take = makeTake()
  const melds: Meld[] = groups
    .filter((g) => g.kan)
    .map((g) => ({ kind: 'ankan', tiles: g.tiles.map(take) }))
  const concealed = rest.map(take)
  const winTile = take(winT)
  expect(concealed.length, `tamaño de mano de ${ex.id}`).toBe(13 - 3 * melds.length)

  return {
    concealed,
    winTile,
    melds,
    tsumo: ex.tsumo ?? false,
    dealer: false,
    seatWind: parseTile('2z'),
    roundWind: parseTile('1z'),
    riichi: 0,
    ippatsu: false,
    doraIndicators: [],
    uraIndicators: [],
    honba: 0,
    riichiSticks: 0,
    haitei: false,
    houtei: false,
    rinshan: false,
    chankan: false,
    tenhou: false,
    chiihou: false,
  }
}

describe('glosario: manos de ejemplo certificadas por el motor', () => {
  for (const ex of YAKU_EXAMPLES.values()) {
    it(`${ex.id}: ${ex.hand} + ${ex.win}`, () => {
      const r = scoreWin(ctxOf(ex))
      expect(r, `la mano de ${ex.id} no es una victoria válida`).not.toBeNull()
      expect(r!.yaku.map((y) => y.id)).toContain(ex.id)
    })
  }

  it('cobertura: forma y yakuman con ejemplo (salvo tenhou/chiihou); resto sin él', () => {
    const exempt = new Set(['tenhou', 'chiihou'])
    for (const info of YAKU_GLOSSARY) {
      const wants =
        (info.section === 'form' || info.section === 'yakuman') && !exempt.has(info.id)
      expect(YAKU_EXAMPLES.has(info.id), info.id).toBe(wants)
    }
  })

  it('estructural: ningún ejemplo excede 4 copias de una ficha', () => {
    for (const ex of YAKU_EXAMPLES.values()) {
      const seen: Record<number, number> = {}
      for (const g of parseExample(ex)) {
        for (const t of g.tiles) {
          seen[t] = (seen[t] ?? 0) + 1
          expect(seen[t], `${ex.id}: ${label34(t)}`).toBeLessThanOrEqual(4)
        }
      }
    }
  })
})
