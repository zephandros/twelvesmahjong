// Capa de 136 nodos persistentes, uno por TileId. Nunca se recrea el DOM:
// cada update aplica transform/tamaño/cara y las transiciones CSS animan el
// movimiento (muro → mano → descarte → meld) sin framework.

import type { TileId } from '../core/tile'
import { TILEID_COUNT, labelId, tile34Of, suitOf, isAka } from '../core/tile'
import type { Placement } from './geometry'

function inkFor(id: TileId): string {
  if (isAka(id)) return '#d94f4f'
  switch (suitOf(tile34Of(id))) {
    case 'm': return '#8a2b1e'
    case 'p': return '#1f3a63'
    case 's': return '#1f5a2e'
    case 'z': return '#2a2a2a'
  }
}

interface Node {
  el: HTMLElement
  label: HTMLElement
  face: string
}

export class TileLayer {
  private readonly nodes = new Map<TileId, Node>()

  constructor(stage: HTMLElement, onTileClick: (id: TileId) => void) {
    const layer = document.createElement('div')
    layer.className = 'tm-tile-layer'

    for (let id = 0; id < TILEID_COUNT; id++) {
      const el = document.createElement('div')
      el.className = 'tm-tile tm-tile--back'
      el.dataset.id = String(id)
      const label = document.createElement('span')
      label.className = 'tm-tile__label'
      label.textContent = labelId(id)
      label.style.color = inkFor(id)
      el.appendChild(label)
      layer.appendChild(el)
      this.nodes.set(id, { el, label, face: 'back' })
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
      const { el, label } = n

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

      // etiqueta: solo boca arriba; tamaño según ancho de ficha
      const showLabel = p.face === 'front' && p.visible
      label.style.display = showLabel ? '' : 'none'
      if (showLabel) {
        const long = label.textContent!.length > 2
        label.style.fontSize = `${Math.round(p.w * (long ? 0.3 : 0.48))}px`
      }
    }
  }
}
