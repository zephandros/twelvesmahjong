// Turnstile: la prueba «soy humano» de Cloudflare. Es la puerta de CREAR sala
// (lo único que instancia un Durable Object); unirse por código no la pide.
//
// EL SCRIPT SE CARGA BAJO DEMANDA, y solo al abrir la pantalla de crear sala.
// Es deliberado: el juego de un jugador y el modo offline no deben tocar la red
// jamás, y este es el único trozo del proyecto que habla con un tercero. Si no
// carga (sin conexión, bloqueador), se avisa y no pasa nada más.

const SCRIPT = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit'

// La sitekey es PÚBLICA (va en el bundle); la privada vive como secreto del
// Worker. Por defecto, la clave de pruebas de Cloudflare que siempre pasa, para
// que `wrangler dev` funcione sin configurar nada.
const SITEKEY = import.meta.env['VITE_TURNSTILE_SITEKEY'] ?? '1x00000000000000000000AA'

interface TurnstileApi {
  render(el: HTMLElement, opts: {
    sitekey: string
    callback: (token: string) => void
    'error-callback': () => void
    'expired-callback': () => void
    theme?: 'light' | 'dark' | 'auto'
  }): string
  remove(id: string): void
}

declare global {
  interface Window {
    turnstile?: TurnstileApi
  }
}

let loading: Promise<TurnstileApi> | null = null

function loadScript(): Promise<TurnstileApi> {
  if (window.turnstile) return Promise.resolve(window.turnstile)
  if (loading) return loading
  loading = new Promise<TurnstileApi>((resolve, reject) => {
    const el = document.createElement('script')
    el.src = SCRIPT
    el.async = true
    el.onload = () => {
      if (window.turnstile) resolve(window.turnstile)
      else reject(new Error('turnstile no expuso su API'))
    }
    el.onerror = () => reject(new Error('no se pudo cargar turnstile'))
    document.head.appendChild(el)
  })
  // un fallo no debe dejar la promesa cacheada: el siguiente intento reintenta
  loading.catch(() => { loading = null })
  return loading
}

/**
 * Pinta el widget en `host` y resuelve con el token cuando el usuario pasa la
 * comprobación (en modo *managed* suele ser instantáneo y sin interacción).
 * Rechaza si el script no carga o si el reto falla.
 */
export async function getTurnstileToken(host: HTMLElement): Promise<string> {
  const api = await loadScript()
  return new Promise<string>((resolve, reject) => {
    let id: string | null = null
    const done = (fn: () => void): void => {
      if (id !== null) {
        try { api.remove(id) } catch { /* ya retirado */ }
        id = null
      }
      fn()
    }
    id = api.render(host, {
      sitekey: SITEKEY,
      theme: 'dark',
      callback: (token) => done(() => resolve(token)),
      'error-callback': () => done(() => reject(new Error('turnstile falló'))),
      'expired-callback': () => done(() => reject(new Error('turnstile caducó'))),
    })
  })
}
