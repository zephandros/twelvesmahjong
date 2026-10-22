// Punto de entrada del Worker. Hace tres cosas y nada más:
//
//   1. /api/sesion y /api/invitado → sesiones de Firebase (worker/sessions.ts).
//   2. lo demás → el sitio estático, delegando en el binding ASSETS.
//   3. Cron Trigger diario → borrar de la RTDB las salas caducadas
//      (worker/cleanup.ts; horario en `triggers.crons` de wrangler.jsonc).
//
// El caso (2) casi nunca se ejecuta: con `run_worker_first` desactivado (el
// defecto, ver wrangler.jsonc) Cloudflare sirve los assets sin invocar el
// Worker. Solo llegamos aquí cuando NINGÚN asset corresponde, y entonces
// ASSETS.fetch aplica `not_found_handling: "404-page"` → public/404.html con
// status 404 real.
//
// Aquí ya no hay partida: el árbitro del multijugador es el cliente del
// anfitrión y el estado vive en Firebase Realtime Database (src/net/).

import { cleanupRooms, type Env as CleanupEnv } from './cleanup'
import { handleApi, type Env as SessionEnv } from './sessions'

export interface Env extends SessionEnv, CleanupEnv {
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

  // Sin cuenta de servicio no hay multijugador y no hay nada que limpiar: el
  // mismo interruptor de urgencia que apaga /api/* apaga el cron.
  scheduled(controller: ScheduledController, env: Env, ctx: ExecutionContext): void {
    if (!env.FIREBASE_SERVICE_ACCOUNT) return
    ctx.waitUntil(
      cleanupRooms(env).then(
        (r) => console.log(`cleanup(${controller.cron}): ${r.listed} salas, ${r.scanned} miradas, ${r.deleted.length} borradas${r.deleted.length ? ' (' + r.deleted.join(', ') + ')' : ''}`),
        (e) => console.error(`cleanup(${controller.cron}) falló`, e),
      ),
    )
  },
} satisfies ExportedHandler<Env>
