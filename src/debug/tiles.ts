// Página ?debug=tiles: verificación visual del mapeo de fichas (trampa 2).
// Rejilla con las 37 caras renderizadas por el TileView de producción, cada
// una con su label canónico y — en los honores — el glifo esperado al lado.
// El humano confirma que E muestra 東, hatsu el 發 verde, chun el 中 rojo,
// que S/W no están cruzados y que las aka son las rojas.
// Con ?renderer=box se ve el fallback para comparar.

import { createTileView } from '../ui/tile-view'
import { TILE34_COUNT, label34, AKA_IDS, labelId } from '../core/tile'
import type { Tile34, TileId } from '../core/tile'

const EXPECTED: Record<string, string> = {
  E: '東', S: '南', W: '西', N: '北', haku: '白', hatsu: '發', chun: '中',
}

// copia 1: nunca es aka (las aka van aparte con sus TileId 16/52/88)
const tid = (t: Tile34): TileId => (t << 2) | 1

export function renderDebugTiles(root: HTMLElement): void {
  const view = createTileView(64)

  const page = document.createElement('div')
  page.style.cssText =
    'min-height:100vh;background:#101816;padding:28px;box-sizing:border-box;' +
    'font-family:var(--ui);color:var(--cream)'

  const title = document.createElement('div')
  title.textContent = 'DEBUG · TILES — verificación del mapeo (raw/tiles → public/tiles)'
  title.style.cssText =
    'font-family:var(--display);font-size:22px;letter-spacing:.08em;color:var(--gold);margin-bottom:18px'
  page.appendChild(title)

  const grid = document.createElement('div')
  grid.style.cssText =
    'display:grid;grid-template-columns:repeat(9, auto);gap:14px 10px;justify-content:start'

  const addCell = (id: TileId, label: string): void => {
    const cell = document.createElement('div')
    cell.style.cssText = 'display:flex;flex-direction:column;align-items:center;gap:5px'
    cell.appendChild(view.create('front', id))
    const cap = document.createElement('div')
    const kanji = EXPECTED[label]
    cap.innerHTML = kanji
      ? `<b>${label}</b> · <span style="font-family:var(--jp)">${kanji}</span>`
      : `<b>${label}</b>`
    cap.style.cssText = 'font-size:13px;color:var(--muted, #b7a880)'
    cell.appendChild(cap)
    grid.appendChild(cell)
  }

  for (let t = 0; t < TILE34_COUNT; t++) addCell(tid(t), label34(t))
  for (const id of AKA_IDS) addCell(id, labelId(id))

  page.appendChild(grid)

  const note = document.createElement('div')
  note.textContent =
    'Comprobar: E=東 · S=南 · W=西 · N=北 · haku=白 · hatsu=發(verde) · chun=中(rojo) · 0m/0p/0s rojas'
  note.style.cssText = 'margin-top:18px;font-size:13px;letter-spacing:.04em;color:#8a9a90'
  page.appendChild(note)

  root.appendChild(page)
}
