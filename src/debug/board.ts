// Página ?debug=board: reproduce la pantalla 1A del mockup con bounding boxes.
// Sirve para validar el layout (y el mapeo de asientos de seat.ts) contra
// ../Mahjong/screenshots/Screenshot_1.png a la misma escala.

import { createStage, place } from '../ui/layout'
import { BoxRenderer, type TileFace } from '../ui/tile-view'
import type { Tile34, TileId } from '../core/tile'
import { parseTile } from '../core/tile'
import {
  SEATS, type Seat, seatWind, relSeat, cornerOf, windColor, windKanji,
} from '../core/seat'

// Tile34 → TileId usando la copia 1 (no la 0), que nunca es aka: así los 5
// normales del debug se ven normales, como en el mockup. Ver AKA_IDS.
const tid = (t: Tile34): TileId => (t << 2) | 1
const ids = (notation: string[]): TileId[] => notation.map((s) => tid(parseTile(s)))

// --- constructores de piezas ------------------------------------------------

function frontRow(width: number, gap: number, tiles: TileId[]): HTMLElement {
  const r = new BoxRenderer(width)
  const row = document.createElement('div')
  row.className = 'tm-row'
  row.style.gap = `${gap}px`
  for (const id of tiles) row.appendChild(r.create('front', id))
  return row
}

function faceRow(
  width: number, gap: number, n: number, face: TileFace, vertical = false,
): HTMLElement {
  const r = new BoxRenderer(width)
  const row = document.createElement('div')
  row.className = vertical ? 'tm-col' : 'tm-row'
  row.style.gap = `${gap}px`
  for (let i = 0; i < n; i++) row.appendChild(r.create(face))
  return row
}

/** Rejilla de descartes: filas de `cols`. */
function discardPool(tiles: TileId[], cols: number): HTMLElement {
  const r = new BoxRenderer(30)
  const grid = document.createElement('div')
  grid.style.display = 'grid'
  grid.style.gridTemplateColumns = `repeat(${cols}, auto)`
  grid.style.gap = '3px'
  for (const id of tiles) grid.appendChild(r.create('front', id))
  return grid
}

/** Columna de fichas de canto (mano rival lateral): rects 46×25 landscape. */
function sideColumn(n: number): HTMLElement {
  const col = document.createElement('div')
  col.className = 'tm-col'
  col.style.gap = '3px'
  for (let i = 0; i < n; i++) {
    const t = document.createElement('div')
    t.className = 'tm-tile tm-tile--side'
    t.style.width = '46px'
    t.style.height = '25px'
    col.appendChild(t)
  }
  return col
}

function portrait(place_: string, name: string, wind: Tile34, score: string, isSelf: boolean): HTMLElement {
  const wrap = document.createElement('div')
  wrap.style.width = '132px'
  wrap.style.zIndex = '40'

  const col = document.createElement('div')
  col.className = 'tm-col'
  col.style.gap = '3px'

  const head = document.createElement('div')
  head.style.display = 'flex'
  head.style.justifyContent = 'space-between'
  head.style.alignItems = 'center'
  head.style.gap = '6px'
  head.innerHTML =
    `<span style="font-family:var(--ui);font-size:19px;color:var(--gold);letter-spacing:.06em">${place_}</span>` +
    `<span style="font-size:13px;color:var(--cream);text-shadow:0 1px 2px #000">${name}</span>`

  const frame = document.createElement('div')
  frame.style.position = 'relative'
  frame.style.height = '150px'
  frame.style.borderRadius = '9px'
  frame.style.overflow = 'hidden'
  frame.style.border = `2px solid ${isSelf ? 'var(--gold)' : '#7c8a7f'}`
  frame.style.boxShadow = isSelf ? '0 6px 18px rgba(0,0,0,.5),0 0 22px rgba(231,197,106,.55)' : '0 6px 18px rgba(0,0,0,.5)'
  frame.style.background = 'repeating-linear-gradient(135deg,#26303a 0 9px,#2d3844 9px 18px)'
  frame.innerHTML =
    `<div style="position:absolute;inset:0;display:grid;place-items:center;color:#5f6f7e;font-size:10px;letter-spacing:.18em;text-transform:uppercase">portrait</div>`
  const badge = document.createElement('div')
  badge.textContent = windKanji(wind)
  badge.style.cssText =
    `position:absolute;left:0;bottom:0;width:34px;height:34px;display:grid;place-items:center;` +
    `background:${windColor(wind)};border-top-right-radius:9px;font-family:var(--jp);font-weight:700;font-size:20px;color:#fff`
  frame.appendChild(badge)

  const scoreBar = document.createElement('div')
  scoreBar.style.cssText =
    'display:flex;align-items:center;gap:6px;background:rgba(6,12,9,.72);border:1px solid rgba(231,197,106,.3);border-radius:7px;padding:2px 8px'
  scoreBar.innerHTML =
    `<span style="width:7px;height:7px;border-radius:50%;background:${isSelf ? 'var(--gold)' : '#7c8a7f'}"></span>` +
    `<span style="font-family:var(--ui);font-size:26px;color:var(--cream)">${score}</span>`

  col.append(head, frame, scoreBar)
  wrap.appendChild(col)
  return wrap
}

