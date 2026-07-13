// Posición de las 136 fichas en el escenario 1920×1080 a partir del HandState.
// Función pura (testeable sin DOM): la capa de nodos persistentes solo aplica
// lo que salga de aquí, y las transiciones CSS animan los movimientos.
//
// Coordenadas del mockup Figma (raw/code/index.tsx): mesa 4:3 (x 240..1680),
// centro 180×180 en (960,540), molinete de descartes alrededor, manos rivales
// pegadas a los bordes de la mesa. Orientación de asientos: seat.ts es el único
// punto de verdad; aquí solo se traduce RelSeat → borde (edgeOf).

import type { HandState } from '../core/state'
import type { TileId } from '../core/tile'
import { TILEID_COUNT } from '../core/tile'
import type { Seat, RelSeat, Edge } from '../core/seat'
import { SEATS, relSeat, edgeOf } from '../core/seat'

export type Face = 'front' | 'back' | 'side'

export interface Placement {
  /** Centro del box en px de escenario. */
  cx: number
  cy: number
  /** Tamaño de la ficha SIN rotar; la rotación gira el nodo entero. */
  w: number
  h: number
  /** Grados en sentido horario. */
  rot: number
  face: Face
  z: number
  visible: boolean
  clickable: boolean
  highlight: boolean
}

export interface GeometryOpts {
  human: Seat
  revealAll: boolean
  clickable: ReadonlySet<TileId>
  highlight: ReadonlySet<TileId>
}

const CX = 960
const CY = 540

// Tres tamaños de ficha (mockup): mano propia grande, descartes/melds medianos,
// manos rivales pequeñas (de canto). Ratio de cara ≈ 0.72.
const HAND = { w: 68, h: 90 } // mano del jugador (boca arriba, grande)
const DISC = { w: 45, h: 60 } // descartes, melds y manos rivales reveladas
const OPP = { w: 45, h: 30 } // ficha rival oculta (pequeña)
const DORA = { w: 26, h: 34 } // indicadores en el centro

const hidden = (): Placement => ({
  cx: CX, cy: CY, w: DISC.w, h: DISC.h, rot: 0,
  face: 'back', z: 1, visible: false, clickable: false, highlight: false,
})

export function computePlacements(
  s: HandState,
  o: GeometryOpts,
): Map<TileId, Placement> {
  const out = new Map<TileId, Placement>()
  for (let id = 0; id < TILEID_COUNT; id++) out.set(id, hidden())

  const put = (id: TileId, p: Partial<Placement>): void => {
    const base = out.get(id)!
    out.set(id, {
      ...base, ...p,
      visible: true,
      clickable: o.clickable.has(id),
      highlight: o.highlight.has(id),
    })
  }

  for (const seat of SEATS) placeSeat(s, o, seat, relSeat(seat, o.human), put)
  placeDora(s, put)
  return out
}

type Put = (id: TileId, p: Partial<Placement>) => void

function placeSeat(s: HandState, o: GeometryOpts, seat: Seat, rel: RelSeat, put: Put): void {
  const st = s.seats[seat]!
  const drawn = s.turn === seat ? s.drawn : null
  const edge = edgeOf(rel)

  if (rel === 'self') placeSelfHand(st.hand, drawn, put)
  else placeOppHand(st.hand, drawn, edge, o.revealAll, put)

  placePond(st, edge, put)
  placeMelds(st, edge, put)
}

// --- manos --------------------------------------------------------------------

function placeSelfHand(hand: readonly TileId[], drawn: TileId | null, put: Put): void {
  const n = hand.length
  const step = HAND.w
  const gap = 18 // separación de la robada
  const total = n * step + (drawn !== null ? gap + HAND.w : 0)
  const x0 = CX - total / 2
  const cy = 1080 - 45 // fila inferior de la mesa (y 990..1080)
  hand.forEach((id, i) => {
    put(id, { cx: x0 + i * step + HAND.w / 2, cy, w: HAND.w, h: HAND.h, face: 'front', z: 35 })
  })
  if (drawn !== null) {
    put(drawn, { cx: x0 + n * step + gap + HAND.w / 2, cy, w: HAND.w, h: HAND.h, face: 'front', z: 35 })
  }
}

