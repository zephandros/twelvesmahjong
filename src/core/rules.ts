// Legalidad de jugadas: construcción del WinContext, ofertas de reacción a un
// descarte, y opciones de riichi / tsumo / kan / kyuushu. Único lugar donde se
// decide qué se puede hacer; el reducer ejecuta, los bots y la UI consultan.
//
// Reglas fijadas (documentadas):
//  - En el descarte de houtei (muro vivo a 0) solo se ofrece ron.
//  - Kuikae: tras chi/pon no puede descartarse el mismo TIPO llamado (el
//    kuikae de suji se permite).
//  - Ankan en riichi: solo de la ficha recién robada y sin cambiar esperas.
//  - Sin chankan sobre ankan (variante de kokushi no implementada).

import type { Tile34, TileId } from './tile'
import { tile34Of, isTerminalOrHonor } from './tile'
import type { Seat } from './seat'
import { seatWind } from './seat'
import { doraIndicators, uraIndicators } from './wall'
import type { HandState, ReactionOffer } from './state'
import type { WinContext } from './win'
import { scoreWin, type WinScore } from './score'
import { waitsOf, isFuriten } from './furiten'
import { countsOf, shanten } from './shanten'

const t34s = (ids: readonly TileId[]): Tile34[] => ids.map(tile34Of)

// --- contexto de victoria -------------------------------------------------------

export function winContextFor(
  s: HandState,
  seat: Seat,
  winTile: TileId,
  tsumo: boolean,
  opts: { chankan?: boolean } = {},
): WinContext {
  const st = s.seats[seat]!
  const chankan = opts.chankan ?? false
  const noDiscardsYet = s.seats.every((x) => x.discarded.length === 0)
  return {
    concealed: st.hand,
    winTile,
    melds: st.melds,
    tsumo,
    seatWind: seatWind(seat, s.dealer),
    roundWind: s.roundWind,
    riichi: st.riichi,
    ippatsu: st.ippatsu && st.riichi > 0,
    doraIndicators: doraIndicators(s.wall),
    uraIndicators: st.riichi > 0 ? uraIndicators(s.wall) : [],
    haitei: tsumo && s.wall.live.length === 0 && !s.rinshan,
    houtei: !tsumo && s.wall.live.length === 0 && !chankan,
    rinshan: tsumo && s.rinshan,
    chankan,
    tenhou: tsumo && seat === s.dealer && !s.anyCall && noDiscardsYet,
    chiihou:
      tsumo && seat !== s.dealer && !s.anyCall && st.discarded.length === 0,
    dealer: seat === s.dealer,
    honba: s.honba,
    riichiSticks: s.sticks,
  }
}

/** Ron legal: la ficha completa la mano, no hay furiten y existe yaku. */
export function ronScore(
  s: HandState,
  seat: Seat,
  tile: TileId,
  chankan = false,
): WinScore | null {
  const st = s.seats[seat]!
  const waits = waitsOf(t34s(st.hand), st.melds.length)
  if (!waits.includes(tile34Of(tile))) return null
  if (isFuriten(waits, st.discarded, st.missedRon, st.riichiFuriten)) return null
  return scoreWin(winContextFor(s, seat, tile, false, { chankan }))
}

/** Tsumo legal con la ficha robada actual (mano completa + yaku). */
export function tsumoScore(s: HandState): WinScore | null {
  if (s.drawn === null) return null
  const st = s.seats[s.turn]!
  const c = countsOf([...t34s(st.hand), tile34Of(s.drawn)])
  if (shanten(c, st.melds.length) !== -1) return null
  return scoreWin(winContextFor(s, s.turn, s.drawn, true))
}

// --- ofertas de reacción ---------------------------------------------------------

