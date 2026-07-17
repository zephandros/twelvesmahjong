// Capa de 136 nodos persistentes, uno por TileId. Nunca se recrea el DOM:
// cada update aplica transform/tamaño/cara y las transiciones CSS animan el
// movimiento (muro → mano → descarte → meld) sin framework.
//
// Los nodos los fabrica un TileView (SpriteRenderer en producción, BoxRenderer
// con ?renderer=box): un solo camino de render para mesa y win-screen. El
// cambio de cara es contrato de clases tm-tile--{face}, común a los renderers.

import type { TileId } from '../core/tile'
import { TILEID_COUNT, labelId } from '../core/tile'
import type { Placement } from './geometry'
import type { TileView } from './tile-view'

interface Node {
  el: HTMLElement
  face: string
}

export class TileLayer {
  private readonly nodes = new Map<TileId, Node>()

  constructor(
    stage: HTMLElement,
    private readonly view: TileView,
    onTileClick: (id: TileId) => void,
  ) {
    const layer = document.createElement('div')
    layer.className = 'tm-tile-layer'

    for (let id = 0; id < TILEID_COUNT; id++) {
      const el = this.view.create('back', id)
      el.dataset.id = String(id)
      layer.appendChild(el)
      this.nodes.set(id, { el, face: 'back' })
    }

    layer.addEventListener('click', (ev) => {
      const t = (ev.target as HTMLElement).closest<HTMLElement>('.tm-tile')
      if (!t || !t.classList.contains('is-clickable')) return
      onTileClick(Number(t.dataset.id))
    })
    layer.addEventListener('keydown', (ev) => {
      if (ev.key !== 'Enter' && ev.key !== ' ') return
      const t = (ev.target as HTMLElement).closest<HTMLElement>('.tm-tile')
      if (!t || !t.classList.contains('is-clickable')) return
      ev.preventDefault()
      onTileClick(Number(t.dataset.id))
    })

    stage.appendChild(layer)
  }

  update(placements: ReadonlyMap<TileId, Placement>): void {
    for (const [id, p] of placements) {
      const n = this.nodes.get(id)!
      const { el } = n

      el.style.width = `${p.w}px`
      el.style.height = `${p.h}px`
      el.style.zIndex = String(p.z)
      el.style.transform =
        `translate3d(${p.cx - p.w / 2}px, ${p.cy - p.h / 2}px, 0) rotate(${p.rot}deg)`

      if (n.face !== p.face) {
        el.classList.remove(`tm-tile--${n.face}`)
        el.classList.add(`tm-tile--${p.face}`)
        n.face = p.face
      }
      el.classList.toggle('is-hidden', !p.visible)
      el.classList.toggle('is-clickable', p.clickable)
      el.classList.toggle('is-highlight', p.highlight)
      el.classList.toggle('is-dim', p.dim)

      // accesibilidad: la ficha clicable es un botón real
      if (p.clickable) {
        el.setAttribute('role', 'button')
        el.setAttribute('aria-label', `descartar ${labelId(id)}`)
        el.setAttribute('tabindex', '0')
      } else {
        el.removeAttribute('role')
        el.removeAttribute('aria-label')
        el.removeAttribute('tabindex')
      }

      this.view.layout?.(el, p.w)
    }
  }
}
