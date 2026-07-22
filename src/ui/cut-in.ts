// Cut-in de llamada: viñeta de cómic en la esquina del asiento que canta —
// retrato del personaje recortado en trapecio, con el borde dorado y el rótulo.
// Presentación pura y sin temporizadores: el ritmo (duración, salto, encadenado
// con el destape) lo lleva el secuenciador de beats del controlador.
//
// El nodo es persistente: se muestra y se oculta, nunca se recrea — la misma
// regla que la capa de fichas.
//
// La forma va en SVG y no en `clip-path` de CSS por dos razones: un `border`
// sobre un recorte diagonal se engorda de forma desigual a lo largo de la
// diagonal, y `polygon()` no sabe redondear esquinas. Aquí un mismo path hace de
// recorte y de trazo.

import { place } from './layout'
import { relSeat, cornerOf, type Corner, type Seat } from '../core/seat'
import {
  portraitUrl, charName,
  type AltForm, type AltId, type Character, type CharacterId,
} from './characters'
import type { CallKind } from './audio/catalog'
import { t } from './i18n'

/** Viñeta 2:1 (el formato acordado para los paneles de expresión). */
const W = 480
const H = 240
/** Margen para que el trazo del borde no se salga del viewBox. */
const INSET = 2
/** Radio de las esquinas redondeadas. */
const RADIUS = 14
/** Fracción del ancho que se come la diagonal. */
const SLANT = 0.06
/** Desplazamiento de entrada: la viñeta llega desde su propia esquina. */
const ENTER_DX = 40

/** Anclaje de la viñeta por esquina, al estilo de PANEL_POS del HUD. Dentro de
 *  la mesa, junto al panel del personaje (que vive en el pasillo exterior). */
const CUTIN_POS: Record<Corner, { left?: number; right?: number; top?: number; bottom?: number }> = {
  tl: { left: 276, top: 48 },
  tr: { right: 276, top: 48 },
  bl: { left: 276, bottom: 48 },
  br: { right: 276, bottom: 48 },
}

/** Espejo de la forma base por esquina, para que el corte mire SIEMPRE al centro. */
const FLIP: Record<Corner, { x: boolean; y: boolean }> = {
  bl: { x: false, y: false },
  br: { x: true, y: false },
  tl: { x: false, y: true },
  tr: { x: true, y: true },
}

type Pt = { x: number; y: number }

/**
 * Trapecio rectángulo: un lado vertical entero y el opuesto comido por la
 * diagonal. La forma base (esquina inferior izquierda) corta arriba a la
 * derecha; las otras tres salen de espejarla.
 */
function shapeFor(flip: { x: boolean; y: boolean }): Pt[] {
  const x0 = INSET
  const y0 = INSET
  const x1 = W - INSET
  const y1 = H - INSET
  const cut = x0 + (x1 - x0) * (1 - SLANT)
  const base: Pt[] = [
    { x: x0, y: y0 },
    { x: cut, y: y0 },
    { x: x1, y: y1 },
    { x: x0, y: y1 },
  ]
  return base.map((p) => ({
    x: flip.x ? W - p.x : p.x,
    y: flip.y ? H - p.y : p.y,
  }))
}

/** Punto a distancia `r` de `from` en dirección a `to` (tope: la mitad del lado). */
function along(from: Pt, to: Pt, r: number): Pt {
  const dx = to.x - from.x
  const dy = to.y - from.y
  const len = Math.hypot(dx, dy) || 1
  const d = Math.min(r, len / 2)
  return { x: from.x + (dx / len) * d, y: from.y + (dy / len) * d }
}

/** Path cerrado con las esquinas redondeadas por curvas cuadráticas. */
function roundedPath(pts: readonly Pt[], r: number): string {
  const n = pts.length
  const out: string[] = []
  for (let i = 0; i < n; i++) {
    const cur = pts[i]!
    const prev = pts[(i - 1 + n) % n]!
    const next = pts[(i + 1) % n]!
    const a = along(cur, prev, r)
    const b = along(cur, next, r)
    out.push(`${i === 0 ? 'M' : 'L'}${a.x.toFixed(2)} ${a.y.toFixed(2)}`)
    out.push(`Q${cur.x.toFixed(2)} ${cur.y.toFixed(2)} ${b.x.toFixed(2)} ${b.y.toFixed(2)}`)
  }
  out.push('Z')
  return out.join(' ')
}

