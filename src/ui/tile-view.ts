// Renderer de fichas detrás de una interfaz. SpriteRenderer (arte SVG horneado
// en public/tiles/ por scripts/build-tiles.mjs) es el de producción;
// BoxRenderer (caja + etiqueta) sobrevive como fallback de depuración:
// añade ?renderer=box a la URL. Sin tocar core/. Ver CLAUDE.md.

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
  /**
   * Crea el nodo DOM de una ficha. `id` puede omitirse para dorsos.
   * La cara se expresa SIEMPRE como clase `tm-tile--{face}`; quien mueva la
   * ficha después (TileLayer) cambia la cara alternando esas clases — el
   * contrato es común a todos los renderers, que pintan por CSS.
   */
  create(face: TileFace, id?: TileId): HTMLElement
  /** Ajustes dependientes del ancho actual (BoxRenderer: font-size). */
  layout?(el: HTMLElement, w: number): void
}

// Ratio único normalizado del CUERPO de la ficha (los del mockup oscilan
// 0.71–0.75). El glifo SVG (viewBox 139.764×200, ratio 0.699) se pinta
// centrado con `contain` dentro de la cara: la diferencia la absorbe el fit.
export const TILE_RATIO = 0.72

/** Fábrica: SpriteRenderer salvo que la URL pida el fallback (?renderer=box). */
export function createTileView(baseWidth: number): TileView {
  const box = new URLSearchParams(location.search).get('renderer') === 'box'
  return box ? new BoxRenderer(baseWidth) : new SpriteRenderer(baseWidth)
}

function sizedTile(face: TileFace, w: number): HTMLElement {
  const el = document.createElement('div')
  el.className = `tm-tile tm-tile--${face}`
  el.style.width = `${w}px`
  el.style.height = `${Math.round(w / TILE_RATIO)}px`
  return el
}

/**
 * Renderer de producción: el glifo es un SVG de public/tiles/ referenciado
 * una sola vez como custom property `--glyph` (los glifos son multicolor,
 * así que nada de CSS mask). El cuerpo (bisel, cara hueso, dorso) es CSS puro
 * sobre custom props --tile-* de :root.
 */
export class SpriteRenderer implements TileView {
  constructor(readonly baseWidth: number) {}

  create(face: TileFace, id?: TileId): HTMLElement {
    const el = sizedTile(face, this.baseWidth)
    if (id !== undefined) {
      const label = labelId(id)
      el.dataset.tile = label
      // URL relativa al documento, igual que los retratos (base '' de Vite)
      el.style.setProperty('--glyph', `url("tiles/${label}.svg")`)
    }
    return el
  }
}

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
 * Fallback de depuración: rectángulo hueso con la etiqueta corta centrada.
 * La etiqueta existe siempre que haya `id` (CSS la oculta en back/side).
 */
export class BoxRenderer implements TileView {
  constructor(readonly baseWidth: number) {}

  create(face: TileFace, id?: TileId): HTMLElement {
    const el = sizedTile(face, this.baseWidth)
    if (id !== undefined) {
      const span = document.createElement('span')
      span.className = 'tm-tile__label'
      span.textContent = labelId(id)
      span.style.color = inkFor(id)
      el.appendChild(span)
      el.dataset.tile = labelId(id)
      this.layout(el, this.baseWidth)
    }
    return el
  }

  layout(el: HTMLElement, w: number): void {
    const label = el.querySelector<HTMLElement>('.tm-tile__label')
    if (!label) return
    const long = (label.textContent ?? '').length > 2
    label.style.fontSize = `${Math.round(w * (long ? 0.3 : 0.48))}px`
  }
}
