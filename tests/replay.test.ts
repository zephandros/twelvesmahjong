// Round-trip del log: una partida jugada por los bots debe reconstruirse
// exactamente desde `seed + reglamento + acciones`. Es la red que protege el
// guardado: si el log deja de recoger alguna acción (el robo automático, la
// respuesta de un bot), este test se cae.

import { describe, it, expect } from 'vitest'
import { newGame, advanceGame, type GameState } from '../src/core/game'
import { newLog, replay, type GameLog } from '../src/core/replay'
import { DEFAULT_RULES, type RuleSet } from '../src/core/rules-config'
import { simulateFrom } from '../src/ai/sim'

/** Juega una partida entera con los bots y devuelve estado final + log. */
function playGame(seed: number, rules: RuleSet): { g: GameState; log: GameLog } {
  let g = newGame(seed, {}, rules)
  const log = newLog(seed, rules)
  let hands = 0
  while (!g.finished) {
    if (++hands > 40) throw new Error('partida sin terminar')
    const r = simulateFrom(g.hand, seed * 100 + hands)
    log.hands[log.hands.length - 1] = [...r.log]
    g = advanceGame({ ...g, hand: r.final })
    if (!g.finished) log.hands.push([])
  }
  return { g, log }
}

const points = (g: GameState): number[] => g.hand.seats.map((st) => st.points)

describe('replay del log de partida', () => {
  it('reconstruye puntos, kyoku y estado final de varias partidas', { timeout: 30000 }, () => {
    for (const seed of [11, 22, 33]) {
      const { g, log } = playGame(seed, DEFAULT_RULES)
      // `replay` deja la última mano TERMINADA pero sin avanzar (es el estado
      // que ve el jugador al reanudar); el cierre de partida lo da advanceGame
      const back = replay(log)
      expect(points(back)).toEqual(points(g))
      expect(back.hand.honba).toBe(g.hand.honba)
      expect(back.hand.end).toEqual(g.hand.end)
      const closed = advanceGame(back)
      expect(closed.finished).toBe(true)
      expect(closed.kyoku).toBe(g.kyoku)
    }
  })

  it('funciona igual en hanchan (más manos y cambio de ronda)', { timeout: 30000 }, () => {
    const rules: RuleSet = { ...DEFAULT_RULES, length: 'hanchan' }
    const { g, log } = playGame(77, rules)
    expect(log.hands.length).toBeGreaterThan(4)
    expect(points(replay(log))).toEqual(points(g))
  })

  it('un log cortado a media mano reproduce esa mano a medias', () => {
    const { log } = playGame(11, DEFAULT_RULES)
    const last = log.hands[log.hands.length - 1]!
    const cut: GameLog = {
      ...log,
      hands: [...log.hands.slice(0, -1), last.slice(0, Math.floor(last.length / 2))],
    }
    const back = replay(cut)
    expect(back.hand.phase).not.toBe('ended')
    expect(back.hand.end).toBeNull()
    // el muro ya se ha consumido en parte: no es una mano recién repartida
    expect(back.hand.wall.live.length).toBeLessThan(70)
  })

  it('el reglamento viaja en el log: reproducir con otras reglas no colaría', () => {
    const rules: RuleSet = { ...DEFAULT_RULES, startPoints: 30000 }
    const { log } = playGame(11, rules)
    expect(replay(log).hand.rules.startPoints).toBe(30000)
  })

  it('lanza con un log corrupto', () => {
    const { log } = playGame(11, DEFAULT_RULES)
    const broken: GameLog = {
      ...log,
      hands: log.hands.map((h, i) => (i === 0 ? [{ type: 'tsumo' as const }, ...h] : h)),
    }
    expect(() => replay(broken)).toThrow()
  })

  it('lanza si una mano intermedia no terminó', () => {
    const { log } = playGame(11, DEFAULT_RULES)
    if (log.hands.length < 2) throw new Error('hace falta una partida de 2+ manos')
    const broken: GameLog = {
      ...log,
      hands: log.hands.map((h, i) => (i === 0 ? h.slice(0, 3) : h)),
    }
    expect(() => replay(broken)).toThrow()
  })
})
