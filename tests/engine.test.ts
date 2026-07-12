import { describe, it, expect } from 'vitest'
import { TILEID_COUNT } from '../src/core/tile'
import { makeRng } from '../src/core/rng'
import { buildWall, deal, doraIndicators, LIVE_DRAWS, DEAD_WALL_SIZE } from '../src/core/wall'
import { initHand, type HandState } from '../src/core/state'
import { reduce } from '../src/core/reducer'
import { simulateHand, replay, type Policies } from '../src/ai/sim'
import { naiveTurnAction, naiveReaction } from '../src/ai/bot'
import type { Ability } from '../src/core/hooks'

// la política ingenua (aleatoria) ejercita más caminos de la máquina y es la
// que calibró los umbrales de distribución de finales
const naive = { turn: naiveTurnAction, reaction: naiveReaction }
const NAIVE_ALL: Policies = { 0: naive, 1: naive, 2: naive, 3: naive }

/** Todas las fichas del estado, para comprobar conservación (136 únicas). */
function allTiles(s: HandState): number[] {
  const ids = [
    ...s.wall.live,
    ...s.wall.dead,
    ...s.seats.flatMap((st) => [
      ...st.hand,
      ...st.pond,
      ...st.melds.flatMap((m) => [...m.tiles]),
    ]),
  ]
  if (s.drawn !== null) ids.push(s.drawn)
  if (s.pendingKan !== null) ids.push(s.pendingKan.tile)
  return ids.sort((a, b) => a - b)
}

/** Suma de puntos + palos en mesa: invariante de conservación. */
const totalPoints = (s: HandState): number =>
  s.seats.reduce((t, st) => t + st.points, 0) + s.sticks * 1000

const FULL_SET = Array.from({ length: TILEID_COUNT }, (_, i) => i)

describe('wall', () => {
  it('construye 136 fichas únicas barajadas', () => {
    const tiles = buildWall(makeRng(42))
    expect([...tiles].sort((a, b) => a - b)).toEqual(FULL_SET)
    expect(tiles).not.toEqual(FULL_SET)
  })

  it('reparte 13×4, deja 70 robos vivos y 14 en el muerto', () => {
    const { wall, hands } = deal(buildWall(makeRng(1)))
    expect(hands).toHaveLength(4)
    for (const h of hands) {
      expect(h).toHaveLength(13)
      expect([...h].sort((a, b) => a - b)).toEqual(h)
    }
    expect(wall.live).toHaveLength(LIVE_DRAWS)
    expect(wall.dead).toHaveLength(DEAD_WALL_SIZE)
    expect(wall.doraRevealed).toBe(1)
    expect(doraIndicators(wall)).toEqual([wall.dead[4]])
  })
})

describe('reducer: básicos', () => {
  it('draw entrega la última ficha del vivo y pasa a discard', () => {
    const s0 = initHand(7, 0)
    const top = s0.wall.live[s0.wall.live.length - 1]!
    const s1 = reduce(s0, { type: 'draw' })
    expect(s1.drawn).toBe(top)
    expect(s1.phase).toBe('discard')
    expect(s1.wall.live).toHaveLength(s0.wall.live.length - 1)
  })

  it('tsumogiri no toca la mano; tedashi la reordena', () => {
    const s0 = initHand(7, 0)
    const s1 = reduce(s0, { type: 'draw' })
    const hand0 = [...s1.seats[0]!.hand]

    const s2 = reduce(s1, { type: 'discard', tile: s1.drawn! })
    expect(s2.seats[0]!.hand).toEqual(hand0)
    expect(s2.seats[0]!.pond).toEqual([s1.drawn])

    // el turno avanza salvo que hubiera ofertas de reacción
    if (s2.phase === 'draw') {
      expect(s2.turn).toBe(1)
      const s3 = reduce(s2, { type: 'draw' })
      const fromHand = s3.seats[1]!.hand[0]!
      const s4 = reduce(s3, { type: 'discard', tile: fromHand })
      expect(s4.seats[1]!.hand).toHaveLength(13)
      expect(s4.seats[1]!.hand).toContain(s3.drawn)
      expect(s4.seats[1]!.hand).not.toContain(fromHand)
      const sorted = [...s4.seats[1]!.hand].sort((a, b) => a - b)
      expect(s4.seats[1]!.hand).toEqual(sorted)
    }
  })

  it('rechaza acciones ilegales', () => {
    const s0 = initHand(7, 0)
    expect(() => reduce(s0, { type: 'discard', tile: 0 })).toThrow(/fase/)
    const s1 = reduce(s0, { type: 'draw' })
    expect(() => reduce(s1, { type: 'draw' })).toThrow(/fase/)
    const notMine = s1.wall.live[0]!
    expect(() => reduce(s1, { type: 'discard', tile: notMine })).toThrow(/no está/)
    expect(() => reduce(s1, { type: 'tsumo' })).toThrow(/ilegal|fase/)
    expect(() => reduce(s1, { type: 'ron', seat: 2 })).toThrow(/fase/)
  })
})

