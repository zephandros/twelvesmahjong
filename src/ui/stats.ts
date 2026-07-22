// Estadísticas acumuladas del jugador, persistidas en localStorage. Como
// settings.ts: loadStats nunca lanza y ante datos corruptos vuelve a cero.
//
// `recordHand` y `recordGame` son PURAS (devuelven un Stats nuevo): se pueden
// testear sin DOM y sin localStorage, que es donde estaría el riesgo real de
// contar mal.

import type { HandState } from '../core/state'
import type { Seat } from '../core/seat'
import type { YakuId } from '../core/yaku'
import type { PlayerResult } from '../core/results'
import type { Action } from '../core/actions'

export interface BestHand {
  points: number
  han: number
  fu: number
  yakuman: number
}

export interface Stats {
  /** Partidas terminadas. */
  games: number
  /** Nº de veces en cada puesto (índice 0 = 1º). */
  places: number[]
  /** Suma de resultados finales (unidades de 1000), para la media. */
  totalScore: number
  /** Manos jugadas hasta el final (incluye agotamientos y abortos). */
  hands: number
  winsTsumo: number
  winsRon: number
  /** Manos que perdió por descartar la ficha ganadora. */
  dealIns: number
  /** Agotamientos de muro, y en cuántos estaba tenpai. */
  draws: number
  tenpaiAtDraw: number
  riichi: number
  riichiWins: number
  /** Chi/pon/kan cantados. */
  calls: number
  best: BestHand | null
  /** Cuántas veces se ha conseguido cada yaku. */
  yaku: Partial<Record<YakuId, number>>
}

const KEY = 'tm-stats-v1'

export const EMPTY_STATS: Stats = {
  games: 0,
  places: [0, 0, 0, 0],
  totalScore: 0,
  hands: 0,
  winsTsumo: 0,
  winsRon: 0,
  dealIns: 0,
  draws: 0,
  tenpaiAtDraw: 0,
  riichi: 0,
  riichiWins: 0,
  calls: 0,
  best: null,
  yaku: {},
}

/** Acciones del humano que cuentan como llamada. */
const CALL_TYPES: ReadonlySet<Action['type']> = new Set<Action['type']>([
  'chi', 'pon', 'daiminkan', 'ankan', 'shouminkan',
])

/** Suma al contador la acción que acaba de hacer el jugador humano. */
export function recordAction(s: Stats, action: Action): Stats {
  if (action.type === 'riichi') return { ...s, riichi: s.riichi + 1 }
  if (CALL_TYPES.has(action.type)) return { ...s, calls: s.calls + 1 }
  return s
}

/** Suma una mano terminada. `human` es el asiento del jugador. */
export function recordHand(s: Stats, state: HandState, human: Seat): Stats {
  const end = state.end
  if (!end) return s
  const out: Stats = { ...s, hands: s.hands + 1, places: [...s.places], yaku: { ...s.yaku } }

  if (end.type === 'exhaustive') {
    out.draws++
    if (end.tenpai[human]) out.tenpaiAtDraw++
    return out
  }
  if (end.type === 'abort') return out

  if (end.winner === human) {
    if (end.type === 'tsumo') out.winsTsumo++
    else out.winsRon++
    if (state.seats[human]!.riichi > 0) out.riichiWins++

    const sc = end.score
    for (const y of sc.yaku) out.yaku[y.id] = (out.yaku[y.id] ?? 0) + 1
    if (!out.best || sc.total > out.best.points) {
      out.best = { points: sc.total, han: sc.han, fu: sc.fu, yakuman: sc.yakuman }
    }
  } else if (end.type === 'ron' && end.from === human) {
    out.dealIns++
  }
  return out
}

/** Suma una partida terminada a partir de su clasificación final. */
export function recordGame(s: Stats, results: readonly PlayerResult[], human: Seat): Stats {
  const mine = results.find((r) => r.seat === human)
  if (!mine) return s
  const places = [...s.places]
  places[mine.place - 1] = (places[mine.place - 1] ?? 0) + 1
  return { ...s, games: s.games + 1, places, totalScore: s.totalScore + mine.total }
}

/** Puesto medio (1..4). 0 si aún no hay partidas. */
export function averagePlace(s: Stats): number {
  if (s.games === 0) return 0
  return s.places.reduce((a, n, i) => a + n * (i + 1), 0) / s.games
}

export function loadStats(): Stats {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return structuredClone(EMPTY_STATS)
    const p = JSON.parse(raw) as Partial<Stats>
    const num = (v: unknown): number =>
      typeof v === 'number' && Number.isFinite(v) ? v : 0
    return {
      ...structuredClone(EMPTY_STATS),
      ...p,
      games: num(p.games),
      places: Array.isArray(p.places) && p.places.length === 4 ? p.places.map(num) : [0, 0, 0, 0],
      totalScore: num(p.totalScore),
      hands: num(p.hands),
      winsTsumo: num(p.winsTsumo),
      winsRon: num(p.winsRon),
      dealIns: num(p.dealIns),
      draws: num(p.draws),
      tenpaiAtDraw: num(p.tenpaiAtDraw),
      riichi: num(p.riichi),
      riichiWins: num(p.riichiWins),
      calls: num(p.calls),
      best: p.best && typeof p.best.points === 'number' ? p.best : null,
      yaku: p.yaku && typeof p.yaku === 'object' ? p.yaku : {},
    }
  } catch {
    return structuredClone(EMPTY_STATS)
  }
}

export function saveStats(s: Stats): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(s))
  } catch {
    /* modo privado / cuota: las estadísticas valen solo esta sesión */
  }
}

export function clearStats(): void {
  try {
    localStorage.removeItem(KEY)
  } catch {
    /* nada que hacer */
  }
}