export type Expression = 'fierce' | 'sharp'

/**
 * Expresión de la viñeta según el canto. Dos, no tres: `calm` se descartó
 * (2026-07-21) porque para chi/pon/kan la cara tensa de `sharp` funciona mejor
 * que una neutra. → 2 piezas por personaje, 26 en total.
 */
export const EXPRESSION: Readonly<Record<CallKind, Expression>> = {
  chi: 'sharp',
  pon: 'sharp',
  kan: 'sharp',
  riichi: 'sharp',
  ron: 'fierce',
  tsumo: 'fierce',
}

/**
 * Quién tiene ya horneadas las 2 viñetas 2:1 (`{id}-cut-{expr}.jpg`). El arte
 * llega por tandas, así que esto NO es el roster: quien no esté cae al retrato
 * 9:16, que la viñeta recorta desde arriba. Al añadir un personaje: dejar sus
 * `{id}_cut_{fierce,sharp}.png` en raw/portraits/, `npm run assets:portraits`
 * y meterlo aquí. `tests/cutin-assets.test.ts` ata este set al disco.
 * Incluye a `hyde`, que no es un CharacterId pero sí tiene arte propio.
 */
export const HAS_CUT_IN: ReadonlySet<CharacterId | AltId> = new Set<CharacterId | AltId>([
  // orden canónico del roster; faltan celestina, huck y pinocchio
  'alice', 'dorian', 'jekyll', 'dracula', 'macbeth',
  'ahab', 'defarge', 'irene', 'scheherazade',
  'hyde',
])

/** URL de la viñeta de expresión (solo para quien está en HAS_CUT_IN). */
export const cutInUrl = (id: CharacterId | AltId, expr: Expression): string =>
  `portraits/${id}-cut-${expr}.jpg`

/**
 * Arte de la viñeta. Con paneles de expresión horneados usa el del canto; sin
 * ellos, el retrato 9:16 de siempre (misma caja, recortada desde arriba).
 */
function cutInArt(c: Character, call: CallKind, alt?: AltForm): string {
  const id = alt?.id ?? c.id
  if (HAS_CUT_IN.has(id)) return cutInUrl(id, EXPRESSION[call])
  return alt?.portrait ?? portraitUrl(c)
}

export interface CutIn {
  /** Muestra la viñeta en la esquina de `seat`. Reemplaza a la que hubiera. */
  show(seat: Seat, c: Character, call: CallKind, alt?: AltForm): void
  /** Retira la viñeta pero mantiene el atrapador: el beat sigue (destape). */
  dismissPanel(): void
  /** Retira todo. */
  hide(): void
  /** Repinta los textos visibles (cambio de idioma en caliente). */
  refresh(): void
  destroy(): void
}