describe('simulación headless completa', () => {
  it('200 manos: terminan, conservan fichas y puntos', { timeout: 60000 }, () => {
    const endTypes = new Map<string, number>()
    for (let seed = 0; seed < 200; seed++) {
      const { final } = simulateHand(seed, (seed % 4) as 0 | 1 | 2 | 3, {}, {}, NAIVE_ALL)
      expect(final.phase).toBe('ended')
      expect(final.end).not.toBeNull()
      endTypes.set(final.end!.type, (endTypes.get(final.end!.type) ?? 0) + 1)
      expect(allTiles(final)).toEqual(FULL_SET)
      expect(totalPoints(final)).toBe(100000)
      // deltas del final cuadran con lo aplicado
      const sumDeltas = final.end!.deltas.reduce((a, b) => a + b, 0)
      if (final.end!.type === 'exhaustive' || final.end!.type === 'abort') {
        expect(sumDeltas).toBe(0)
      }
    }
    // el bot ejercita victorias y llamadas de verdad
    // (con semillas 0..199 la distribución es ~110 victorias / ~89 agotamientos)
    expect((endTypes.get('tsumo') ?? 0) + (endTypes.get('ron') ?? 0)).toBeGreaterThan(50)
    expect(endTypes.get('exhaustive') ?? 0).toBeGreaterThan(5)
  })

  it('es determinista y el log reproduce la partida', () => {
    const a = simulateHand(999, 1)
    const b = simulateHand(999, 1)
    expect(a.log).toEqual(b.log)
    expect(JSON.stringify(a.final)).toBe(JSON.stringify(b.final))

    const replayed = replay(999, 1, a.log)
    expect(JSON.stringify(replayed)).toBe(JSON.stringify(a.final))

    const c = simulateHand(1000, 1)
    expect(JSON.stringify(c.final)).not.toBe(JSON.stringify(a.final))
  })
})

describe('ganchos de habilidad', () => {
  it('beforeDraw dirige el robo si la ficha está en el vivo', () => {
    const s0 = initHand(21, 0)
    const target = s0.wall.live[0]!
    const ability: Ability = { beforeDraw: () => target }
    const s1 = reduce(s0, { type: 'draw' }, { 0: ability })
    expect(s1.drawn).toBe(target)
    expect(s1.wall.live).not.toContain(target)
    expect(allTiles(s1)).toEqual(FULL_SET)
  })

  it('beforeDraw con ficha inexistente cae al robo normal', () => {
    const s0 = initHand(21, 0)
    const top = s0.wall.live[s0.wall.live.length - 1]!
    const gone: Ability = { beforeDraw: () => 999 }
    const s1 = reduce(s0, { type: 'draw' }, { 0: gone })
    expect(s1.drawn).toBe(top)
  })

  it('onBuildWall altera el muro antes del reparto', () => {
    const flip: Ability = { onBuildWall: (w) => w.reverse() }
    const normal = initHand(33, 0)
    const flipped = initHand(33, 0, { 0: flip })
    expect(JSON.stringify(flipped.seats.map((s) => s.hand))).not.toBe(
      JSON.stringify(normal.seats.map((s) => s.hand)),
    )
    expect(allTiles(flipped)).toEqual(FULL_SET)
  })
})
