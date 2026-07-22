// Resultado final: orden, uma, oka y conservación.

import { describe, it, expect } from 'vitest'
import { finalResults } from '../src/core/results'
import { DEFAULT_RULES, type RuleSet } from '../src/core/rules-config'

const rules = (over: Partial<RuleSet> = {}): RuleSet => ({ ...DEFAULT_RULES, ...over })
const sum = (ns: number[]): number => ns.reduce((a, b) => a + b, 0)

describe('finalResults', () => {
  it('ordena por puntos y rompe empates por índice de asiento', () => {
    const r = finalResults([25000, 30000, 25000, 20000], rules())
    expect(r.map((x) => x.seat)).toEqual([1, 0, 2, 3])
    expect(r.map((x) => x.place)).toEqual([1, 2, 3, 4])
  })

  it('la oka completa se la lleva el 1º y los totales suman la uma', () => {
    const r = finalResults([40000, 30000, 20000, 10000], rules())
    expect(r[0]!.oka).toBe(20) // (30000 − 25000)·4 / 1000
    expect(r.slice(1).every((x) => x.oka === 0)).toBe(true)
    // uma simétrica + oka: los 100.000 de la mesa se reparten a suma cero
    expect(sum(r.map((x) => x.total))).toBeCloseTo(0)
  })

  it('aplica la uma por puesto', () => {
    const r = finalResults([40000, 30000, 20000, 10000], rules({ uma: [30, 10, -10, -30] }))
    expect(r.map((x) => x.uma)).toEqual([30, 10, -10, -30])
  })

  it('sin oka (retorno = inicio) el total es puntos + uma', () => {
    const r = finalResults([40000, 30000, 20000, 10000], rules({ returnPoints: 25000 }))
    expect(r[0]!.oka).toBe(0)
    expect(r[0]!.total).toBe(15 + 15)
  })

  it('los palos de riichi perdidos sobre la mesa no descuadran el reparto', () => {
    // 99.000 en manos: falta un palo. La suma queda 1 punto de tabla por debajo.
    const r = finalResults([40000, 29000, 20000, 10000], rules())
    expect(sum(r.map((x) => x.total))).toBeCloseTo(-1)
  })
})