// Manos rivales pegadas al borde de la mesa. Ocultas: dorsos pequeños. Reveladas
// (fin de mano): frentes medianos girados hacia el dueño para que se lean.
function placeOppHand(
  hand: readonly TileId[], drawn: TileId | null, edge: Edge, reveal: boolean, put: Put,
): void {
  const n = hand.length
  const step = 45
  const total = n * step + (drawn !== null ? 12 + step : 0)

  const tile = (i: number, id: TileId): void => {
    if (edge === 'top') {
      const x0 = CX - total / 2
      const cx = x0 + i * step + step / 2
      if (reveal) put(id, { cx, cy: 34, w: DISC.w, h: DISC.h, rot: 180, face: 'front', z: 20 })
      else put(id, { cx, cy: 16, w: OPP.w, h: OPP.h, face: 'back', z: 20 })
    } else {
      // laterales: columna vertical pegada al borde izquierdo/derecho
      const y0 = CY - total / 2
      const cy = y0 + i * step + step / 2
      const cx = edge === 'left' ? 255 : 1665
      if (reveal) {
        put(id, { cx: edge === 'left' ? 272 : 1648, cy, w: DISC.w, h: DISC.h, rot: edge === 'left' ? 90 : 270, face: 'front', z: 20 })
      } else {
        put(id, { cx, cy, w: OPP.h, h: OPP.w, face: 'back', z: 20 })
      }
    }
  }

  hand.forEach((id, i) => tile(i, id))
  if (drawn !== null) tile(n, drawn)
}

// --- descartes (molinete alrededor del centro) --------------------------------

// 6 columnas por lado, ficha 45×60. Cada pila se llena desde la esquina pegada
// al cuadro central en el orden izquierda→derecha DEL DUEÑO (que mira al centro):
// self mira arriba, shimo a la izquierda, toimen abajo, kami a la derecha, así
// que top y right van espejados respecto a self. La ficha de riichi se gira 90°
// y corre las siguientes de su fila para no solaparse (lo pidió el jugador).
function pondPos(edge: Edge, col: number, row: number): { cx: number; cy: number; rot: number } {
  switch (edge) {
    case 'bottom': return { cx: 870 + col * 45 + 22.5, cy: 630 + row * 60 + 30, rot: 0 }
    case 'top': return { cx: 1050 - col * 45 - 22.5, cy: 420 - row * 60, rot: 0 }
    case 'left': return { cx: 840 - row * 60, cy: 472.5 + col * 45, rot: 270 }
    case 'right': return { cx: 1080 + row * 60, cy: 607.5 - col * 45, rot: 270 }
  }
}

function placePond(st: HandState['seats'][number], edge: Edge, put: Put): void {
  const rIdx = st.riichiIndex
  st.pond.forEach((id, i) => {
    const col = i % 6
    const row = Math.floor(i / 6)
    const p = pondPos(edge, col, row)
    let { cx, cy } = p
    let rot = p.rot
    // corrimiento: si la ficha de riichi está antes en la MISMA fila, se corren
    // 15px EN LA DIRECCIÓN DE LLENADO (que difiere por borde)
    if (rIdx !== null && rIdx >= 0 && Math.floor(rIdx / 6) === row && rIdx % 6 < col) {
      if (edge === 'bottom') cx += 15
      else if (edge === 'top') cx -= 15
      else if (edge === 'left') cy += 15
      else cy -= 15
    }
    if (rIdx === i) rot += 90 // ficha con la que se declaró riichi
    put(id, { cx, cy, w: DISC.w, h: DISC.h, rot, face: 'front', z: 15 })
  })
}

// --- melds --------------------------------------------------------------------

// Grupos cantados junto al borde de cada jugador, medianos (45×60). Ankan:
// primera y última boca abajo, como en mesa real.
function placeMelds(st: HandState['seats'][number], edge: Edge, put: Put): void {
  if (st.melds.length === 0) return
  const w = DISC.w
  const step = w + 2
  const gap = 12

  const rows = st.melds.map((m) => m.tiles.length * step - 2)
  let cursor = 0
  st.melds.forEach((m, mi) => {
    m.tiles.forEach((id, ti) => {
      const back = m.kind === 'ankan' && (ti === 0 || ti === m.tiles.length - 1)
      const off = cursor + ti * step
      let cx: number
      let cy: number
      let rot = 0
      switch (edge) {
        case 'bottom': cx = 1660 - off - w / 2; cy = 1080 - 30; break
        case 'top': cx = 260 + off + w / 2; cy = 30; rot = 180; break
        case 'left': cx = 30; cy = 260 + off + w / 2; rot = 90; break
        case 'right': cx = 1890; cy = 1050 - off - w / 2; rot = 270; break
      }
      put(id, { cx, cy, w, h: DISC.h, rot, face: back ? 'back' : 'front', z: 18 })
    })
    cursor += rows[mi]! + gap
  })
}

// --- dora (dentro del recuadro central) ---------------------------------------

function placeDora(s: HandState, put: Put): void {
  const base = 4 - s.wall.rinshanDrawn
  for (let i = 0; i < 5; i++) {
    const id = s.wall.dead[base + i]
    if (id === undefined) continue
    put(id, {
      cx: CX + (i - 2) * 30, cy: 478, w: DORA.w, h: DORA.h,
      face: i < s.wall.doraRevealed ? 'front' : 'back', z: 31,
    })
  }
}
