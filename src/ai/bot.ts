// IA de los bots (fase 6).
//
// Ataque: descarte que minimiza shanten con desempate por ukeire cerca de
// tenpai (lejos, por "centralidad": suelta honores y extremos antes); riichi
// siempre que la mano cerrada llega a tenpai, eligiendo el descarte que deja
// más ukeire; ankan/shouminkan solo si no empeoran el shanten.
//
// Llamadas: pon de yakuhai siempre que mejore; chi/pon adicionales solo con la
// mano ya abierta y si mejoran el shanten; daiminkan nunca (regla simple).
//
// Defensa: con un riichi enemigo y la propia mano a 2+ de tenpai, fold puro:
// genbutsu del atacante > honores > suji > terminales > resto. Bajo amenaza
// tampoco se llama. (El "genbutsu global post-riichi" y la lectura de manos
// abiertas quedan fuera de v1.)
//
// `naiveTurnAction`/`naiveReaction` conservan la política aleatoria previa,
// solo para medir la fuerza comparativa en tests.

import type { Action } from '../core/actions'
import type { HandState, ReactionOffer } from '../core/state'
import type { Rng } from '../core/rng'
import type { Seat } from '../core/seat'
import { seatWind } from '../core/seat'
import {
  tsumoScore, riichiOptions, ankanOptions, shouminkanOptions,
} from '../core/rules'
import {
  tile34Of, isAka, isDragon, isHonor, type TileId, type Tile34,
} from '../core/tile'
import { countsOf, shanten } from '../core/shanten'
import { ukeire } from '../core/ukeire'

const t34s = (ids: readonly TileId[]): Tile34[] => ids.map(tile34Of)

/** Primer rival en riichi (v1: única señal de amenaza). */
function firstThreat(s: HandState, me: Seat): Seat | null {
  for (const seat of [0, 1, 2, 3] as const) {
    if (seat !== me && s.seats[seat]!.riichi > 0) return seat
  }
  return null
}

/** Cuánto vale conservar una ficha para formar corridas (0 = honor). */
function centrality(t: Tile34): number {
  if (t >= 27) return 0
  const r = (t % 9) + 1
  return Math.min(r - 1, 9 - r) + 1 // 1..5
}

/** Copia concreta a descartar de un tipo: nunca el aka si hay una normal. */
export function pickCopy(pool: readonly TileId[], t: Tile34): TileId {
  const copies = pool.filter((id) => tile34Of(id) === t)
  return copies.find((id) => !isAka(id)) ?? copies[0]!
}

// --- evaluación de descartes -------------------------------------------------------

interface DiscardEval {
  tile: Tile34
  shanten: number
  ukeire: number
}

/**
 * Mejores descartes de un pool de 14−3·melds fichas: mínimo shanten; cerca de
 * tenpai (≤1) desempata por ukeire real, lejos por centralidad (más barato).
 * `banned` excluye un tipo como candidato (kuikae) sin sacarlo del conteo.
 */
function bestDiscards(
  pool34: readonly Tile34[],
  melds: number,
  banned: Tile34 | null = null,
): DiscardEval[] {
  const counts = countsOf(pool34)
  const seen = new Set<Tile34>()
  const evals: DiscardEval[] = []
  for (const t of pool34) {
    if (seen.has(t) || t === banned) continue
    seen.add(t)
    counts[t]!--
    evals.push({ tile: t, shanten: shanten(counts, melds), ukeire: 0 })
    counts[t]!++
  }
  const best = Math.min(...evals.map((e) => e.shanten))
  const top = evals.filter((e) => e.shanten === best)

  if (best <= 1) {
    for (const e of top) {
      counts[e.tile]!--
      e.ukeire = ukeire(counts, melds).total
      counts[e.tile]!++
    }
  }
  top.sort(
    (a, b) => b.ukeire - a.ukeire || centrality(a.tile) - centrality(b.tile),
  )
  return top
}

// --- defensa ------------------------------------------------------------------------

/** Puntuación de seguridad de un tipo frente al pond del amenazante. */
function safetyScore(t: Tile34, threatDiscards: readonly Tile34[]): number {
  if (threatDiscards.includes(t)) return 100 // genbutsu
  if (isHonor(t)) return 60
  const suji = new Set<Tile34>()
  for (const d of threatDiscards) {
    if (d >= 27) continue
    const base = Math.floor(d / 9) * 9
    const r = d % 9
    if (r >= 3) suji.add(base + r - 3)
    if (r <= 5) suji.add(base + r + 3)
  }
  const r = (t % 9) + 1
  if (suji.has(t)) return r === 1 || r === 9 ? 55 : 45
  if (r === 1 || r === 9) return 30
  if (r === 2 || r === 8) return 20
  return 10
}

// --- política seria -----------------------------------------------------------------

