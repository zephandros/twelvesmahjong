// Partida completa: tonpuusen (ronda de Este, 4 oya) o hanchan (Este + Sur, 8),
// según `rules.length`. Encadena manos: decide renchan/rotación, honba y
// arrastre de palos de riichi.
//
// Reglas fijadas (documentadas):
//  - Renchan: el oya repite si gana, si está tenpai en agotamiento, o en
//    cualquier aborto. Honba: +1 en renchan, agotamiento y aborto; a 0 cuando
//    gana un no-oya.
//  - Fin: al consumir el último oya, o (con `rules.tobi`) si alguien baja de 0.
//    Sin ronda extra de desempate.
//  - Agari-yame / tenpai-yame (`rules.agariYame`): el renchan de la ÚLTIMA mano
//    cierra la partida si el oya va 1º. Sin la regla, repite indefinidamente.

import type { Tile34 } from './tile'
import type { Seat } from './seat'
import type { HandState, HandEnd } from './state'
import { initHand } from './state'
import type { Abilities } from './hooks'
import type { RuleSet } from './rules-config'
import { DEFAULT_RULES } from './rules-config'
import { makeRng, type Rng } from './rng'

/** Índice del último oya de la partida: E4 = 3, S4 = 7. */
export const lastKyoku = (r: RuleSet): number => (r.length === 'hanchan' ? 7 : 3)
/** Viento de ronda del kyoku: los cuatro primeros son Este, el resto Sur. */
export const roundWindOf = (kyoku: number): Tile34 => (kyoku < 4 ? 27 : 28)
/** Ordinal dentro de la ronda (0..3), para rotular 東三局 / 南一局. */
export const kyokuNumber = (kyoku: number): number => kyoku % 4

export interface GameState {
  /** Nº de oya ya consumidos. E1 = 0; el máximo lo fija `lastKyoku`. */
  kyoku: number
  hand: HandState
  finished: boolean
  /** RNG propio de la partida para derivar la semilla de cada mano. */
  nextSeed: () => number
}

export function newGame(
  seed: number,
  abilities: Abilities = {},
  rules: RuleSet = DEFAULT_RULES,
): GameState {
  const rng: Rng = makeRng((seed ^ 0x51ed270b) >>> 0)
  const nextSeed = () => Math.floor(rng() * 0xffffffff)
  return {
    kyoku: 0,
    hand: initHand(nextSeed(), 0, abilities, { rules, roundWind: roundWindOf(0) }),
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

  const rules = s.rules
  const busto = rules.tobi && s.seats.some((st) => st.points < 0)
  const renchan = isRenchan(end, s.dealer)
  const kyoku = renchan ? g.kyoku : g.kyoku + 1
  const last = lastKyoku(rules)

  // agari-yame: el oya que retiene la última mano yendo 1º cierra la partida
  // (incluye el tenpai-yame del agotamiento, que también es renchan).
  const agariYame =
    rules.agariYame && renchan && g.kyoku === last && ranking(s)[0] === s.dealer

  if (busto || agariYame || kyoku > last) {
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
      roundWind: roundWindOf(kyoku),
      rules,
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
