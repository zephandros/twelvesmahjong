// Reducer puro: (state, action) → state. Clona el estado y muta el clon.
// Lanza en acciones ilegales — un log válido nunca las contiene.
//
// Reglas fijadas (documentadas):
//  - Atamahane: si varios pueden ron sobre el mismo descarte, gana el más
//    cercano en orden de turno desde el que descartó (sin ron doble/triple).
//  - El palo de riichi solo se deposita si el descarte de riichi pasa sin ron.
//  - Los indicadores de dora de kan se revelan inmediatamente (los tres tipos).
//  - Suukaikan: aborta cuando hay 4 kans de asientos distintos y el descarte
//    posterior pasa sin ron. Suufon renda y suucha riichi: al pasar el 4º
//    descarte/riichi. Sin nagashi mangan.

import type { TileId, Tile34 } from './tile'
import { tile34Of } from './tile'
import type { Seat } from './seat'
import type { Action } from './actions'
import type { HandState, HandEnd, ReactionResponse } from './state'
import { cloneState } from './state'
import type { Abilities } from './hooks'
import { drawRinshan } from './wall'
import type { Meld } from './meld'
import {
  ronScore, tsumoScore, offersFor,
  riichiOptions, ankanOptions, shouminkanOptions, canKyuushu, isTenpai,
} from './rules'
import { waitsOf } from './furiten'
import type { WinScore } from './score'

export function reduce(
  state: HandState,
  action: Action,
  abilities: Abilities = {},
): HandState {
  if (state.phase === 'ended') throw new Error('la mano ya terminó')
  const s = cloneState(state)

  switch (action.type) {
    case 'draw': return applyDraw(s, abilities)
    case 'discard': return applyDiscard(s, action.tile, null)
    case 'riichi': return applyRiichi(s, action.tile)
    case 'tsumo': return applyTsumo(s, abilities)
    case 'ankan': return applyAnkan(s, action.tile34)
    case 'shouminkan': return applyShouminkan(s, action.tile)
    case 'kyuushu': return applyKyuushu(s)
    case 'pass':
    case 'ron':
    case 'pon':
    case 'daiminkan':
    case 'chi':
      return applyReaction(s, action, abilities)
  }
}

// --- robo -----------------------------------------------------------------------

function applyDraw(s: HandState, abilities: Abilities): HandState {
  if (s.phase !== 'draw') throw new Error(`draw en fase ${s.phase}`)

  if (s.wall.live.length === 0) return endExhaustive(s)

  const seat = s.turn
  s.seats[seat]!.missedRon = false // furiten temporal: se limpia al robar

  const pick = abilities[seat]?.beforeDraw?.(s, seat) ?? null
  let tile: TileId
  if (pick !== null && s.wall.live.includes(pick)) {
    tile = pick
    s.wall.live = s.wall.live.filter((id) => id !== pick)
  } else {
    tile = s.wall.live.pop()!
  }

  s.drawn = tile
  s.rinshan = false
  s.phase = 'discard'
  return s
}

// --- descartes ------------------------------------------------------------------

function moveTileOut(s: HandState, tile: TileId): void {
  const st = s.seats[s.turn]!
  if (tile === s.drawn) {
    s.drawn = null
    return
  }
  const idx = st.hand.indexOf(tile)
  if (idx === -1) throw new Error(`la ficha ${tile} no está en la mano de ${s.turn}`)
  st.hand.splice(idx, 1)
  if (s.drawn !== null) {
    st.hand.push(s.drawn)
    st.hand.sort((a, b) => a - b)
    s.drawn = null
  }
}