function centerCounter(wall: number): HTMLElement {
  const box = document.createElement('div')
  box.style.cssText =
    'width:150px;border-radius:12px;background:linear-gradient(160deg,#12100c,#231d10);border:2px solid var(--gold);' +
    'box-shadow:0 10px 30px rgba(0,0,0,.6),inset 0 0 22px rgba(231,197,106,.14);padding:10px 12px 12px;' +
    'display:flex;flex-direction:column;align-items:center;gap:2px'
  box.innerHTML =
    `<div style="display:flex;align-items:center;gap:6px">` +
    `<span style="font-family:var(--jp);font-weight:700;font-size:15px;color:var(--gold)">東一局</span>` +
    `<span style="font-family:var(--ui);font-size:15px;letter-spacing:.1em;color:var(--muted)">EAST 1</span></div>` +
    `<div style="font-family:var(--ui);font-size:60px;line-height:.82;color:var(--cream);text-shadow:0 3px 8px rgba(0,0,0,.5)">${wall}</div>` +
    `<div style="font-size:10px;letter-spacing:.24em;color:var(--muted2);text-transform:uppercase;margin-top:-2px">tiles left</div>` +
    `<div style="display:flex;gap:10px;margin-top:6px;font-family:var(--ui);font-size:18px;color:#e0d7bd">` +
    `<span style="display:flex;align-items:center;gap:4px"><span style="width:9px;height:9px;border-radius:50%;background:#d94f4f"></span>0</span>` +
    `<span style="display:flex;align-items:center;gap:4px"><span style="width:16px;height:6px;border-radius:2px;background:linear-gradient(#f4ecd6,#cfc6ad);border:1px solid #b9a15a"></span>1</span></div>`
  return box
}

function actionButtons(): HTMLElement {
  const row = document.createElement('div')
  row.className = 'tm-row'
  row.style.gap = '8px'
  const defs: Array<[string, string, string, string]> = [
    ['RIICHI', 'var(--ink)', 'linear-gradient(var(--gold-lt),var(--gold))', 'var(--gold-lt)'],
    ['TSUMO', 'var(--cream)', 'rgba(10,18,12,.85)', 'var(--gold)'],
    ['PASS', 'var(--muted)', 'rgba(10,18,12,.7)', '#5f6f60'],
  ]
  for (const [label, fg, bg, bd] of defs) {
    const b = document.createElement('div')
    b.textContent = label
    b.style.cssText =
      `min-width:56px;text-align:center;padding:7px 12px;border-radius:22px;font-family:var(--ui);` +
      `font-size:22px;letter-spacing:.06em;line-height:1;color:${fg};background:${bg};border:1.5px solid ${bd};box-shadow:0 4px 12px rgba(0,0,0,.45)`
    row.appendChild(b)
  }
  return row
}

// --- montaje ----------------------------------------------------------------

