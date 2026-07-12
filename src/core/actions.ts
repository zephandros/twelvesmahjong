// Acciones del juego. El log de acciones + la semilla reproducen la partida.
// Las acciones de reacción llevan `seat` (las emite un asiento distinto al
// del turno); el resto las emite siempre `state.turn`.

import type { Tile34, TileId } from './tile'
import type { Seat } from './seat'

export type Action =
  // fase 'draw'
  | { type: 'draw' }
  // fase 'discard' (el asiento en turno, tras robar o llamar)
  | { type: 'discard'; tile: TileId }
  | { type: 'riichi'; tile: TileId } // declara riichi y descarta `tile`
  | { type: 'tsumo' }
  | { type: 'ankan'; tile34: Tile34 }
  | { type: 'shouminkan'; tile: TileId }
  | { type: 'kyuushu' } // abort de 9 tipos en el primer turno
  // fase 'reaction'
  | { type: 'pass'; seat: Seat }
  | { type: 'ron'; seat: Seat }
  | { type: 'pon'; seat: Seat }
  | { type: 'daiminkan'; seat: Seat }
  | { type: 'chi'; seat: Seat; start: Tile34 }