export function botTurnAction(state: HandState, rng: Rng): Action {
  void rng // la política es determinista; se conserva la firma
  if (tsumoScore(state)) return { type: 'tsumo' }

  const me = state.turn
  const st = state.seats[me]!
  const pool =
    state.drawn !== null ? [...st.hand, state.drawn] : [...st.hand]
  const pool34 = t34s(pool)
  const melds = st.melds.length

  // kuikae: el tipo recién llamado no es candidato (salvo mano degenerada)
  const banned =
    state.justCalled !== null &&
    pool34.some((t) => t !== state.justCalled)
      ? state.justCalled
      : null
  const candidates34 = banned === null ? pool34 : pool34.filter((t) => t !== banned)

  // ankan si no empeora (en riichi, rules ya garantiza esperas intactas)
  const ak = ankanOptions(state)
  if (ak.length > 0) {
    if (st.riichi > 0) return { type: 'ankan', tile34: ak[0]! }
    const bestNow = bestDiscards(pool34, melds, banned)[0]!.shanten
    for (const t of ak) {
      const counts = countsOf(pool34)
      counts[t]! -= 4
      if (shanten(counts, melds + 1) <= bestNow) return { type: 'ankan', tile34: t }
    }
  }

  if (st.riichi > 0) return { type: 'discard', tile: state.drawn! }

  const threat = firstThreat(state, me)
  const evals = bestDiscards(pool34, melds, banned)

  // fold: amenaza y mano atrasada → la ficha más segura, la mano da igual
  if (threat !== null && evals[0]!.shanten >= 2) {
    const threatDiscards = state.seats[threat]!.discarded
    let bestT: Tile34 = candidates34[0]!
    let bestScore = -1
    for (const t of new Set(candidates34)) {
      const sc = safetyScore(t, threatDiscards)
      if (sc > bestScore) {
        bestScore = sc
        bestT = t
      }
    }
    return { type: 'discard', tile: pickCopy(pool, bestT) }
  }

  // riichi al llegar a tenpai: el descarte que deja más ukeire
  const ro = riichiOptions(state)
  if (ro.length > 0) {
    let best: TileId = ro[0]!
    let bestUke = -1
    for (const id of ro) {
      const rest = pool.filter((x) => x !== id)
      const u = ukeire(countsOf(t34s(rest)), melds).total
      if (u > bestUke) {
        bestUke = u
        best = id
      }
    }
    return { type: 'riichi', tile: best }
  }

  // shouminkan si no empeora el shanten (la 4ª copia suele ser grasa)
  const sk = shouminkanOptions(state)
  if (sk.length > 0) {
    const bestNow = evals[0]!.shanten
    for (const id of sk) {
      const rest34 = t34s(pool.filter((x) => x !== id))
      if (shanten(countsOf(rest34), melds) <= bestNow) {
        return { type: 'shouminkan', tile: id }
      }
    }
  }

  return { type: 'discard', tile: pickCopy(pool, evals[0]!.tile) }
}

export function botReaction(
  state: HandState,
  offer: ReactionOffer,
  rng: Rng,
): Action {
  void rng
  const seat = offer.seat
  if (offer.ron) return { type: 'ron', seat }

  // bajo riichi enemigo no se llama
  if (firstThreat(state, seat) !== null) return { type: 'pass', seat }

  const st = state.seats[seat]!
  const tile = tile34Of(state.reaction!.tile)
  const hand34 = t34s(st.hand)
  const before = shanten(countsOf(hand34), st.melds.length)
  const isOpen = st.melds.some((m) => m.kind !== 'ankan')

  const afterRemoving = (removed: Tile34[]): number => {
    const counts = countsOf(hand34)
    for (const t of removed) counts[t]!--
    return shanten(counts, st.melds.length + 1)
  }

  if (offer.pon) {
    const yakuhai =
      isDragon(tile) ||
      tile === seatWind(seat, state.dealer) ||
      tile === state.roundWind
    if ((yakuhai || isOpen) && afterRemoving([tile, tile]) < before) {
      return { type: 'pon', seat }
    }
  }
  if (offer.chi.length > 0 && isOpen) {
    let best: { start: Tile34; after: number } | null = null
    for (const start of offer.chi) {
      const others = [start, start + 1, start + 2].filter((x) => x !== tile)
      const after = afterRemoving(others)
      if (after < before && (!best || after < best.after)) best = { start, after }
    }
    if (best) return { type: 'chi', seat, start: best.start }
  }
  // daiminkan: nunca (v1)
  return { type: 'pass', seat }
}

// --- política ingenua (solo benchmark en tests) ---------------------------------------

export function naiveTurnAction(state: HandState, rng: Rng): Action {
  if (tsumoScore(state)) return { type: 'tsumo' }
  const st = state.seats[state.turn]!

  const ak = ankanOptions(state)
  if (ak.length > 0 && rng() < 0.4) return { type: 'ankan', tile34: ak[0]! }
  if (st.riichi > 0) return { type: 'discard', tile: state.drawn! }
  const ro = riichiOptions(state)
  if (ro.length > 0 && rng() < 0.4) {
    return { type: 'riichi', tile: ro[Math.floor(rng() * ro.length)]! }
  }
  const sk = shouminkanOptions(state)
  if (sk.length > 0 && rng() < 0.4) return { type: 'shouminkan', tile: sk[0]! }

  const pool = state.drawn !== null ? [...st.hand, state.drawn] : [...st.hand]
  let candidates = pool
  if (state.justCalled !== null) {
    const alt = pool.filter((id) => tile34Of(id) !== state.justCalled)
    if (alt.length > 0) candidates = alt
  }
  let best: TileId[] = []
  let bestS = Infinity
  for (const id of candidates) {
    const rest = pool.filter((x) => x !== id).map(tile34Of)
    const sh = shanten(countsOf(rest), st.melds.length)
    if (sh < bestS) {
      bestS = sh
      best = [id]
    } else if (sh === bestS) {
      best.push(id)
    }
  }
  return { type: 'discard', tile: best[Math.floor(rng() * best.length)]! }
}

export function naiveReaction(
  _state: HandState,
  offer: ReactionOffer,
  rng: Rng,
): Action {
  const seat = offer.seat
  if (offer.ron) return { type: 'ron', seat }
  if (offer.kan && rng() < 0.2) return { type: 'daiminkan', seat }
  if (offer.pon && rng() < 0.25) return { type: 'pon', seat }
  if (offer.chi.length > 0 && rng() < 0.25) {
    return { type: 'chi', seat, start: offer.chi[0]! }
  }
  return { type: 'pass', seat }
}