/** Ofertas de los demás asientos ante un descarte (o un shouminkan). */
export function offersFor(
  s: HandState,
  from: Seat,
  tile: TileId,
  chankan: boolean,
): ReactionOffer[] {
  const t = tile34Of(tile)
  const offers: ReactionOffer[] = []
  const lastTile = s.wall.live.length === 0

  for (const seat of [0, 1, 2, 3] as const) {
    if (seat === from) continue
    const st = s.seats[seat]!
    const ron = ronScore(s, seat, tile, chankan) !== null

    let pon = false
    let kan = false
    const chi: Tile34[] = []
    if (!chankan && !lastTile && st.riichi === 0) {
      const inHand = st.hand.filter((id) => tile34Of(id) === t).length
      pon = inHand >= 2
      kan = inHand >= 3 && s.kanCount < 4
      if (seat === ((from + 1) % 4) && t < 27) {
        const base = Math.floor(t / 9) * 9
        const has = (x: Tile34) =>
          x >= base && x <= base + 8 && st.hand.some((id) => tile34Of(id) === x)
        for (const start of [t - 2, t - 1, t]) {
          if (start < base || start + 2 > base + 8) continue
          const others = [start, start + 1, start + 2].filter((x) => x !== t)
          if (others.every(has)) chi.push(start)
        }
      }
    }

    if (ron || pon || kan || chi.length > 0) {
      offers.push({ seat, ron, pon, kan, chi })
    }
  }
  return offers
}

// --- opciones del turno propio ----------------------------------------------------

/** Descartes con los que se puede declarar riichi (dejan la mano en tenpai). */
export function riichiOptions(s: HandState): TileId[] {
  const st = s.seats[s.turn]!
  if (s.drawn === null || st.riichi > 0) return []
  if (st.melds.some((m) => m.kind !== 'ankan')) return []
  if (st.points < 1000 || s.wall.live.length < 4) return []

  // por copia concreta, no por tipo: descartar el aka o la copia normal son
  // jugadas distintas y ambas deben ser legales
  const all = [...st.hand, s.drawn]
  const out: TileId[] = []
  const okByType = new Map<Tile34, boolean>()
  for (const id of all) {
    const t = tile34Of(id)
    let ok = okByType.get(t)
    if (ok === undefined) {
      const rest = all.filter((x) => x !== id)
      ok = shanten(countsOf(t34s(rest)), st.melds.length) === 0
      okByType.set(t, ok)
    }
    if (ok) out.push(id)
  }
  return out
}

/** Tipos con los que se puede declarar ankan ahora mismo. */
export function ankanOptions(s: HandState): Tile34[] {
  const st = s.seats[s.turn]!
  if (s.drawn === null || s.kanCount >= 4 || s.wall.live.length === 0) return []

  const all34 = [...t34s(st.hand), tile34Of(s.drawn)]
  const c = countsOf(all34)
  const out: Tile34[] = []
  for (let t = 0; t < 34; t++) {
    if (c[t]! !== 4) continue
    if (st.riichi > 0) {
      // solo de la robada y sin alterar las esperas
      if (t !== tile34Of(s.drawn)) continue
      const before = waitsOf(t34s(st.hand), st.melds.length)
      const afterHand = all34.filter((x) => x !== t)
      const after = waitsOf(afterHand, st.melds.length + 1)
      if (JSON.stringify(before) !== JSON.stringify(after)) continue
    }
    out.push(t)
  }
  return out
}

/** Fichas (robada o de mano) que amplían un pon propio a shouminkan. */
export function shouminkanOptions(s: HandState): TileId[] {
  const st = s.seats[s.turn]!
  if (s.drawn === null || s.kanCount >= 4 || s.wall.live.length === 0) return []
  if (st.riichi > 0) return []

  const ponTypes = new Set(
    st.melds.filter((m) => m.kind === 'pon').map((m) => tile34Of(m.tiles[0]!)),
  )
  return [...st.hand, s.drawn].filter((id) => ponTypes.has(tile34Of(id)))
}

/** Kyuushu kyuuhai: primer turno propio sin llamadas y ≥9 tipos T/H. */
export function canKyuushu(s: HandState): boolean {
  const st = s.seats[s.turn]!
  if (s.drawn === null || s.anyCall || st.discarded.length > 0) return false
  const kinds = new Set(
    [...t34s(st.hand), tile34Of(s.drawn)].filter(isTerminalOrHonor),
  )
  return kinds.size >= 9
}

/** Esperas actuales de un asiento (para UI e IA). */
export function seatWaits(s: HandState, seat: Seat): Tile34[] {
  const st = s.seats[seat]!
  return waitsOf(t34s(st.hand), st.melds.length)
}

/** Tenpai formal (para pagos de noten en agotamiento). */
export function isTenpai(s: HandState, seat: Seat): boolean {
  const st = s.seats[seat]!
  return shanten(countsOf(t34s(st.hand)), st.melds.length) === 0
}
