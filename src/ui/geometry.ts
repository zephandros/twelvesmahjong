// Posición de las 136 fichas en el escenario 1280×720 a partir del HandState.
// Función pura (testeable sin DOM): la capa de nodos persistentes solo aplica
// lo que salga de aquí, y las transiciones CSS animan los movimientos.
//
// Coordenadas del mockup (ver plan). Orientación de asientos: seat.ts es el
// único punto de verdad; aquí solo se traduce RelSeat → borde de pantalla.

import type { HandState } from '../core/state'
import type { TileId } from '../core/tile'
import { TILEID_COUNT } from '../core/tile'
import type { Seat, RelSeat } from '../core/seat'
import { SEATS, relSeat } from '../core/seat'

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
  /** Asiento del humano (abajo). */
  human: Seat
  /** Mostrar todas las manos boca arriba (fin de mano). */
  revealAll: boolean
  /** Fichas clicables ahora mismo (las decide el controlador). */
  clickable: ReadonlySet<TileId>
  /** Fichas destacadas (robada, seleccionables para riichi…). */
  highlight: ReadonlySet<TileId>
}

const CX = 640
const CY = 360

const hidden = (): Placement => ({
  cx: CX, cy: CY, w: 30, h: 42, rot: 0,
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
      ...base,
      ...p,
      visible: true,
      clickable: o.clickable.has(id),
      highlight: o.highlight.has(id),
    })
  }

  for (const seat of SEATS) placeSeat(s, o, seat, relSeat(seat, o.human), put)
  placeDora(s, put)
  return out
}

// --- manos --------------------------------------------------------------------

function placeSeat(
  s: HandState,
  o: GeometryOpts,
  seat: Seat,
  rel: RelSeat,
  put: (id: TileId, p: Partial<Placement>) => void,
): void {
  const st = s.seats[seat]!
  const drawn = s.turn === seat ? s.drawn : null

  // --- mano ---
  if (rel === 'self') {
    // fichas 46×64, paso 50; la robada separada 16px
    const n = st.hand.length
    const total = n * 50 - 4 + (drawn !== null ? 16 + 46 : 0)
    const x0 = CX - total / 2
    st.hand.forEach((id, i) => {
      put(id, { cx: x0 + i * 50 + 23, cy: 720 - 14 - 32, w: 46, h: 64, face: 'front', z: 35 })
    })
    if (drawn !== null) {
      put(drawn, {
        cx: x0 + n * 50 + 12 + 23, cy: 720 - 14 - 32, w: 46, h: 64,
        face: 'front', z: 35,
      })
    }
  } else if (rel === 'toimen') {
    const n = st.hand.length
    const total = n * 33 - 3 + (drawn !== null ? 12 + 30 : 0)
    const x0 = CX - total / 2
    // desde su perspectiva el orden va invertido; la robada queda a nuestra izquierda
    const face: Face = o.revealAll ? 'front' : 'back'
    if (drawn !== null) put(drawn, { cx: x0 + 15, cy: 43, w: 30, h: 42, rot: 180, face, z: 20 })
    const base = drawn !== null ? x0 + 30 + 12 : x0
    st.hand.forEach((id, i) => {
      const k = n - 1 - i
      put(id, { cx: base + k * 33 + 15, cy: 43, w: 30, h: 42, rot: 180, face, z: 20 })
    })
  } else {
    // laterales: canto 46×25 en columna; revelado → frente girado
    const isShimo = rel === 'shimo'
    const x = isShimo ? 1280 - 150 - 23 : 150 + 23
    const n = st.hand.length
    const step = o.revealAll ? 33 : 28
    const total = n * step - 3 + (drawn !== null ? 10 + (o.revealAll ? 30 : 25) : 0)
    const y0 = CY - total / 2
    const tileOf = (i: number): { cy: number } => ({ cy: y0 + i * step + (o.revealAll ? 15 : 12.5) })
    // shimo se ordena de abajo arriba (su izquierda), kami de arriba abajo
    st.hand.forEach((id, i) => {
      const k = isShimo ? n - 1 - i : i
      if (o.revealAll) {
        put(id, { cx: x, ...tileOf(k), w: 30, h: 42, rot: isShimo ? 270 : 90, face: 'front', z: 20 })
      } else {
        put(id, { cx: x, ...tileOf(k), w: 46, h: 25, rot: 0, face: 'side', z: 20 })
      }
    })
    if (drawn !== null) {
      const cy = y0 + n * step + 10 + (o.revealAll ? 15 : 12.5)
      if (o.revealAll) {
        put(drawn, { cx: x, cy, w: 30, h: 42, rot: isShimo ? 270 : 90, face: 'front', z: 20 })
      } else {
        put(drawn, { cx: x, cy, w: 46, h: 25, rot: 0, face: 'side', z: 20 })
      }
    }
  }

  placePond(s, seat, rel, put)
  placeMelds(s, seat, rel, put)
}

