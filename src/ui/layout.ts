// Escenario de diseño fijo 1280×720, escalado al viewport con letterboxing.
// Todas las coordenadas de la UI se expresan en este espacio y se copian del
// mockup literalmente. Ver ../Mahjong/extra_code/Saki Mahjong.dc.html.

export const STAGE_W = 1280
export const STAGE_H = 720

/**
 * Crea el nodo escenario dentro de `root` y lo mantiene escalado y centrado.
 * Devuelve el elemento sobre el que posicionar hijos en coordenadas de 1280×720.
 */
export function createStage(root: HTMLElement): HTMLElement {
  root.classList.add('tm-root')

  const frame = document.createElement('div')
  frame.className = 'tm-stage-frame'

  const stage = document.createElement('div')
  stage.className = 'tm-stage'
  stage.style.width = `${STAGE_W}px`
  stage.style.height = `${STAGE_H}px`

  frame.appendChild(stage)
  root.appendChild(frame)

  const apply = () => {
    const scale = Math.min(frame.clientWidth / STAGE_W, frame.clientHeight / STAGE_H)
    stage.style.transform = `scale(${scale})`
  }
  apply()
  new ResizeObserver(apply).observe(frame)

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
