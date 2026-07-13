import { describe, it, expect } from 'vitest'
import type { Meld } from '../src/core/meld'
import { parseTile, type TileId } from '../src/core/tile'
import { meldLayout } from '../src/ui/meld-layout'

const id = (label: string, copy = 0): TileId => ((parseTile(label) << 2) | copy)

describe('meldLayout', () => {
  it('pone el chi llamado en el extremo izquierdo del dueño', () => {
    const called = id('3m')
    const m: Meld = { kind: 'chi', tiles: [called, id('1m'), id('2m')], from: 3, called }
    const slots = meldLayout(m, 0)
    expect(slots.map((s) => s.id)).toEqual([called, id('1m'), id('2m')])
    expect(slots.map((s) => s.sideways)).toEqual([true, false, false])
  })

  it('coloca el pon llamado según el asiento de origen', () => {
    const copies = [id('5p', 1), id('5p', 2), id('5p', 3)]
    const sideIndex = (from: 1 | 2 | 3): number => {
      const m: Meld = { kind: 'pon', tiles: copies, from, called: copies[0]! }
      return meldLayout(m, 0).findIndex((s) => s.sideways)
    }
    expect(sideIndex(3)).toBe(0) // kami
    expect(sideIndex(2)).toBe(1) // toimen
    expect(sideIndex(1)).toBe(2) // shimo
  })

  it('apila la ficha añadida del shouminkan sobre la llamada', () => {
    const called = id('7s')
    const added = id('7s', 3)
    const m: Meld = { kind: 'kan', tiles: [called, id('7s', 1), id('7s', 2), added], from: 1, called, added }
    const slots = meldLayout(m, 0)
    expect(slots.map((s) => s.id)).toEqual([id('7s', 1), id('7s', 2), called, added])
    expect(slots[2]).toMatchObject({ id: called, sideways: true, stack: false })
    expect(slots[3]).toMatchObject({ id: added, sideways: true, stack: true })
  })

  it('mantiene el ankan con extremos boca abajo y sin fichas giradas', () => {
    const m: Meld = { kind: 'ankan', tiles: [id('E'), id('E', 1), id('E', 2), id('E', 3)] }
    const slots = meldLayout(m, 0)
    expect(slots.map((s) => s.faceDown)).toEqual([true, false, false, true])
    expect(slots.every((s) => !s.sideways && !s.stack)).toBe(true)
  })
})
