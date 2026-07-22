// Reglamento configurable: aka, kuitan y puntos iniciales.
//
// El caso de aka va A TRAVÉS DEL REDUCER a propósito: `WinContext.rules` es
// opcional (para que los contextos a mano de score.test.ts sigan compilando),
// así que un olvido en `winContextFor` no daría error de tipos — solo este test
// lo pilla.

import { describe, it, expect } from 'vitest'
import { reduce } from '../src/core/reducer'
import { initHand } from '../src/core/state'
import { scoreWin } from '../src/core/score'
import type { WinContext } from '../src/core/win'
import { parseTile } from '../src/core/tile'
import type { TileId } from '../src/core/tile'
import { DEFAULT_RULES, type RuleSet } from '../src/core/rules-config'
import { start, JUNK1, JUNK2, JUNK3 } from './rig'

const withRules = (over: Partial<RuleSet>): RuleSet => ({ ...DEFAULT_RULES, ...over })

// Mano de ittsu de man con el 5m ROJO, esperando 1p/4p.
const HERO_AKA = '123406789m1234p'

function tsumoYaku(rules: RuleSet): string[] {
  // una vuelta completa de tsumogiri antes de ganar: si el oya ganase en su
  // primer robo sería tenhou, y un yakuman no cuenta dora (el test no probaría nada)
  let { s } = start(
    { hands: [HERO_AKA, JUNK1, JUNK2, JUNK3], draws: ['9p', '9p', '9p', '9p', '1p'] },
    0,
    rules,
  )
  for (let i = 0; i < 4; i++) {
    s = reduce(s, { type: 'draw' })
    s = reduce(s, { type: 'discard', tile: s.drawn! })
  }
  s = reduce(s, { type: 'draw' })
  s = reduce(s, { type: 'tsumo' })
  const end = s.end!
  if (end.type !== 'tsumo') throw new Error('no ganó por tsumo')
  return end.score.yaku.map((y) => y.id)
}

describe('reglamento: aka dora', () => {
  it('con aka activado el cinco rojo aporta su han', () => {
    expect(tsumoYaku(withRules({ aka: true }))).toContain('aka')
  })

  it('con aka desactivado el cinco rojo no aporta nada', () => {
    expect(tsumoYaku(withRules({ aka: false }))).not.toContain('aka')
  })
})

// --- kuitan -----------------------------------------------------------------

const ids = (notation: string): TileId[] => {
  const out: TileId[] = []
  const next: Record<number, number> = {}
  let digits = ''
  for (const ch of notation) {
    if (ch >= '0' && ch <= '9') { digits += ch; continue }
    for (const d of digits) {
      const t = parseTile(`${d}${ch}`)
      const k = next[t] ?? 1 // copia 1: nunca la aka
      out.push((t << 2) | k)
      next[t] = k + 1
    }
    digits = ''
  }
  return out
}

/** Tanyao abierto puro: un pon de 3p y el resto simples; gana por ron. */
function openTanyao(rules: RuleSet): WinContext {
  return {
    concealed: ids('234m567m45s44s'),
    winTile: ids('6s')[0]!,
    melds: [{ kind: 'pon', tiles: ids('333p'), from: 1, called: ids('3p')[0]! }],
    tsumo: false,
    seatWind: 27,
    roundWind: 27,
    riichi: 0,
    ippatsu: false,
    doraIndicators: [],
    uraIndicators: [],
    haitei: false,
    houtei: false,
    rinshan: false,
    chankan: false,
    tenhou: false,
    chiihou: false,
    dealer: false,
    honba: 0,
    riichiSticks: 0,
    rules,
  }
}

describe('reglamento: kuitan', () => {
  it('con kuitan el tanyao abierto vale y la mano puede ganar', () => {
    const sc = scoreWin(openTanyao(withRules({ kuitan: true })))
    expect(sc?.yaku.map((y) => y.id)).toContain('tanyao')
  })

  it('sin kuitan esa misma mano se queda sin yaku y no puede ganar', () => {
    expect(scoreWin(openTanyao(withRules({ kuitan: false })))).toBeNull()
  })

  it('sin kuitan el tanyao cerrado sigue valiendo', () => {
    const closed: WinContext = { ...openTanyao(withRules({ kuitan: false })), melds: [] }
    const ctx: WinContext = { ...closed, concealed: ids('234m567m234p45s44s') }
    expect(scoreWin(ctx)?.yaku.map((y) => y.id)).toContain('tanyao')
  })
})

describe('reglamento: puntos iniciales', () => {
  it('initHand reparte los puntos del reglamento', () => {
    const s = initHand(1, 0, {}, { rules: withRules({ startPoints: 30000 }) })
    expect(s.seats.map((st) => st.points)).toEqual([30000, 30000, 30000, 30000])
  })

  it('sin reglamento explícito usa DEFAULT_RULES', () => {
    expect(initHand(1, 0).rules).toBe(DEFAULT_RULES)
    expect(initHand(1, 0).seats[0]!.points).toBe(25000)
  })
})
