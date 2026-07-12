// Renderer de fichas detrás de una interfaz. Hoy: BoxRenderer (caja + etiqueta).
// Cuando lleguen los assets del usuario: SpriteRenderer, sin tocar core/ ni la
// lógica de tablero. NO se genera arte de fichas. Ver CLAUDE.md.

import type { TileId } from '../core/tile'
import { labelId, tile34Of, suitOf, isAka } from '../core/tile'

/** Orientación de una ficha sobre la mesa. */
export type TileFace =
  | 'front' // cara visible (mano propia, descartes, dora revelado)
  | 'back' // dorso (mano rival, dora oculto)
  | 'side' // de canto (mano rival lateral)

export interface TileView {
  /** Tamaño base en px de escenario (ancho). El alto se deriva del ratio. */
  readonly baseWidth: number
  /** Crea el nodo DOM de una ficha. `id` puede omitirse para dorsos. */
  create(face: TileFace, id?: TileId): HTMLElement
}

// Ratio único normalizado (los del mockup oscilan 0.71–0.75; unificamos). El
// arte final se recortará a este ratio. Ver plan, aviso de tamaños de ficha.
export const TILE_RATIO = 0.72

/** Color de tinta de la etiqueta según palo, para lectura rápida al depurar. */
function inkFor(id: TileId): string {
  if (isAka(id)) return '#d94f4f'
  switch (suitOf(tile34Of(id))) {
    case 'm': return '#8a2b1e'
    case 'p': return '#1f3a63'
    case 's': return '#1f5a2e'
    case 'z': return '#2a2a2a'
  }
}

/**
 * Placeholder: rectángulo redondeado hueso con la etiqueta corta centrada.
 * `width` es el ancho en px de escenario; el alto sale de TILE_RATIO.
 */
export class BoxRenderer implements TileView {
  constructor(readonly baseWidth: number) {}

  create(face: TileFace, id?: TileId): HTMLElement {
    const el = document.createElement('div')
    el.className = `tm-tile tm-tile--${face}`
    const w = this.baseWidth
    const h = Math.round(w / TILE_RATIO)
    el.style.width = `${w}px`
    el.style.height = `${h}px`

    if (face === 'front' && id !== undefined) {
      const span = document.createElement('span')
      span.className = 'tm-tile__label'
      span.textContent = labelId(id)
      span.style.color = inkFor(id)
      el.appendChild(span)
      el.dataset.tile = labelId(id)
    }
    return el
  }
}