function applyDiscard(s: HandState, tile: TileId, riichi: 1 | 2 | null): HandState {
  if (s.phase !== 'discard') throw new Error(`discard en fase ${s.phase}`)
  const seat = s.turn
  const st = s.seats[seat]!

  if (s.justCalled !== null && tile34Of(tile) === s.justCalled) {
    // kuikae prohibido salvo que no exista alternativa (mano degenerada)
    const pool = s.drawn !== null ? [...st.hand, s.drawn] : st.hand
    if (pool.some((id) => tile34Of(id) !== s.justCalled)) {
      throw new Error('kuikae: no puede descartarse el tipo recién llamado')
    }
  }
  if (st.riichi > 0 && s.drawn !== null && tile !== s.drawn) {
    throw new Error('en riichi solo se descarta la ficha robada')
  }

  st.ippatsu = false // su ventana de ippatsu se cierra con su descarte
  moveTileOut(s, tile)
  st.pond.push(tile)
  st.discarded.push(tile34Of(tile))
  s.justCalled = null
  s.rinshan = false
  s.pendingRiichi = riichi

  const offers = offersFor(s, seat, tile, false)
  if (offers.length > 0) {
    s.phase = 'reaction'
    s.reaction = {
      from: seat,
      tile,
      chankan: false,
      offers,
      responses: [null, null, null, null],
    }
    return s
  }
  return advanceAfterDiscard(s, seat, tile)
}

function applyRiichi(s: HandState, tile: TileId): HandState {
  if (s.phase !== 'discard') throw new Error(`riichi en fase ${s.phase}`)
  if (!riichiOptions(s).includes(tile)) throw new Error('riichi ilegal')
  const st = s.seats[s.turn]!
  const level: 1 | 2 = st.discarded.length === 0 && !s.anyCall ? 2 : 1
  return applyDiscard(s, tile, level)
}

/** Tras un descarte sin ron: furiten, commit de riichi, abortos, turno. */
function advanceAfterDiscard(s: HandState, from: Seat, tile: TileId): HandState {
  const t = tile34Of(tile)

  // furiten por dejar pasar (aplica aunque no hubiera oferta por falta de yaku)
  for (const seat of [0, 1, 2, 3] as const) {
    if (seat === from) continue
    const st = s.seats[seat]!
    const waits = waitsOf(st.hand.map(tile34Of), st.melds.length)
    if (waits.includes(t)) {
      st.missedRon = true
      if (st.riichi > 0) st.riichiFuriten = true
    }
  }

  // el riichi se consuma: deposita el palo
  if (s.pendingRiichi !== null) {
    const st = s.seats[from]!
    st.riichi = s.pendingRiichi
    st.riichiIndex = st.pond.length - 1
    st.ippatsu = true
    st.points -= 1000
    s.sticks += 1
    s.pendingRiichi = null
  }

  // abortos que se comprueban al pasar un descarte
  const abort = checkAborts(s)
  if (abort) return endAbort(s, abort)

  s.turn = ((from + 1) % 4) as Seat
  s.drawn = null
  s.phase = 'draw'
  s.reaction = null
  return s
}

function checkAborts(s: HandState): 'suufon' | 'suucha-riichi' | 'suukaikan' | null {
  // suufon renda: 4 primeros descartes, mismo viento, sin llamadas
  if (
    !s.anyCall &&
    s.seats.every((st) => st.discarded.length === 1) &&
    s.seats.every((st) => st.discarded[0]! >= 27 && st.discarded[0]! <= 30) &&
    new Set(s.seats.map((st) => st.discarded[0]!)).size === 1
  ) {
    return 'suufon'
  }
  // suucha riichi
  if (s.seats.every((st) => st.riichi > 0)) return 'suucha-riichi'
  // suukaikan: 4 kans de asientos distintos
  if (s.kanCount === 4) {
    const allOne = s.seats.some(
      (st) => st.melds.filter((m) => m.kind === 'kan' || m.kind === 'ankan').length === 4,
    )
    if (!allOne) return 'suukaikan'
  }
  return null
}

// --- victorias ------------------------------------------------------------------

function applyTsumo(s: HandState, abilities: Abilities): HandState {
  if (s.phase !== 'discard') throw new Error(`tsumo en fase ${s.phase}`)
  let score = tsumoScore(s)
  if (!score) throw new Error('tsumo ilegal')
  score = abilities[s.turn]?.onWin?.(s, score) ?? score
  return endTsumo(s, s.turn, s.drawn!, score)
}

