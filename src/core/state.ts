// Estado completo de una mano. Serializable a JSON (arrays, números, null,
// booleanos): una partida = seed + log de acciones. La mano en `hand` siempre
// tiene 13−3·melds fichas ordenadas; la robada vive aparte en `drawn`.
//
// Los arrays son mutables por pragmatismo: el reducer clona el estado entero
// antes de tocarlo (cloneState) y los consumidores no deben mutar.

import type { Tile34, TileId } from './tile'
import type { Seat } from './seat'
import type { Wall } from './wall'
import { buildWall, deal } from './wall'
import type { Meld } from './meld'
import type { Abilities } from './hooks'
import type { WinScore } from './score'
import { makeRng } from './rng'

export type Phase = 'draw' | 'discard' | 'reaction' | 'ended'

export interface SeatState {
  /** Fichas ocultas (13 − 3·melds), ordenadas por TileId. */
  hand: TileId[]
  melds: Meld[]
  /** Pond visual: las fichas llamadas se retiran de aquí. */
  pond: TileId[]
  /** Historial completo de descartes (para furiten; nunca se retira nada). */
  discarded: Tile34[]
  riichi: 0 | 1 | 2
  /** Índice en `pond` de la ficha de riichi (para girarla en la UI). */
  riichiIndex: number | null
  ippatsu: boolean
  /** Furiten temporal: dejó pasar una espera; se limpia en su siguiente robo. */
  missedRon: boolean
  /** Furiten de riichi: permanente el resto de la mano. */
  riichiFuriten: boolean
  points: number
}

export interface ReactionOffer {
  seat: Seat
  ron: boolean
  pon: boolean
  /** daiminkan */
  kan: boolean
  /** Inicios de corrida posibles para chi (solo el shimocha). */
  chi: Tile34[]
}

export type ReactionResponse =
  | { type: 'pass' }
  | { type: 'ron' }
  | { type: 'pon' }
  | { type: 'daiminkan' }
  | { type: 'chi'; start: Tile34 }

export interface Reaction {
  /** Quién descartó (o quién declara el shouminkan si `chankan`). */
  from: Seat
  tile: TileId
  chankan: boolean
  offers: ReactionOffer[]
  /** Respuesta de cada asiento con oferta; null = pendiente. */
  responses: Array<ReactionResponse | null>
}

export type AbortReason = 'kyuushu' | 'suufon' | 'suucha-riichi' | 'suukaikan'

export type HandEnd =
  | { type: 'tsumo'; winner: Seat; winTile: TileId; score: WinScore; deltas: number[] }
  | {
      type: 'ron'
      winner: Seat
      from: Seat
      winTile: TileId
      score: WinScore
      deltas: number[]
      chankan: boolean
    }
  | { type: 'exhaustive'; tenpai: boolean[]; deltas: number[] }
  | { type: 'abort'; reason: AbortReason; deltas: number[] }

export interface HandState {
  seed: number
  dealer: Seat
  roundWind: Tile34
  honba: number
  /** Palos de riichi sobre la mesa (incluye arrastrados de manos previas). */
  sticks: number
  wall: Wall
  seats: SeatState[]
  turn: Seat
  drawn: TileId | null
  /** El robo actual vino del muro muerto (rinshan). */
  rinshan: boolean
  /** Hubo alguna llamada en la mano (tenhou/chiihou/double riichi/suufon). */
  anyCall: boolean
  kanCount: number
  /** Riichi declarado pendiente de que el descarte pase sin ron. */
  pendingRiichi: 1 | 2 | null
  /** Shouminkan pendiente de la ventana de chankan. */
  pendingKan: { seat: Seat; meldIndex: number; tile: TileId } | null
  /** Tipo recién llamado por el asiento en turno (kuikae: no descartable). */
  justCalled: Tile34 | null
  phase: Phase
  reaction: Reaction | null
  end: HandEnd | null
}

export interface HandOptions {
  points?: number[]
  honba?: number
  sticks?: number
  roundWind?: Tile34
}

export function initHand(
  seed: number,
  dealer: Seat,
  abilities: Abilities = {},
  opts: HandOptions = {},
): HandState {
  const rng = makeRng(seed)
  let tiles = buildWall(rng)
  for (const seat of [0, 1, 2, 3] as const) {
    const hook = abilities[seat]?.onBuildWall
    if (hook) tiles = hook(tiles, rng)
  }
  const { wall, hands } = deal(tiles)
  const points = opts.points ?? [25000, 25000, 25000, 25000]

  return {
    seed,
    dealer,
    roundWind: opts.roundWind ?? 27,
    honba: opts.honba ?? 0,
    sticks: opts.sticks ?? 0,
    wall,
    seats: hands.map((hand, i) => ({
      hand,
      melds: [],
      pond: [],
      discarded: [],
      riichi: 0 as const,
      riichiIndex: null,
      ippatsu: false,
      missedRon: false,
      riichiFuriten: false,
      points: points[i]!,
    })),
    turn: dealer,
    drawn: null,
    rinshan: false,
    anyCall: false,
    kanCount: 0,
    pendingRiichi: null,
    pendingKan: null,
    justCalled: null,
    phase: 'draw',
    reaction: null,
    end: null,
  }
}

/** Clon profundo de lo mutable; el reducer trabaja siempre sobre un clon. */
export function cloneState(s: HandState): HandState {
  return {
    ...s,
    wall: {
      ...s.wall,
      live: [...s.wall.live],
      dead: [...s.wall.dead],
    },
    seats: s.seats.map((st) => ({
      ...st,
      hand: [...st.hand],
      melds: st.melds.map((m) => ({ ...m, tiles: [...m.tiles] })),
      pond: [...st.pond],
      discarded: [...st.discarded],
    })),
    reaction: s.reaction
      ? {
          ...s.reaction,
          offers: s.reaction.offers.map((o) => ({ ...o, chi: [...o.chi] })),
          responses: [...s.reaction.responses],
        }
      : null,
    pendingKan: s.pendingKan ? { ...s.pendingKan } : null,
    end: s.end, // inmutable una vez creado
  }
}
