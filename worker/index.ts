// Punto de entrada del Worker. Hace dos cosas y nada más:
//
//   1. /api/sesion y /api/invitado → sesiones de Firebase (worker/sessions.ts).
//   2. lo demás → el sitio estático, delegando en el binding ASSETS.
//
// El caso (2) casi nunca se ejecuta: con `run_worker_first` desactivado (el
// defecto, ver wrangler.jsonc) Cloudflare sirve los assets sin invocar el
// Worker. Solo llegamos aquí cuando NINGÚN asset corresponde, y entonces
// ASSETS.fetch aplica `not_found_handling: "404-page"` → public/404.html con
// status 404 real.
//
// Aquí ya no hay partida: el árbitro del multijugador es el cliente del
// anfitrión y el estado vive en Firebase Realtime Database (src/net/).

import { handleApi, type Env as SessionEnv } from './sessions'

export interface Env extends SessionEnv {
  ASSETS: Fetcher
}

export default {
  fetch(request: Request, env: Env): Response | Promise<Response> {
    const url = new URL(request.url)
    if (url.pathname === '/api' || url.pathname.startsWith('/api/')) {
      return handleApi(request, env)
    }
    return env.ASSETS.fetch(request)
  },
} satisfies ExportedHandler<Env>