export function renderDebugBoard(root: HTMLElement): void {
  const stage = createStage(root)

  const self: Seat = 0
  const dealer: Seat = 0
  const scores: Record<number, string> = { 27: '29,900', 28: '25,100', 29: '24,600', 30: '20,400' }
  const names: Record<string, string> = { self: 'PLAYER', shimo: 'RIVAL·S', toimen: 'RIVAL·W', kami: 'RIVAL·N' }
  const places: Record<number, string> = { 27: '1st', 28: '2nd', 29: '3rd', 30: '4th' }
  const cornerCss: Record<string, Record<string, number>> = {
    bl: { left: 10, bottom: 10 }, br: { right: 10, bottom: 10 },
    tr: { right: 10, top: 10 }, tl: { left: 10, top: 10 },
  }

  // retratos en las 4 esquinas, según seat.ts (mapeo CORREGIDO)
  for (const seat of SEATS) {
    const rel = relSeat(seat, self)
    const wind = seatWind(seat, dealer)
    const corner = cornerOf(rel)
    const p = portrait(places[wind]!, names[rel]!, wind, scores[wind]!, rel === 'self')
    place(p, { ...cornerCss[corner]!, z: 40 })
    stage.appendChild(p)
  }

  // manos rivales
  stage.appendChild(place(faceRow(30, 3, 13, 'back'), { top: 22, left: 640, centerX: true, z: 20 }))
  stage.appendChild(place(sideColumn(13), { left: 150, top: 360, centerY: true, z: 20 }))
  stage.appendChild(place(sideColumn(13), { right: 150, top: 360, centerY: true, z: 20 }))

  // descartes (con rotaciones del mockup)
  const discSelf = ids(['9p', '1s', 'haku', '9m', 'chun', '1p', '6s', 'S', '6m'])
  const discTop = ids(['W', '5m', '2p', '5s', 'hatsu', '1m', '3p'])
  const discLeft = ids(['9s', '7p', 'N', '4m', '3s', '3p', 'E'])
  const discRight = ids(['8m', '8p', '2s', 'chun', '2m', '6p', '8s'])
  stage.appendChild(place(discardPool(discSelf, 6), { left: 640, top: 398, transform: 'translateX(-50%)', z: 15 }))
  stage.appendChild(place(discardPool(discTop, 6), { left: 640, top: 150, transform: 'translateX(-50%) rotate(180deg)', z: 15 }))
  stage.appendChild(place(discardPool(discLeft, 6), { left: 318, top: 360, transform: 'translate(-50%,-50%) rotate(90deg)', z: 15 }))
  stage.appendChild(place(discardPool(discRight, 6), { right: 318, top: 360, transform: 'translate(50%,-50%) rotate(-90deg)', z: 15 }))

  // contador central
  stage.appendChild(place(centerCounter(25), { left: 640, top: 360, transform: 'translate(-50%,-50%)', z: 30 }))

  // dora / muro muerto
  const doraWrap = document.createElement('div')
  doraWrap.className = 'tm-col'
  doraWrap.style.alignItems = 'center'
  doraWrap.style.gap = '4px'
  doraWrap.innerHTML = `<span style="font-size:9px;letter-spacing:.2em;color:var(--muted3);text-transform:uppercase">DORA</span>`
  const doraRow = document.createElement('div')
  doraRow.className = 'tm-row'
  doraRow.style.gap = '2px'
  const doraR = new BoxRenderer(24)
  doraRow.append(
    doraR.create('back'), doraR.create('back'),
    doraR.create('front', tid(parseTile('5p'))),
    doraR.create('back'), doraR.create('back'),
  )
  doraWrap.appendChild(doraRow)
  stage.appendChild(place(doraWrap, { left: 735, top: 288, z: 16 }))

  // mano del jugador + ficha robada separada
  const handWrap = document.createElement('div')
  handWrap.className = 'tm-row'
  handWrap.style.alignItems = 'flex-end'
  handWrap.style.gap = '16px'
  handWrap.style.zIndex = '35'
  handWrap.appendChild(frontRow(46, 4, ids(['1m', '2m', '3m', '4p', '5p', '6p', '2s', '3s', '4s', '7s', '8s', 'E', 'E'])))
  const drawn = frontRow(46, 4, ids(['9s']))
  drawn.style.filter = 'drop-shadow(0 3px 9px rgba(231,197,106,.65))'
  handWrap.appendChild(drawn)
  stage.appendChild(place(handWrap, { left: 640, bottom: 14, transform: 'translateX(-50%)', z: 35 }))

  // acciones + "your turn"
  stage.appendChild(place(actionButtons(), { right: 150, bottom: 104, z: 45 }))
  const turn = document.createElement('div')
  turn.textContent = '— YOUR TURN —'
  turn.style.cssText = 'font-family:var(--ui);font-size:16px;letter-spacing:.28em;color:var(--gold);text-transform:uppercase'
  stage.appendChild(place(turn, { left: 640, bottom: 98, transform: 'translateX(-50%)', z: 35 }))
}
