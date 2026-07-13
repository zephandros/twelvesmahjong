import type { Meld } from '../core/meld'
import type { Seat } from '../core/seat'
import { relSeat } from '../core/seat'
import type { TileId } from '../core/tile'
import { tile34Of } from '../core/tile'

export interface MeldSlot {
  id: TileId
  /** Ficha girada 90 grados respecto a la orientación base del borde. */
  sideways: boolean
  /** Extremos del ankan, boca abajo. */
  faceDown: boolean
  /** Ficha añadida del shouminkan; se apila sobre la ficha llamada anterior. */
  stack: boolean
}

const tileOrder = (a: TileId, b: TileId): number => tile34Of(a) - tile34Of(b) || a - b

function calledSlotIndex(m: Meld, owner: Seat, baseCount: number): number | null {
  if (m.called === undefined || m.from === undefined) return null
  const from = m.kind === 'chi' ? 'kami' : relSeat(m.from, owner)
  switch (from) {
    case 'kami': return 0
    case 'toimen': return Math.floor((baseCount - 1) / 2)
    case 'shimo': return baseCount - 1
    case 'self': return null
  }
}

function slot(id: TileId, sideways = false, faceDown = false, stack = false): MeldSlot {
  return { id, sideways, faceDown, stack }
}

function insertStack(slots: MeldSlot[], m: Meld): MeldSlot[] {
  if (m.added === undefined || m.called === undefined) return slots
  const i = slots.findIndex((s) => s.id === m.called)
  if (i < 0) return slots
  return [
    ...slots.slice(0, i + 1),
    slot(m.added, true, false, true),
    ...slots.slice(i + 1),
  ]
}

/** Orden visual canónico de un meld abierto, independiente del borde de pantalla. */
export function meldLayout(m: Meld, owner: Seat): MeldSlot[] {
  if (m.kind === 'ankan') {
    return m.tiles.map((id, i) => slot(id, false, i === 0 || i === m.tiles.length - 1))
  }

  const baseTiles = (m.added === undefined ? [...m.tiles] : m.tiles.filter((id) => id !== m.added))
  const calledIndex = calledSlotIndex(m, owner, baseTiles.length)

  if (m.called === undefined || calledIndex === null) {
    return baseTiles.map((id) => slot(id))
  }

  if (m.kind === 'chi') {
    const others = baseTiles.filter((id) => id !== m.called).sort(tileOrder)
    return insertStack([slot(m.called, true), ...others.map((id) => slot(id))], m)
  }

  const out: Array<MeldSlot | undefined> = new Array(baseTiles.length)
  out[calledIndex] = slot(m.called, true)
  const others = baseTiles.filter((id) => id !== m.called).sort(tileOrder)
  for (let i = 0; i < out.length; i++) {
    if (out[i]) continue
    const id = others.shift()
    if (id !== undefined) out[i] = slot(id)
  }
  return insertStack(out.filter((s): s is MeldSlot => s !== undefined), m)
}