export function createCutIn(stage: HTMLElement, human: Seat, onSkip: () => void): CutIn {
  // Atrapador a pantalla completa: permite saltarse el beat con un clic y, de
  // paso, evita que ese mismo clic descarte una ficha sin querer.
  const catcher = document.createElement('div')
  catcher.className = 'tm-cutin-ov'

  const panel = document.createElement('div')
  panel.className = 'tm-cutin'
  panel.setAttribute('role', 'img')
  panel.innerHTML =
    `<svg class="tm-cutin__frame" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true">` +
    '<defs>' +
    '<clipPath id="tm-cutin-clip"><path/></clipPath>' +
    '<linearGradient id="tm-cutin-scrim" x1="0" y1="0" x2="0" y2="1">' +
    '<stop offset="0.42" stop-color="#0a0704" stop-opacity="0"/>' +
    '<stop offset="1" stop-color="#0a0704" stop-opacity="0.9"/>' +
    '</linearGradient>' +
    '</defs>' +
    '<g clip-path="url(#tm-cutin-clip)">' +
    `<image class="tm-cutin__img" x="0" y="0" width="${W}" height="${H}" preserveAspectRatio="xMidYMin slice"/>` +
    `<rect x="0" y="0" width="${W}" height="${H}" fill="url(#tm-cutin-scrim)"/>` +
    '</g>' +
    '<path class="tm-cutin__edge" fill="none"/>' +
    '</svg>' +
    '<div class="tm-cutin__label"></div>'

  const clipPath = panel.querySelector('#tm-cutin-clip path')!
  const edge = panel.querySelector('.tm-cutin__edge')!
  const img = panel.querySelector(`.tm-cutin__img`)!
  const label = panel.querySelector<HTMLElement>('.tm-cutin__label')!

  catcher.appendChild(panel)
  stage.appendChild(catcher)

  // Estado de la viñeta visible, para poder re-traducir sin re-mostrar.
  let current: { c: Character; call: CallKind; alt?: AltForm } | null = null

  const onPointer = (): void => onSkip()
  catcher.addEventListener('pointerdown', onPointer)

  const paint = (): void => {
    if (!current) return
    const { c, call, alt } = current
    label.textContent = t(`cutin.${call}`)
    panel.setAttribute('aria-label', `${charName(c, alt)} · ${label.textContent}`)
  }

  return {
    show(seat, c, call, alt) {
      // El mapeo asiento → esquina sale de seat.ts, único punto de verdad
      // (trampa nº 1): aquí no se razona sobre orientación.
      const corner = cornerOf(relSeat(seat, human))
      const flip = FLIP[corner]!
      const d = roundedPath(shapeFor(flip), RADIUS)
      clipPath.setAttribute('d', d)
      edge.setAttribute('d', d)
      img.setAttribute('href', cutInArt(c, call, alt))

      // Las viñetas de expresión se dibujan TODAS mirando a la izquierda. En las
      // esquinas de la izquierda (bl = tú, tl = tu kami) eso deja al personaje
      // mirando fuera de la mesa, así que ahí se espeja. Va sobre la <image> y no
      // sobre el <g>, para no espejar de paso el recorte ni el velo.
      // El retrato 9:16 de reserva NO se toca: su encuadre no se dibujó con esta
      // regla, así que espejarlo sería inventarse una orientación.
      if (HAS_CUT_IN.has(alt?.id ?? c.id) && !flip.x) {
        img.setAttribute('transform', `translate(${W},0) scale(-1,1)`)
      } else {
        img.removeAttribute('transform')
      }

      // Reposicionar el MISMO nodo entre esquinas: hay que limpiar los cuatro
      // anclajes o el `left` de la viñeta anterior sobrevive junto al `right`
      // nuevo y la deja estirada.
      panel.style.left = ''
      panel.style.right = ''
      panel.style.top = ''
      panel.style.bottom = ''
      place(panel, { ...CUTIN_POS[corner], width: W, height: H })
      // Entra desde su propio lado de la pantalla.
      panel.style.setProperty('--cutin-dx', `${flip.x ? ENTER_DX : -ENTER_DX}px`)
      // El rótulo va abajo, en la esquina inferior que la diagonal NO se come.
      panel.classList.toggle('is-label-right', flip.x === flip.y)

      current = alt ? { c, call, alt } : { c, call }
      paint()
      // is-on = atrapa clics; is-lit = velo oscuro tras la viñeta. Se separan
      // porque el destape de ron/tsumo sigue atrapando clics pero NO debe
      // oscurecer la mesa: ahí es donde hay que leer las manos.
      catcher.classList.add('is-on', 'is-lit')
      // reinicia la animación de entrada en un nodo reutilizado
      panel.classList.remove('is-in')
      void panel.offsetWidth
      panel.classList.add('is-in')
    },
    dismissPanel() {
      panel.classList.remove('is-in')
      catcher.classList.remove('is-lit')
    },
    hide() {
      panel.classList.remove('is-in')
      catcher.classList.remove('is-on', 'is-lit')
      current = null
    },
    refresh: paint,
    destroy() {
      catcher.removeEventListener('pointerdown', onPointer)
      catcher.remove()
    },
  }
}
