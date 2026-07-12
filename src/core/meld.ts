// Llamadas (melds). La mecánica de llamar llega en la fase 4; la puntuación
// (fase 3) ya necesita los tipos: fu y kuisagari dependen de qué está abierto.

import type { Tile34, TileId } from './tile'
import { tile34Of } from './tile'

export type MeldKind =
  | 'chi' // corrida robada al kamicha
  | 'pon' // trío robado
  | 'kan' // cuarteto abierto (daiminkan/shouminkan)
  | 'ankan' // cuarteto cerrado: no rompe menzen

export interface Meld {
  readonly kind: MeldKind
  /** 3 fichas (chi/pon) o 4 (kan/ankan). */
  readonly tiles: readonly TileId[]
  /** Asiento al que se robó la ficha (no aplica a ankan). Para la UI. */
  readonly from?: number
  /** La ficha concreta que se llamó (se gira en la UI). */
  readonly called?: TileId
}

/** Un ankan no rompe la mano cerrada; todo lo demás sí. */
export const isOpenMeld = (m: Meld): boolean => m.kind !== 'ankan'

export const isKan = (m: Meld): boolean => m.kind === 'kan' || m.kind === 'ankan'

/** Tipo (Tile34) más bajo del meld: la corrida se identifica por su inicio. */
export function meldTile(m: Meld): Tile34 {
  return Math.min(...m.tiles.map(tile34Of))
}
