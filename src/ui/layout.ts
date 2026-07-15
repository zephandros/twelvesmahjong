// Escenario de diseño fijo 1920×1080 (16:9), escalado al viewport con
// letterboxing. Coordenadas copiadas del mockup Figma (raw/code/index.tsx):
// mesa centrada con 4 paneles 240×540 en las
// esquinas. Todas las coordenadas de la UI viven en este espacio.

export const STAGE_W = 1920
export const STAGE_H = 1080

/** Superficie de juego de fieltro, dentro del riel. */
export const BOARD = { x: 264, y: 30, w: 1392, h: 1020 } as const
/** Riel exterior de madera, centrado entre los paneles de personaje. */
export const RAIL = { x: 240, y: 6, w: 1440, h: 1068 } as const

/**
 * Frame + escenario vacío 1920×1080, escalado y centrado con letterbox.
 * Útil para menú / select (sin mesa). Devuelve el nodo `.tm-stage`.
 */
export function createScaledStage(root: HTMLElement): HTMLElement {
  root.classList.add('tm-root')

  const frame = document.createElement('div')
  frame.className = 'tm-stage-frame'

  const stage = document.createElement('div')
  stage.className = 'tm-stage'
  stage.style.width = `${STAGE_W}px`
  stage.style.height = `${STAGE_H}px`

  frame.appendChild(stage)
  root.appendChild(frame)

  // Escalado + letterbox determinista: origen arriba-izquierda y offset centrado
  // (evita el descuadre de centrar un elemento sobredimensionado en un grid).
  stage.style.position = 'absolute'
  stage.style.left = '0'
  stage.style.top = '0'
  stage.style.transformOrigin = 'top left'
  const apply = () => {
    const scale = Math.min(frame.clientWidth / STAGE_W, frame.clientHeight / STAGE_H)
    const ox = (frame.clientWidth - STAGE_W * scale) / 2
    const oy = (frame.clientHeight - STAGE_H * scale) / 2
    stage.style.transform = `translate(${ox}px, ${oy}px) scale(${scale})`
  }
  apply()
  new ResizeObserver(apply).observe(frame)

  return stage
}

/**
 * Escenario de partida: `createScaledStage` + riel/fieltro decorativos.
 * Devuelve el elemento sobre el que posicionar hijos en coordenadas de 1920×1080.
 */
export function createStage(root: HTMLElement): HTMLElement {
  const stage = createScaledStage(root)

  // Riel y fieltro decorativos, detrás de las fichas y el HUD.
  const board = document.createElement('div')
  board.className = 'tm-board'
  board.style.cssText =
    `position:absolute;left:${RAIL.x}px;top:${RAIL.y}px;width:${RAIL.w}px;height:${RAIL.h}px`
  const felt = document.createElement('div')
  felt.className = 'tm-felt'
  board.appendChild(felt)
  stage.appendChild(board)

  return stage
}

/** Posiciona un elemento en coordenadas del escenario (esquina sup-izq). */
export function place(
  el: HTMLElement,
  opts: {
    left?: number
    right?: number
    top?: number
    bottom?: number
    width?: number
    height?: number
    /** transform extra tras el posicionamiento (p. ej. rotación de descartes). */
    transform?: string
    /** centrar horizontalmente respecto a `left`/`right`. */
    centerX?: boolean
    /** centrar verticalmente respecto a `top`/`bottom`. */
    centerY?: boolean
    z?: number
  },
): HTMLElement {
  el.style.position = 'absolute'
  if (opts.left !== undefined) el.style.left = `${opts.left}px`
  if (opts.right !== undefined) el.style.right = `${opts.right}px`
  if (opts.top !== undefined) el.style.top = `${opts.top}px`
  if (opts.bottom !== undefined) el.style.bottom = `${opts.bottom}px`
  if (opts.width !== undefined) el.style.width = `${opts.width}px`
  if (opts.height !== undefined) el.style.height = `${opts.height}px`
  if (opts.z !== undefined) el.style.zIndex = String(opts.z)

  const tf: string[] = []
  if (opts.centerX) tf.push('translateX(-50%)')
  if (opts.centerY) tf.push('translateY(-50%)')
  if (opts.transform) tf.push(opts.transform)
  if (tf.length) el.style.transform = tf.join(' ')

  return el
}