function endTsumo(s: HandState, winner: Seat, winTile: TileId, score: WinScore): HandState {
  const deltas = [0, 0, 0, 0]
  for (const seat of [0, 1, 2, 3] as const) {
    if (seat === winner) continue
    const pays =
      winner === s.dealer
        ? score.fromEach!
        : seat === s.dealer
          ? score.fromDealer!
          : score.fromEach!
    deltas[seat] = -pays
  }
  deltas[winner] = score.total
  return endHand(s, { type: 'tsumo', winner, winTile, score, deltas })
}

function endRon(
  s: HandState,
  winner: Seat,
  from: Seat,
  winTile: TileId,
  score: WinScore,
  chankan: boolean,
): HandState {
  const deltas = [0, 0, 0, 0]
  deltas[from] = -score.ron!
  deltas[winner] = score.total
  return endHand(s, { type: 'ron', winner, from, winTile, score, deltas, chankan })
}

function endExhaustive(s: HandState): HandState {
  const tenpai = ([0, 1, 2, 3] as const).map((seat) => isTenpai(s, seat))
  const n = tenpai.filter(Boolean).length
  const deltas = [0, 0, 0, 0]
  if (n > 0 && n < 4) {
    for (const seat of [0, 1, 2, 3] as const) {
      deltas[seat] = tenpai[seat]! ? 3000 / n : -3000 / (4 - n)
    }
  }
  // los palos de riichi quedan sobre la mesa (los arrastra la siguiente mano)
  return endHand(s, { type: 'exhaustive', tenpai, deltas })
}

function endAbort(s: HandState, reason: 'kyuushu' | 'suufon' | 'suucha-riichi' | 'suukaikan'): HandState {
  return endHand(s, { type: 'abort', reason, deltas: [0, 0, 0, 0] })
}

function endHand(s: HandState, end: HandEnd): HandState {
  for (const seat of [0, 1, 2, 3] as const) {
    s.seats[seat]!.points += end.deltas[seat]!
  }
  if (end.type === 'tsumo' || end.type === 'ron') s.sticks = 0
  s.end = end
  s.phase = 'ended'
  s.reaction = null
  s.pendingRiichi = null
  // pendingKan se conserva: en un ron por chankan la ficha del kan robado
  // sigue existiendo ahí (conservación de las 136)
  return s
}

// --- kans -----------------------------------------------------------------------

function takeFromHand(st: { hand: TileId[] }, t: Tile34, n: number): TileId[] {
  const taken: TileId[] = []
  for (let i = st.hand.length - 1; i >= 0 && taken.length < n; i--) {
    if (tile34Of(st.hand[i]!) === t) taken.push(...st.hand.splice(i, 1))
  }
  if (taken.length < n) throw new Error(`faltan copias de ${t} en la mano`)
  return taken
}

function afterKan(s: HandState, seat: Seat): HandState {
  s.kanCount++
  s.wall.doraRevealed++ // regla: el indicador se revela inmediatamente
  for (const st of s.seats) st.ippatsu = false // un kan corta cualquier ippatsu
  s.anyCall = true
  s.drawn = drawRinshan(s.wall)
  s.rinshan = true
  s.turn = seat
  s.phase = 'discard'
  s.reaction = null
  return s
}

function applyAnkan(s: HandState, t: Tile34): HandState {
  if (s.phase !== 'discard') throw new Error(`ankan en fase ${s.phase}`)
  if (!ankanOptions(s).includes(t)) throw new Error('ankan ilegal')
  const st = s.seats[s.turn]!

  // reunir las 4 copias entre mano y robada
  const tiles: TileId[] = []
  if (s.drawn !== null && tile34Of(s.drawn) === t) {
    tiles.push(s.drawn)
    s.drawn = null
  }
  tiles.push(...takeFromHand(st, t, 4 - tiles.length))
  if (s.drawn !== null) {
    st.hand.push(s.drawn)
    st.hand.sort((a, b) => a - b)
    s.drawn = null
  }
  st.melds.push({ kind: 'ankan', tiles })
  return afterKan(s, s.turn)
}

