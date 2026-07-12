import { describe, it, expect } from 'vitest'
import { initHand } from '../src/core/state'
import { reduce } from '../src/core/reducer'
import { computePlacements } from '../src/ui/geometry'
import { TILEID_COUNT } from '../src/core/tile'
import { STAGE_W, STAGE_H } from '../src/ui/layout'

const opts = {
  human: 0 as const,
  revealAll: false,
  clickable: new Set<number>(),
  highlight: new Set<number>(),
}

describe('geometry: colocación de fichas', () => {
  it('coloca las 136 y muestra exactamente manos + dora al inicio', () => {
    const s = initHand(42, 0)
    const p = computePlacements(s, opts)
    expect(p.size).toBe(TILEID_COUNT)
    const visible = [...p.values()].filter((x) => x.visible)
    // 4 manos de 13 + 5 huecos de indicador
    expect(visible).toHaveLength(4 * 13 + 5)
    // ninguna coordenada rota y todo dentro del escenario (con margen de rotación)
    for (const x of visible) {
      expect(Number.isFinite(x.cx)).toBe(true)
      expect(Number.isFinite(x.cy)).toBe(true)
      expect(x.cx).toBeGreaterThan(0)
      expect(x.cx).toBeLessThan(STAGE_W)
      expect(x.cy).toBeGreaterThan(0)
      expect(x.cy).toBeLessThan(STAGE_H)
    }
  })

  it('la robada aparece y el descarte pasa la ficha al pond', () => {
    let s = initHand(42, 0)
    s = reduce(s, { type: 'draw' })
    const drawn = s.drawn!
    let p = computePlacements(s, opts)
    expect([...p.values()].filter((x) => x.visible)).toHaveLength(58)
    // la robada del humano va boca arriba en la fila de abajo
    const dp = p.get(drawn)!
    expect(dp.face).toBe('front')
    expect(dp.cy).toBeGreaterThan(600)

    s = reduce(s, { type: 'discard', tile: drawn })
    p = computePlacements(s, opts)
    const pond = p.get(drawn)!
    expect(pond.visible).toBe(true)
    expect(pond.face).toBe('front')
    // primer descarte propio: rejilla del pond inferior (fila 0, cerca del centro)
    expect(pond.cy).toBeCloseTo(398 + 21, 5)
  })

  it('el indicador de dora revelado va boca arriba; los demás huecos boca abajo', () => {
    const s = initHand(7, 0)
    const p = computePlacements(s, opts)
    const base = 4 - s.wall.rinshanDrawn
    const shown = p.get(s.wall.dead[base]!)!
    expect(shown.face).toBe('front')
    for (let i = 1; i < 5; i++) {
      expect(p.get(s.wall.dead[base + i]!)!.face).toBe('back')
    }
  })

  it('revealAll pone las manos rivales boca arriba', () => {
    const s = initHand(42, 0)
    const p = computePlacements(s, { ...opts, revealAll: true })
    for (const seat of [1, 2, 3]) {
      for (const id of s.seats[seat]!.hand) {
        expect(p.get(id)!.face).toBe('front')
      }
    }
  })
})
