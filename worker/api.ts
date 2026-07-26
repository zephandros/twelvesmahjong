// Enrutado de /api/**. Todo lo que toca una sala concreta se delega al Durable
// Object correspondiente: `idFromName(code)` hace que el mismo código caiga
// siempre en el mismo objeto, sin necesidad de un registro global.
//
//   POST /api/room            → crea sala (exige Turnstile) → { code, hostTicket }
//   GET  /api/room/{code}/ws  → WebSocket de esa sala
//
// Nada más. Cualquier otra ruta bajo /api/ es 404: el Worker no debe ser una
// superficie más ancha de lo necesario.
//
// OJO — el POST NO instancia ningún Durable Object: solo firma un ticket. Es lo
// que hace que "crear salas y largarse" 10.000 veces no cueste nada (ver
// worker/ticket.ts).

import type { Env } from './index'
import { isRoomCode, newRoomCode } from '../src/net/codes'
import { mintHostTicket } from './ticket'
import { verifyTurnstile } from './turnstile'
import type { CreateRoomResponse } from '../src/net/protocol'

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      // Respuesta personal y efímera: que no la guarde nadie por el camino.
      'cache-control': 'no-store',
    },
  })
}

export async function handleApi(request: Request, env: Env, url: URL): Promise<Response> {
  const path = url.pathname

  if (path === '/api/room') {
    if (request.method !== 'POST') return json({ error: 'method_not_allowed' }, 405)
    return createRoom(request, env)
  }

  // /api/room/{code}/ws
  const parts = path.split('/').filter(Boolean) // ['api','room',code,'ws']
  if (parts.length === 4 && parts[1] === 'room' && parts[3] === 'ws') {
    const code = parts[2]!.toUpperCase()
    if (!isRoomCode(code)) return json({ error: 'bad_code' }, 400)
    // Sin upgrade no hay nada que hacer aquí; se corta antes de despertar el DO.
    if (request.headers.get('upgrade')?.toLowerCase() !== 'websocket') {
      return json({ error: 'expected_websocket' }, 426)
    }
    // El código va también en la query porque el DO no puede deducirlo de su id.
    const inner = new URL(request.url)
    inner.searchParams.set('code', code)
    const stub = env.ROOMS.get(env.ROOMS.idFromName(code))
    return stub.fetch(new Request(inner, request))
  }

  return json({ error: 'not_found' }, 404)
}

async function createRoom(request: Request, env: Env): Promise<Response> {
  if (!env.TURNSTILE_SECRET) {
    // Sin secreto configurado el multijugador queda cerrado a propósito: es
    // también el interruptor de emergencia (ver docs/cloudflare-setup.md).
    return json({ error: 'multiplayer_disabled' }, 503)
  }

  let token: unknown
  try {
    token = ((await request.json()) as { turnstileToken?: unknown }).turnstileToken
  } catch {
    return json({ error: 'bad_request' }, 400)
  }
  if (typeof token !== 'string' || token.length === 0) {
    return json({ error: 'turnstile_required' }, 403)
  }

  const ip = request.headers.get('CF-Connecting-IP')
  if (!(await verifyTurnstile(env.TURNSTILE_SECRET, token, ip))) {
    return json({ error: 'turnstile_failed' }, 403)
  }

  const code = newRoomCode()
  const hostTicket = await mintHostTicket(env.TURNSTILE_SECRET, code)
  return json({ code, hostTicket } satisfies CreateRoomResponse)
}
