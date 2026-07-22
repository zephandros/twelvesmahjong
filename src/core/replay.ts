// Una partida entera cabe en `seed + reglamento + log de acciones`: el núcleo
// es determinista y las semillas de cada mano salen del RNG de la partida, no
// del reloj. De ahí salen tanto el guardado como (más adelante) los replays.
//
// El log NO incluye las decisiones de los bots, sino las acciones que
// produjeron: reproducirlo no necesita ni la IA ni su RNG.

import type { Action } from './actions'
import type { RuleSet } from './rules-config'
import { reduce } from './reducer'
import { newGame, advanceGame, type GameState } from './game'

export interface GameLog {
  /** Semilla de la partida (la que recibió `newGame`). */
  seed: number
  rules: RuleSet
  /** Acciones de cada mano, en orden; la última es la mano en curso. */
  hands: Action[][]
}

/** Log vacío de una partida que acaba de empezar. */
export function newLog(seed: number, rules: RuleSet): GameLog {
  return { seed, rules, hands: [[]] }
}

/**
 * Reconstruye el estado de partida a partir del log. Lanza si el log es
 * incoherente (acción ilegal, mano sin terminar antes de la siguiente, o
 * manos de más tras el final): quien lo llame debe tratarlo como guardado
 * corrupto y descartarlo.
 */
export function replay(log: GameLog): GameState {
  let g = newGame(log.seed, {}, log.rules)

  for (let i = 0; i < log.hands.length; i++) {
    if (i > 0) {
      if (g.hand.phase !== 'ended') {
        throw new Error(`replay: la mano ${i - 1} no terminó`)
      }
      g = advanceGame(g)
      if (g.finished) throw new Error('replay: la partida ya había acabado')
    }
    for (const action of log.hands[i]!) {
      g = { ...g, hand: reduce(g.hand, action) }
    }
  }
  return g
}
