// Nagashi mangan: pagos, detección y su interacción con las llamadas.
//
// El muro se vacía a mano y se pide un robo: `applyDraw` con el vivo a 0 es el
// camino real al agotamiento, así que el test pasa por el reducer sin tener que
// jugar 70 turnos.

import { describe, it, expect } from 'vitest'
import { reduce } from '../src/core/reducer'
import type { HandState } from '../src/core/state'
import { parseTile, tile34Of, type TileId } from '../src/core/tile'
import { DEFAULT_RULES, type RuleSet } from '../src/core/rules-config'
import { start, JUNK1, JUNK2, JUNK3 } from './rig'

const rules = (over: Partial<RuleSet> = {}): RuleSet => ({ ...DEFAULT_RULES, ...over })

/** Cuarta mano basura: fichas sueltas, sin colisionar con JUNK1..3. */
const JUNK4 = '147258369p1478m'

/** Ids libres de un tipo (no están en ninguna mano rigged: basta con la copia 3). */
const idOf = (notation: string, copy = 3): TileId => (parseTile(notation) << 2) | copy

interface Discards {
  /** Fichas que ese asiento descartó, en orden. */
  tiles: TileId[]
  /** Nº de descartes que le llamaron (salen del pond, no del historial). */
  called?: number
}

/** Mano al borde del agotamiento con los descartes que se le indiquen. */
function exhaust(spec: Partial<Record<number, Discards>>, r: RuleSet): HandState {
  const { s } = start({ hands: [JUNK1, JUNK2, JUNK3, JUNK4], draws: [] }, 1, r)
  const base: HandState = {
    ...s,
    wall: { ...s.wall, live: [] },
    phase: 'draw',
    seats: s.seats.map((st, i) => {
      const d = spec[i]
      if (!d) return st
      return {
        ...st,
        discarded: d.tiles.map(tile34Of),
        pond: d.tiles.slice(d.called ?? 0),
      }
    }),
  }
  return reduce(base, { type: 'draw' })
}

// seis terminales/honores distintos, todos en el pond
const CLEAN = [idOf('1m'), idOf('9m'), idOf('1p'), idOf('E'), idOf('haku'), idOf('chun')]
// lo mismo con un 5m por medio: ya no es nagashi
const DIRTY = [...CLEAN.slice(0, 3), idOf('5m'), ...CLEAN.slice(3)]

describe('nagashi mangan', () => {
  it('paga como un tsumo de mangan y no aplica tenpai/noten', () => {
    // asiento 0 (ko, el oya es el 1): cobra 2000/2000 y 4000 del oya
    const s = exhaust({ 0: { tiles: CLEAN } }, rules())
    const end = s.end!
    if (end.type !== 'exhaustive') throw new Error('no fue agotamiento')
    expect(end.nagashi).toEqual([0])
    expect(end.deltas).toEqual([8000, -4000, -2000, -2000])
  })

  it('el nagashi del oya cobra 4000 de cada uno', () => {
    const s = exhaust({ 1: { tiles: CLEAN } }, rules())
    const end = s.end!
    if (end.type !== 'exhaustive') throw new Error('no fue agotamiento')
    expect(end.deltas).toEqual([-4000, 12000, -4000, -4000])
  })

  it('un descarte llamado lo invalida', () => {
    const s = exhaust({ 0: { tiles: CLEAN, called: 1 } }, rules())
    const end = s.end!
    if (end.type !== 'exhaustive') throw new Error('no fue agotamiento')
    expect(end.nagashi).toEqual([])
  })

  it('un simple entre los descartes lo invalida', () => {
    const s = exhaust({ 0: { tiles: DIRTY } }, rules())
    const end = s.end!
    if (end.type !== 'exhaustive') throw new Error('no fue agotamiento')
    expect(end.nagashi).toEqual([])
  })

  it('con la regla desactivada no se detecta', () => {
    const s = exhaust({ 0: { tiles: CLEAN } }, rules({ nagashiMangan: false }))
    const end = s.end!
    if (end.type !== 'exhaustive') throw new Error('no fue agotamiento')
    expect(end.nagashi).toEqual([])
    // vuelven a mandar los pagos de tenpai/noten (el asiento 0 está tenpai)
    expect(end.tenpai[0]).toBe(true)
    expect(end.deltas).toEqual([3000, -1000, -1000, -1000])
  })

  it('sin nagashi se mantienen los pagos de tenpai/noten', () => {
    const s = exhaust({ 0: { tiles: DIRTY } }, rules())
    const end = s.end!
    if (end.type !== 'exhaustive') throw new Error('no fue agotamiento')
    const n = end.tenpai.filter(Boolean).length
    expect(end.deltas.reduce((a, b) => a + b, 0)).toBe(0)
    if (n === 0 || n === 4) expect(end.deltas).toEqual([0, 0, 0, 0])
  })
})
