// Estadísticas: las funciones de suma son puras, así que se prueban sin DOM.
// El estado de mano se construye a través del reducer (rig) para que lo que se
// cuenta sea exactamente lo que produce el motor.

import { describe, it, expect, beforeEach } from 'vitest'
import { reduce } from '../src/core/reducer'
import type { HandState } from '../src/core/state'
import { finalResults } from '../src/core/results'
import { DEFAULT_RULES } from '../src/core/rules-config'
import {
  EMPTY_STATS, recordAction, recordHand, recordGame, averagePlace,
  loadStats, saveStats, clearStats,
} from '../src/ui/stats'
import { start, JUNK1, JUNK2, JUNK3, HERO } from './rig'

class MemStorage {
  private m = new Map<string, string>()
  getItem(k: string): string | null { return this.m.get(k) ?? null }
  setItem(k: string, v: string): void { this.m.set(k, v) }
  removeItem(k: string): void { this.m.delete(k) }
  clear(): void { this.m.clear() }
}
beforeEach(() => {
  ;(globalThis as { localStorage: Storage }).localStorage = new MemStorage() as unknown as Storage
})

/** Mano ganada por tsumo del asiento 0 (ittsu + menzen tsumo). */
function tsumoHand(): HandState {
  let { s } = start({ hands: [HERO, JUNK1, JUNK2, JUNK3], draws: ['9p', '9p', '9p', '9p', '1p'] })
  for (let i = 0; i < 4; i++) {
    s = reduce(s, { type: 'draw' })
    s = reduce(s, { type: 'discard', tile: s.drawn! })
  }
  s = reduce(s, { type: 'draw' })
  return reduce(s, { type: 'tsumo' })
}

describe('recordHand', () => {
  it('cuenta la victoria por tsumo, sus yaku y el récord', () => {
    const s = recordHand(EMPTY_STATS, tsumoHand(), 0)
    expect(s.hands).toBe(1)
    expect(s.winsTsumo).toBe(1)
    expect(s.winsRon).toBe(0)
    expect(s.dealIns).toBe(0)
    expect(s.yaku.tsumo).toBe(1)
    expect(s.yaku.ittsu).toBe(1)
    expect(s.best?.points).toBeGreaterThan(0)
  })

  it('para los demás asientos esa misma mano no suma victoria', () => {
    const s = recordHand(EMPTY_STATS, tsumoHand(), 2)
    expect(s.hands).toBe(1)
    expect(s.winsTsumo).toBe(0)
    expect(s.dealIns).toBe(0) // fue tsumo: nadie soltó la ficha
  })

  it('no muta el objeto que recibe', () => {
    const before = structuredClone(EMPTY_STATS)
    recordHand(EMPTY_STATS, tsumoHand(), 0)
    expect(EMPTY_STATS).toEqual(before)
  })

  it('el récord solo se sustituye si la mano vale más', () => {
    const hand = tsumoHand()
    const rich = { ...EMPTY_STATS, best: { points: 999999, han: 13, fu: 0, yakuman: 1 } }
    expect(recordHand(rich, hand, 0).best?.points).toBe(999999)
  })
})

describe('recordAction', () => {
  it('cuenta riichi y llamadas por separado', () => {
    let s = recordAction(EMPTY_STATS, { type: 'riichi', tile: 0 })
    s = recordAction(s, { type: 'pon', seat: 0 })
    s = recordAction(s, { type: 'ankan', tile34: 0 })
    s = recordAction(s, { type: 'discard', tile: 0 })
    expect(s.riichi).toBe(1)
    expect(s.calls).toBe(2)
  })
})

describe('recordGame', () => {
  it('suma el puesto y el resultado del humano', () => {
    const results = finalResults([40000, 30000, 20000, 10000], DEFAULT_RULES)
    const s = recordGame(EMPTY_STATS, results, 2) // seat 2 = 3º
    expect(s.games).toBe(1)
    expect(s.places).toEqual([0, 0, 1, 0])
    expect(s.totalScore).toBeCloseTo(results[2]!.total)
  })

  it('el puesto medio pondera los puestos acumulados', () => {
    const first = finalResults([40000, 30000, 20000, 10000], DEFAULT_RULES)
    const last = finalResults([10000, 30000, 20000, 40000], DEFAULT_RULES)
    let s = recordGame(EMPTY_STATS, first, 0) // 1º
    s = recordGame(s, last, 0)                // 4º
    expect(averagePlace(s)).toBe(2.5)
  })
})

describe('persistencia', () => {
  it('round-trip y saneado de un guardado corrupto', () => {
    expect(loadStats()).toEqual(EMPTY_STATS)

    const s = { ...EMPTY_STATS, games: 3, places: [1, 1, 1, 0], winsRon: 5 }
    saveStats(s)
    expect(loadStats()).toEqual(s)

    localStorage.setItem('tm-stats-v1', JSON.stringify({ games: 'muchas', places: [1, 2] }))
    const back = loadStats()
    expect(back.games).toBe(0)
    expect(back.places).toEqual([0, 0, 0, 0])

    localStorage.setItem('tm-stats-v1', '{ not json')
    expect(loadStats()).toEqual(EMPTY_STATS)

    saveStats(s)
    clearStats()
    expect(loadStats()).toEqual(EMPTY_STATS)
  })
})
