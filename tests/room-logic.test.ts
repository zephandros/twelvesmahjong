// Árbitro de multijugador (worker/room-logic.ts).
//
// El módulo es puro a propósito para poder probarlo aquí, con vitest en node y
// sin levantar workerd. Dos cosas que atar:
//
//  1. `authorize` — es TODA la superficie anti-trampas. El núcleo no tiene
//     noción de identidad: si esto se afloja, un cliente puede jugar por otro.
//  2. `nextStep` — el bucle del servidor tiene que producir un log que
//     reproduzca al mismo estado, igual que el guardado local (replay.test.ts).

import { describe, it, expect } from 'vitest'
import { actorOf, authorize, nextStep, waitingOn, timeoutAction } from '../worker/room-logic'
import type { Action } from '../src/core/actions'
import type { Seat } from '../src/core/seat'
import { newGame, advanceGame, type GameState } from '../src/core/game'
import { newLog, replay } from '../src/core/replay'
import { reduce } from '../src/core/reducer'
import { DEFAULT_RULES } from '../src/core/rules-config'
import { makePolicy } from '../src/ai/bot'
import { DEFAULT_PROFILE } from '../src/ai/profiles'
import { makeBotRngs } from '../src/ai/bot-seats'

const ALL: ReadonlySet<Seat> = new Set<Seat>([0, 1, 2, 3])
const NONE: ReadonlySet<Seat> = new Set<Seat>()
const policy = makePolicy(DEFAULT_PROFILE)
const policyOf = () => policy

/** Lleva la partida hasta la primera fase de reacción que aparezca. */
function untilReaction(seed: number): GameState | null {
  let g = newGame(seed, {}, DEFAULT_RULES)
  const rngs = makeBotRngs(1)
  for (let i = 0; i < 400; i++) {
    const s = g.hand
    if (s.phase === 'reaction') return g
    if (s.phase === 'ended') return null
    const a: Action = s.phase === 'draw'
      ? { type: 'draw' }
      : policy.turn(s, rngs[s.turn])
    g = { ...g, hand: reduce(s, a) }
  }
  return null
}

describe('authorize: atribución de acciones', () => {
  const g = newGame(1234, {}, DEFAULT_RULES)
  const afterDraw = { ...g, hand: reduce(g.hand, { type: 'draw' }) }
  const s = afterDraw.hand
  const turn = s.turn
  const other = ((turn + 1) % 4) as Seat

  it('el robo NUNCA se acepta de un cliente (lo genera el servidor)', () => {
    for (const seat of [0, 1, 2, 3] as Seat[]) {
      expect(authorize(s, seat, { type: 'draw' })).toBe(false)
    }
  })

  it('una acción de turno solo la puede emitir el asiento en turno', () => {
    const discard: Action = { type: 'discard', tile: s.seats[turn]!.hand[0]! }
    expect(authorize(s, turn, discard)).toBe(true)
    expect(authorize(s, other, discard)).toBe(false)
  })

  it('el actor de una acción de turno es state.turn, no un campo de la acción', () => {
    expect(actorOf(s, { type: 'tsumo' })).toBe(turn)
    expect(actorOf(s, { type: 'pass', seat: other })).toBe(other)
  })

  it('en fase de descarte no se admiten reacciones', () => {
    expect(authorize(s, other, { type: 'pass', seat: other })).toBe(false)
  })

  it('una reacción con el seat de otro se rechaza aunque el emisor tenga oferta', () => {
    const g2 = untilReaction(99)
    expect(g2).not.toBeNull()
    const r = g2!.hand.reaction!
    const mine = r.offers[0]!.seat
    const impostor = ((mine + 1) % 4) as Seat
    // firmando con SU asiento: vale (si le toca)
    expect(authorize(g2!.hand, mine, { type: 'pass', seat: mine })).toBe(true)
    // el impostor intenta contestar por él: se rechaza por los dos lados
    expect(authorize(g2!.hand, impostor, { type: 'pass', seat: mine })).toBe(false)
  })

  it('no se puede contestar dos veces a la misma reacción', () => {
    const g2 = untilReaction(99)!
    const seat = g2.hand.reaction!.offers[0]!.seat
    const answered = { ...g2, hand: reduce(g2.hand, { type: 'pass', seat }) }
    // si la reacción sigue viva (faltaban otros), este asiento ya no puede repetir
    if (answered.hand.phase === 'reaction') {
      expect(authorize(answered.hand, seat, { type: 'pass', seat })).toBe(false)
    }
  })

  it('con la mano acabada no se admite nada', () => {
    const ended = { ...s, phase: 'ended' as const }
    expect(authorize(ended, turn, { type: 'tsumo' })).toBe(false)
  })
})

