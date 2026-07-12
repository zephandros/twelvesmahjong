// Bucle headless: juega manos completas con la política de bots dada (la
// seria por defecto). Arnés de propiedades de los tests y del benchmark de
// fuerza entre políticas.

import type { Action } from '../core/actions'
import type { HandState, HandOptions, ReactionOffer } from '../core/state'
import { initHand } from '../core/state'
import { reduce } from '../core/reducer'
import type { Abilities } from '../core/hooks'
import { makeRng, type Rng } from '../core/rng'
import type { Seat } from '../core/seat'
import { botTurnAction, botReaction } from './bot'

export interface BotPolicy {
  turn(state: HandState, rng: Rng): Action
  reaction(state: HandState, offer: ReactionOffer, rng: Rng): Action
}

export const SMART_POLICY: BotPolicy = { turn: botTurnAction, reaction: botReaction }

/** Política por asiento; ausencia = SMART_POLICY. */
export type Policies = Partial<Record<Seat, BotPolicy>>

export interface SimResult {
  final: HandState
  log: Action[]
}

export function simulateHand(
  seed: number,
  dealer: Seat = 0,
  abilities: Abilities = {},
  opts: HandOptions = {},
  policies: Policies = {},
): SimResult {
  return simulateFrom(initHand(seed, dealer, abilities, opts), seed, abilities, policies)
}

/** Corre los bots sobre un estado ya creado (p. ej. dentro de una partida). */
export function simulateFrom(
  initial: HandState,
  seed: number,
  abilities: Abilities = {},
  policies: Policies = {},
): SimResult {
  let state = initial
  const rng = makeRng((seed ^ 0x9e3779b9) >>> 0)
  const log: Action[] = []
  const push = (a: Action): void => {
    state = reduce(state, a, abilities)
    log.push(a)
  }
  const policyOf = (seat: Seat): BotPolicy => policies[seat] ?? SMART_POLICY

  let guard = 0
  while (state.phase !== 'ended') {
    if (++guard > 3000) throw new Error('simulación sin terminar')

    if (state.phase === 'draw') {
      push({ type: 'draw' })
      continue
    }
    if (state.phase === 'discard') {
      push(policyOf(state.turn).turn(state, rng))
      continue
    }
    // reaction: responde el primer asiento con oferta pendiente
    const r = state.reaction!
    const offer = r.offers.find((o) => r.responses[o.seat] === null)!
    push(policyOf(offer.seat).reaction(state, offer, rng))
  }

  return { final: state, log }
}

/** Reproduce un log sobre la misma semilla. Debe converger al mismo estado. */
export function replay(
  seed: number,
  dealer: Seat,
  log: readonly Action[],
  abilities: Abilities = {},
  opts: HandOptions = {},
): HandState {
  let state = initHand(seed, dealer, abilities, opts)
  for (const action of log) state = reduce(state, action, abilities)
  return state
}
