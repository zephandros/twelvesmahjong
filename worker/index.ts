// Punto de entrada del Worker. Hace dos cosas y nada más:
//
//   1. /api/**  → la API de multijugador (crear sala, y el WebSocket de la sala,
//                 que vive en el Durable Object GameRoom).
//   2. lo demás → el sitio estático, delegando en el binding ASSETS.
//
// El caso (2) casi nunca se ejecuta: con `run_worker_first` desactivado (el
// defecto, ver wrangler.jsonc) Cloudflare sirve los assets sin invocar el
// Worker. Solo llegamos aquí cuando NINGÚN asset corresponde, y entonces
// ASSETS.fetch aplica `not_found_handling: "404-page"` → public/404.html con
// status 404 real.

import { GameRoom } from './room'
import { handleApi } from './api'

export { GameRoom }

export interface Env {
  ASSETS: Fetcher
  ROOMS: DurableObjectNamespace
  /** Clave privada del widget Turnstile (`wrangler secret put TURNSTILE_SECRET`). */
  TURNSTILE_SECRET?: string
}

export default {
  fetch(request: Request, env: Env): Response | Promise<Response> {
    const url = new URL(request.url)
    if (url.pathname === '/api' || url.pathname.startsWith('/api/')) {
      return handleApi(request, env, url)
    }
    return env.ASSETS.fetch(request)
  },
} satisfies ExportedHandler<Env>