function applyShouminkan(s: HandState, tile: TileId): HandState {
  if (s.phase !== 'discard') throw new Error(`shouminkan en fase ${s.phase}`)
  if (!shouminkanOptions(s).includes(tile)) throw new Error('shouminkan ilegal')
  const st = s.seats[s.turn]!
  const t = tile34Of(tile)
  const meldIndex = st.melds.findIndex(
    (m) => m.kind === 'pon' && tile34Of(m.tiles[0]!) === t,
  )

  // sacar la ficha (de la robada o de la mano; la robada entra a la mano)
  moveTileOut(s, tile)

  // ventana de chankan: solo ron
  const offers = offersFor(s, s.turn, tile, true)
  s.pendingKan = { seat: s.turn, meldIndex, tile }
  if (offers.length > 0) {
    s.phase = 'reaction'
    s.reaction = {
      from: s.turn,
      tile,
      chankan: true,
      offers,
      responses: [null, null, null, null],
    }
    return s
  }
  return completeShouminkan(s)
}

function completeShouminkan(s: HandState): HandState {
  const { seat, meldIndex, tile } = s.pendingKan!
  const st = s.seats[seat]!
  const old = st.melds[meldIndex]!
  st.melds[meldIndex] = { ...old, kind: 'kan', tiles: [...old.tiles, tile], added: tile }
  s.pendingKan = null
  return afterKan(s, seat)
}

// --- kyuushu --------------------------------------------------------------------

function applyKyuushu(s: HandState): HandState {
  if (s.phase !== 'discard') throw new Error(`kyuushu en fase ${s.phase}`)
  if (!canKyuushu(s)) throw new Error('kyuushu ilegal')
  return endAbort(s, 'kyuushu')
}

// --- reacciones -----------------------------------------------------------------

function applyReaction(
  s: HandState,
  action: Extract<Action, { seat: Seat }>,
  abilities: Abilities,
): HandState {
  if (s.phase !== 'reaction' || !s.reaction) {
    throw new Error(`reacción en fase ${s.phase}`)
  }
  const r = s.reaction
  const offer = r.offers.find((o) => o.seat === action.seat)
  if (!offer) throw new Error(`el asiento ${action.seat} no tiene oferta`)
  if (r.responses[action.seat] !== null) {
    throw new Error(`el asiento ${action.seat} ya respondió`)
  }

  // validar que la respuesta corresponde a la oferta
  const resp: ReactionResponse = (() => {
    switch (action.type) {
      case 'pass': return { type: 'pass' as const }
      case 'ron':
        if (!offer.ron) throw new Error('ron no ofrecido')
        return { type: 'ron' as const }
      case 'pon':
        if (!offer.pon) throw new Error('pon no ofrecido')
        return { type: 'pon' as const }
      case 'daiminkan':
        if (!offer.kan) throw new Error('kan no ofrecido')
        return { type: 'daiminkan' as const }
      case 'chi':
        if (!offer.chi.includes(action.start)) throw new Error('chi no ofrecido')
        return { type: 'chi' as const, start: action.start }
    }
  })()
  r.responses[action.seat] = resp

  // ¿faltan respuestas?
  if (r.offers.some((o) => r.responses[o.seat] === null)) return s

  return resolveReaction(s, abilities)
}

