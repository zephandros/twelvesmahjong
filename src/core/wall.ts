// Muro: 136 fichas barajadas → muro muerto (14) + muro vivo (122), y reparto
// inicial de 13 fichas por asiento (quedan 70 robos vivos).
//
// Disposición del muro muerto (índices de `dead`), simplificación estable de la
// disposición física — lo que importa a las reglas es qué ficha sale de dónde:
//   dead[0..3]   rinshan (robos tras kan)
//   dead[4..8]   indicadores de dora (dead[4] se revela al inicio)
//   dead[9..13]  indicadores de ura dora (bajo los anteriores)

import type { TileId } from './tile'
import { TILEID_COUNT } from './tile'
import type { Rng } from './rng'
import { shuffle } from './rng'

export const DEAD_WALL_SIZE = 14
export const HAND_SIZE = 13
export const LIVE_DRAWS = TILEID_COUNT - DEAD_WALL_SIZE - HAND_SIZE * 4 // 70

export interface Wall {
  /** Fichas por robar; la próxima es el ÚLTIMO elemento (pop). */
  live: TileId[]
  /** Muro muerto: 14 fijas + reposiciones tras cada kan (ver disposición). */
  dead: TileId[]
  /** Nº de indicadores de dora revelados (1 al inicio, +1 por kan). */
  doraRevealed: number
  /** Robos de rinshan ya consumidos (0..4). */
  rinshanDrawn: number
}

/** Los 136 TileId barajados con el RNG dado. */
export function buildWall(rng: Rng): TileId[] {
  const tiles: TileId[] = []
  for (let id = 0; id < TILEID_COUNT; id++) tiles.push(id)
  return shuffle(tiles, rng)
}

export interface DealResult {
  wall: Wall
  /** 4 manos de 13, ordenadas ascendentes por TileId. */
  hands: TileId[][]
}

/**
 * Robo de rinshan tras un kan: la ficha SALE del frente del muerto (por eso
 * los índices de indicadores se corrigen con rinshanDrawn) y el muerto se
 * repone con una del vivo (los robos vivos disminuyen en 1).
 */
export function drawRinshan(wall: Wall): TileId {
  if (wall.rinshanDrawn >= 4) throw new Error('sin fichas de rinshan')
  const tile = wall.dead.shift()!
  wall.rinshanDrawn++
  if (wall.live.length > 0) wall.dead.push(wall.live.shift()!)
  return tile
}

/** Separa muro muerto y reparte 13 fichas a cada asiento. */
export function deal(tiles: readonly TileId[]): DealResult {
  if (tiles.length !== TILEID_COUNT) {
    throw new Error(`el muro debe tener ${TILEID_COUNT} fichas, tiene ${tiles.length}`)
  }
  const dead = tiles.slice(0, DEAD_WALL_SIZE)
  const live = tiles.slice(DEAD_WALL_SIZE)

  const hands: TileId[][] = []
  for (let s = 0; s < 4; s++) {
    hands.push(live.splice(-HAND_SIZE).sort((a, b) => a - b))
  }

  return {
    wall: { live, dead, doraRevealed: 1, rinshanDrawn: 0 },
    hands,
  }
}

/** Indicadores de dora visibles (Tile34 se deriva fuera; esto son TileId). */
export function doraIndicators(wall: Wall): TileId[] {
  const out: TileId[] = []
  const base = 4 - wall.rinshanDrawn // el frente del muerto se consume en kans
  for (let i = 0; i < wall.doraRevealed; i++) out.push(wall.dead[base + i]!)
  return out
}

/** Indicadores de ura dora (solo se muestran si el ganador declaró riichi). */
export function uraIndicators(wall: Wall): TileId[] {
  const out: TileId[] = []
  const base = 9 - wall.rinshanDrawn
  for (let i = 0; i < wall.doraRevealed; i++) out.push(wall.dead[base + i]!)
  return out
}
