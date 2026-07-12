// Partida completa (tonpuusen: solo ronda de Este, 4 oya). Encadena manos:
// decide renchan/rotación, honba y arrastre de palos de riichi.
//
// Reglas fijadas (documentadas):
//  - Renchan: el oya repite si gana, si está tenpai en agotamiento, o en
//    cualquier aborto. Honba: +1 en renchan, agotamiento y aborto; a 0 cuando
//    gana un no-oya.
//  - Fin: tras E4 (el 4º oya pierde el asiento), o si alguien baja de 0.
//    Sin ronda Oeste de desempate.

import type { Seat } from './seat'
import type { HandState, HandEnd } from './state'
import { initHand } from './state'
import type { Abilities } from './hooks'
import { makeRng, type Rng } from './rng'

export interface GameState {
  /** Nº de oya ya consumidos (0..3). E1 = 0. La partida acaba al llegar a 4. */
  kyoku: number
  hand: HandState
  finished: boolean
  /** RNG propio de la partida para derivar la semilla de cada mano. */
  nextSeed: () => number
}

export function newGame(seed: number, abilities: Abilities = {}): GameState {
  const rng: Rng = makeRng((seed ^ 0x51ed270b) >>> 0)
  const nextSeed = () => Math.floor(rng() * 0xffffffff)
  return {
    kyoku: 0,
    hand: initHand(nextSeed(), 0, abilities),
    finished: false,
    nextSeed,
  }
}

/** ¿El oya conserva el asiento con este final de mano? */
export function isRenchan(end: HandEnd, dealer: Seat): boolean {
  switch (end.type) {
    case 'tsumo': return end.winner === dealer
    case 'ron': return end.winner === dealer
    case 'exhaustive': return end.tenpai[dealer]!
    case 'abort': return true
  }
}

/**
 * Avanza a la siguiente mano a partir de una mano terminada.
 * Devuelve el juego actualizado (o `finished` si la partida acabó).
 */
export function advanceGame(g: GameState, abilities: Abilities = {}): GameState {
  const s = g.hand
  if (s.phase !== 'ended' || !s.end) throw new Error('la mano no ha terminado')
  const end = s.end

  const busto = s.seats.some((st) => st.points < 0)
  const renchan = isRenchan(end, s.dealer)
  const kyoku = renchan ? g.kyoku : g.kyoku + 1

  if (busto || kyoku >= 4) {
    return { ...g, kyoku, finished: true }
  }

  const dealer = (renchan ? s.dealer : ((s.dealer + 1) % 4)) as Seat
  const honba =
    end.type === 'tsumo' || end.type === 'ron'
      ? renchan ? s.honba + 1 : 0
      : s.honba + 1
  const sticks = end.type === 'tsumo' || end.type === 'ron' ? 0 : s.sticks

  return {
    ...g,
    kyoku,
    hand: initHand(g.nextSeed(), dealer, abilities, {
      points: s.seats.map((st) => st.points),
      honba,
      sticks,
      roundWind: 27,
    }),
    finished: false,
  }
}

/** Clasificación final (índices de asiento ordenados por puntos). */
export function ranking(s: HandState): Seat[] {
  return ([0, 1, 2, 3] as Seat[]).sort(
    (a, b) => s.seats[b]!.points - s.seats[a]!.points || a - b,
  )
}
