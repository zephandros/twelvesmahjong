import { describe, it, expect } from 'vitest'
import { initHand } from '../src/core/state'
import { reduce } from '../src/core/reducer'
import { computePlacements } from '../src/ui/geometry'
import { parseTile, TILEID_COUNT, type TileId } from '../src/core/tile'
import { BOARD, STAGE_W, STAGE_H } from '../src/ui/layout'

const opts = {
  human: 0 as const,
  revealAll: false,
  clickable: new Set<number>(),
  highlight: new Set<number>(),
  dim: new Set<number>(),
  flash: new Set<number>(),
}

const id = (label: string, copy = 0): TileId => ((parseTile(label) << 2) | copy)

function stateForMelds() {
  const s = initHand(42, 0)
  for (const st of s.seats) {
    st.hand = []
    st.melds = []
    st.pond = []
  }
  s.drawn = null
  return s
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
    expect(pond.cy).toBeCloseTo(660, 5)
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

  it('marca flash solo en las fichas pedidas', () => {
    const s = initHand(42, 0)
    const target = s.seats[0]!.hand[0]!
    const other = s.seats[0]!.hand[1]!
    const p = computePlacements(s, { ...opts, flash: new Set([target]) })
    expect(p.get(target)!.flash).toBe(true)
    expect(p.get(other)!.flash).toBe(false)
  })

  it('gira la ficha llamada del pon y la coloca en el extremo del origen', () => {
    const called = id('5p', 1)
    const a = id('5p', 2)
    const b = id('5p', 3)
    const s = stateForMelds()
    s.seats[0]!.melds = [{ kind: 'pon', tiles: [called, a, b], from: 1, called }]

    const p = computePlacements(s, opts)
    const calledP = p.get(called)!
    expect(calledP.rot).toBe(90)
    expect(calledP.cy).toBeCloseTo(BOARD.y + BOARD.h - 45 / 2, 5)
    expect(calledP.cx).toBeGreaterThan(p.get(a)!.cx)
    expect(calledP.cx).toBeGreaterThan(p.get(b)!.cx)
    expect(p.get(a)!.rot).toBe(0)
  })

  it.each([
    { seat: 1 as const, from: 0 as const, edge: 'derecho' },
    { seat: 3 as const, from: 0 as const, edge: 'izquierdo' },
  ])('coloca el meld rival del borde $edge dentro de la mesa', ({ seat, from }) => {
    const called = id('5p', 1)
    const a = id('5p', 2)
    const b = id('5p', 3)
    const tiles = [called, a, b]
    const s = stateForMelds()
    s.seats[seat]!.melds = [{ kind: 'pon', tiles, from, called }]

    const p = computePlacements(s, opts)
    for (const tile of tiles) {
      const placement = p.get(tile)!
      expect(placement.visible).toBe(true)
      expect(placement.cx).toBeGreaterThan(BOARD.x)
      expect(placement.cx).toBeLessThan(BOARD.x + BOARD.w)
    }
  })

  it('la ficha de riichi girada queda a ras de sus vecinas en el pond', () => {
    const s = stateForMelds()
    const st = s.seats[0]!
    st.pond = [id('1m'), id('2m'), id('3m'), id('4m')]
    st.riichiIndex = 2

    const p = computePlacements(s, opts)
    const prev = p.get(id('2m'))!
    const riichi = p.get(id('3m'))!
    const next = p.get(id('4m'))!
    expect(riichi.rot).toBe(90)
    // girada ocupa 60px en la dirección de llenado: bordes a ras por ambos lados
    expect(riichi.cx - 60 / 2).toBeCloseTo(prev.cx + 45 / 2, 5)
    expect(riichi.cx + 60 / 2).toBeCloseTo(next.cx - 45 / 2, 5)
  })

  it('apila la ficha añadida del shouminkan sobre la llamada', () => {
    const called = id('7s')
    const a = id('7s', 1)
    const b = id('7s', 2)
    const added = id('7s', 3)
    const s = stateForMelds()
    s.seats[0]!.melds = [{ kind: 'kan', tiles: [called, a, b, added], from: 1, called, added }]

    const p = computePlacements(s, opts)
    const calledP = p.get(called)!
    const addedP = p.get(added)!
    expect(addedP.rot).toBe(calledP.rot)
    expect(addedP.cx).toBeCloseTo(calledP.cx, 5)
    expect(addedP.cy).toBeCloseTo(calledP.cy - 45, 5)
    expect(addedP.z).toBeGreaterThan(calledP.z)
  })
})