function resolveReaction(s: HandState, abilities: Abilities): HandState {
  const r = s.reaction!
  const from = r.from
  const tile = r.tile

  // 1) ron — atamahane: el más cercano en orden de turno desde el descartador
  for (let k = 1; k <= 3; k++) {
    const seat = ((from + k) % 4) as Seat
    if (r.responses[seat]?.type === 'ron') {
      let score = ronScore(s, seat, tile, r.chankan)
      if (!score) throw new Error('ron ilegal en resolución')
      score = abilities[seat]?.onWin?.(s, score) ?? score
      // el riichi pendiente del descartador no se consuma (recupera su palo)
      s.pendingRiichi = null
      return endRon(s, seat, from, tile, score, r.chankan)
    }
  }

  // 2) todos pasaron un chankan: completar el kan
  if (r.chankan) {
    markMissedRon(s, from, tile)
    s.reaction = null
    return completeShouminkan(s)
  }

  // 3) pon / daiminkan
  for (const o of r.offers) {
    const resp = r.responses[o.seat]!
    if (resp.type === 'pon' || resp.type === 'daiminkan') {
      markMissedRon(s, from, tile)
      commitPendingRiichi(s, from)
      return executeCall(s, o.seat, from, tile, resp)
    }
  }
  // 4) chi
  for (const o of r.offers) {
    const resp = r.responses[o.seat]!
    if (resp.type === 'chi') {
      markMissedRon(s, from, tile)
      commitPendingRiichi(s, from)
      return executeCall(s, o.seat, from, tile, resp)
    }
  }

  // 5) todos pasaron
  return advanceAfterDiscard(s, from, tile)
}

/** Furiten por dejar pasar, cuando la resolución no fue ron. */
function markMissedRon(s: HandState, from: Seat, tile: TileId): void {
  const t = tile34Of(tile)
  for (const seat of [0, 1, 2, 3] as const) {
    if (seat === from) continue
    const st = s.seats[seat]!
    const waits = waitsOf(st.hand.map(tile34Of), st.melds.length)
    if (waits.includes(t)) {
      st.missedRon = true
      if (st.riichi > 0) st.riichiFuriten = true
    }
  }
}

/** El descarte de riichi fue llamado (pon/kan/chi): el riichi se consuma. */
function commitPendingRiichi(s: HandState, from: Seat): void {
  if (s.pendingRiichi === null) return
  const st = s.seats[from]!
  st.riichi = s.pendingRiichi
  st.riichiIndex = st.pond.length - 1
  st.ippatsu = false // la llamada corta el ippatsu de inmediato
  st.points -= 1000
  s.sticks += 1
  s.pendingRiichi = null
}

function executeCall(
  s: HandState,
  caller: Seat,
  from: Seat,
  tile: TileId,
  resp: Extract<ReactionResponse, { type: 'pon' | 'daiminkan' | 'chi' }>,
): HandState {
  const st = s.seats[caller]!
  const fromSt = s.seats[from]!
  const t = tile34Of(tile)

  // la ficha llamada sale del pond visual (el historial `discarded` queda)
  const pondIdx = fromSt.pond.lastIndexOf(tile)
  if (pondIdx !== -1) fromSt.pond.splice(pondIdx, 1)

  for (const x of s.seats) x.ippatsu = false
  s.anyCall = true
  s.reaction = null

  if (resp.type === 'pon') {
    const taken = takeFromHand(st, t, 2)
    const meld: Meld = { kind: 'pon', tiles: [tile, ...taken], from, called: tile }
    st.melds.push(meld)
    s.turn = caller
    s.drawn = null
    s.justCalled = t
    s.phase = 'discard'
    return s
  }
  if (resp.type === 'daiminkan') {
    const taken = takeFromHand(st, t, 3)
    st.melds.push({ kind: 'kan', tiles: [tile, ...taken], from, called: tile })
    return afterKan(s, caller)
  }
  // chi
  const others = [resp.start, resp.start + 1, resp.start + 2].filter((x) => x !== t)
  const taken = others.map((x) => takeFromHand(st, x, 1)[0]!)
  st.melds.push({ kind: 'chi', tiles: [tile, ...taken], from, called: tile })
  s.turn = caller
  s.drawn = null
  s.justCalled = t
  s.phase = 'discard'
  return s
}