// --- descartes ------------------------------------------------------------------

// rejilla 6 columnas, ficha 30×42, paso 33/45; fila 0 pegada al centro y las
// siguientes crecen hacia el dueño. La ficha de riichi va girada 90° extra.
function placePond(
  s: HandState,
  seat: Seat,
  rel: RelSeat,
  put: (id: TileId, p: Partial<Placement>) => void,
): void {
  const st = s.seats[seat]!
  const halfRow = (6 * 33 - 3) / 2 // 97.5

  st.pond.forEach((id, i) => {
    const c = i % 6
    const r = Math.floor(i / 6)
    const riichi = st.riichiIndex === i
    let cx: number
    let cy: number
    let rot: number
    switch (rel) {
      case 'self':
        cx = CX - halfRow + c * 33 + 15
        cy = 398 + r * 45 + 21
        rot = 0
        break
      case 'toimen':
        cx = CX + halfRow - c * 33 - 15
        cy = 301 - r * 45
        rot = 180
        break
      case 'kami':
        cx = 397 - r * 45
        cy = CY - halfRow + c * 33 + 15
        rot = 90
        break
      case 'shimo':
        cx = 883 + r * 45
        cy = CY + halfRow - c * 33 - 15
        rot = 270
        break
    }
    put(id, { cx, cy, w: 30, h: 42, rot: rot + (riichi ? 90 : 0), face: 'front', z: 15 })
  })
}

// --- melds ----------------------------------------------------------------------

// Sin rotar, por legibilidad con bounding boxes (decisión v1; el arte final
// podrá orientarlos). Ankan: primera y última boca abajo, como en mesa real.
function placeMelds(
  s: HandState,
  seat: Seat,
  rel: RelSeat,
  put: (id: TileId, p: Partial<Placement>) => void,
): void {
  const st = s.seats[seat]!
  if (st.melds.length === 0) return

  const small = { w: 24, h: 33, stepX: 26, gap: 8, stepY: 39 }

  if (rel === 'self') {
    // fila única a la derecha de la mano, creciendo hacia la izquierda
    const w = 32
    const stepX = 34
    const widths = st.melds.map((m) => m.tiles.length * stepX - 2)
    const total = widths.reduce((a, b) => a + b, 0) + (st.melds.length - 1) * 10
    let x = 1280 - 170 - total
    st.melds.forEach((m, mi) => {
      m.tiles.forEach((id, ti) => {
        const back = m.kind === 'ankan' && (ti === 0 || ti === m.tiles.length - 1)
        put(id, {
          cx: x + ti * stepX + w / 2, cy: 720 - 16 - 22, w, h: 44,
          face: back ? 'back' : 'front', z: 18,
        })
      })
      x += widths[mi]! + 10
    })
    return
  }

  // rivales: pila de filas junto a su retrato
  const anchors: Record<Exclude<RelSeat, 'self'>, { x: number; y: number; alignRight: boolean; growDown: boolean }> = {
    shimo: { x: 1280 - 14, y: 500, alignRight: true, growDown: false },
    toimen: { x: 860, y: 43, alignRight: false, growDown: true },
    kami: { x: 14, y: 220, alignRight: false, growDown: true },
  }
  const a = anchors[rel as Exclude<RelSeat, 'self'>]
  st.melds.forEach((m, mi) => {
    const rowW = m.tiles.length * small.stepX - 2
    const y = a.growDown ? a.y + mi * small.stepY : a.y - mi * small.stepY
    const x0 = a.alignRight ? a.x - rowW : a.x
    m.tiles.forEach((id, ti) => {
      const back = m.kind === 'ankan' && (ti === 0 || ti === m.tiles.length - 1)
      put(id, {
        cx: x0 + ti * small.stepX + small.w / 2, cy: y + small.h / 2,
        w: small.w, h: small.h, face: back ? 'back' : 'front', z: 18,
      })
    })
  })
}

// --- dora -----------------------------------------------------------------------

// 5 huecos de indicador; los revelados boca arriba. El frente del muerto se
// consume con los kans, de ahí la base corrida (ver wall.ts).
function placeDora(
  s: HandState,
  put: (id: TileId, p: Partial<Placement>) => void,
): void {
  const base = 4 - s.wall.rinshanDrawn
  for (let i = 0; i < 5; i++) {
    const id = s.wall.dead[base + i]
    if (id === undefined) continue
    put(id, {
      cx: 735 + 12 + i * 26, cy: 288 + 16 + 16, w: 24, h: 33,
      face: i < s.wall.doraRevealed ? 'front' : 'back', z: 16,
    })
  }
}