describe('nextStep: bucle autoritativo', () => {
  it('con los cuatro asientos automáticos juega la partida entera y el log reproduce', () => {
    const seed = 20260726
    let g = newGame(seed, {}, DEFAULT_RULES)
    const log = newLog(seed, DEFAULT_RULES)
    const rngs = makeBotRngs(7)
    const rngOf = (seat: Seat) => rngs[seat]

    // Estado justo ANTES del advanceGame que cierra la partida: es lo que
    // reconstruye `replay` (y lo que ve un cliente que reconecta), porque el log
    // solo llega hasta la última mano jugada.
    let lastPlayed = g

    for (let guard = 0; guard < 20000 && !g.finished; guard++) {
      const step = nextStep(g, ALL, policyOf, rngOf)
      if (step.kind === 'finished') break
      // nadie humano → el árbitro nunca debería quedarse esperando
      expect(step.kind).not.toBe('await')
      if (step.kind === 'advance') {
        lastPlayed = g
        g = advanceGame(g)
        if (!g.finished) log.hands.push([])
        continue
      }
      if (step.kind === 'action') {
        g = { ...g, hand: reduce(g.hand, step.action) }
        log.hands[log.hands.length - 1]!.push(step.action)
      }
    }

    expect(g.finished).toBe(true)
    // el log del árbitro reconstruye exactamente la misma partida
    const rebuilt = replay(log)
    expect(rebuilt.hand.seats.map((st) => st.points))
      .toEqual(lastPlayed.hand.seats.map((st) => st.points))
    expect(rebuilt.kyoku).toBe(lastPlayed.kyoku)
    // y avanzarla desde ahí da el mismo final
    expect(advanceGame(rebuilt).finished).toBe(true)
    expect(advanceGame(rebuilt).hand.seats.map((st) => st.points))
      .toEqual(g.hand.seats.map((st) => st.points))
  })

  it('se para a esperar al humano en turno, y no antes', () => {
    const g = newGame(555, {}, DEFAULT_RULES)
    const rngs = makeBotRngs(1)
    const rngOf = (seat: Seat) => rngs[seat]

    // fase 'draw': el robo lo genera el servidor aunque el asiento sea humano
    expect(nextStep(g, NONE, policyOf, rngOf)).toEqual({
      kind: 'action', action: { type: 'draw' },
    })

    const drawn = { ...g, hand: reduce(g.hand, { type: 'draw' }) }
    const step = nextStep(drawn, NONE, policyOf, rngOf)
    expect(step).toEqual({ kind: 'await', seat: drawn.hand.turn })
    expect(waitingOn(drawn, NONE)).toEqual([drawn.hand.turn])
    // ese mismo asiento en automático: ya no se espera a nadie
    expect(waitingOn(drawn, ALL)).toEqual([])
  })

  it('en reacción contesta primero por los automáticos y espera a los humanos', () => {
    const g = untilReaction(99)!
    const seats = g.hand.reaction!.offers.map((o) => o.seat)
    const rngs = makeBotRngs(1)
    const rngOf = (seat: Seat) => rngs[seat]

    // todos automáticos: produce una acción, no una espera
    expect(nextStep(g, ALL, policyOf, rngOf).kind).toBe('action')
    // todos humanos: espera, y `waitingOn` los lista TODOS (van al mismo reloj)
    expect(nextStep(g, NONE, policyOf, rngOf).kind).toBe('await')
    expect(waitingOn(g, NONE).sort()).toEqual([...seats].sort())
  })
})

describe('timeout: relevo del ausente', () => {
  it('en reacción se pasa por él, nunca se canta en su nombre', () => {
    const g = untilReaction(99)!
    const seat = g.hand.reaction!.offers[0]!.seat
    expect(timeoutAction(g.hand, seat)).toEqual({ type: 'pass', seat })
  })

  it('el pase forzado por timeout no rompe el replay', () => {
    const seed = 4242
    const g = untilReaction(seed)
    if (!g) return // esta semilla no llegó a ofrecer ninguna llamada
    const log = newLog(seed, DEFAULT_RULES)
    // se rehace el tramo jugado hasta aquí y se le añade el pase forzado
    let g2 = newGame(seed, {}, DEFAULT_RULES)
    const rngs = makeBotRngs(1)
    while (g2.hand.phase !== 'reaction') {
      const a: Action = g2.hand.phase === 'draw'
        ? { type: 'draw' }
        : policy.turn(g2.hand, rngs[g2.hand.turn])
      g2 = { ...g2, hand: reduce(g2.hand, a) }
      log.hands[0]!.push(a)
    }
    for (const offer of g2.hand.reaction!.offers) {
      const forced = timeoutAction(g2.hand, offer.seat)
      if (!forced) continue
      g2 = { ...g2, hand: reduce(g2.hand, forced) }
      log.hands[0]!.push(forced)
    }
    expect(() => replay(log)).not.toThrow()
    expect(replay(log).hand.phase).toBe(g2.hand.phase)
  })

  it('no inventa una acción para un asiento que ya contestó', () => {
    const g = untilReaction(99)!
    const seat = g.hand.reaction!.offers[0]!.seat
    const answered = { ...g, hand: reduce(g.hand, { type: 'pass', seat }) }
    if (answered.hand.phase === 'reaction') {
      expect(timeoutAction(answered.hand, seat)).toBeNull()
    }
  })
})
