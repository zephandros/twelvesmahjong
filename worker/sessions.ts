// Sesiones de Firebase para el multijugador. Solo este Worker las emite (en
// Firebase están desactivados los proveedores Correo/Contraseña y Anónimo),
// como custom tokens con estos claims:
//
//   name   nombre visible
//   kvExp  hasta cuándo (ms) aceptan las reglas la sesión
//   guest  invitado (true) limitado a la sala `room`
//
// - Anfitrión: token de PocketBase de Kovalt → `auth-refresh` en Kovalt API,
//   que aplica la lista blanca. El uid de Firebase es el id de PocketBase.
// - Invitado: código de sala + nombre. No se comprueba que la sala exista:
//   el token solo sirve para ESA sala (claim `room`), y si no existe, las
//   reglas no le dejan leer nada y el cliente lo cuenta como "no hay sala".
//   Renueva con su ID token mientras conserve el uid (y con él, su asiento).
//
// Adaptado del Worker de Kovalt Roller (web/worker/sessions.ts). Los tipos de
// Cloudflare se declaran ESTRUCTURALMENTE para que los tests carguen este
// módulo con el tsconfig raíz, que no tiene `@cloudflare/workers-types`.

import { verifyIdToken } from './google'
import { createCustomToken, parseServiceAccount, type ServiceAccount } from './jwt'
import { isRoomCode } from '../src/net/codes'
import { MAX_NAME } from '../src/net/protocol'

export interface Env {
  ASSETS?: { fetch(request: Request): Promise<Response> }
  PB_URL: string
  FIREBASE_PROJECT_ID: string
  /** JSON de la cuenta de servicio (`wrangler secret put FIREBASE_SERVICE_ACCOUNT`). */
  FIREBASE_SERVICE_ACCOUNT?: string
  /** Límite de invitados por IP (binding `ratelimits` de wrangler.jsonc). */
  GUEST_LIMIT?: { limit(opts: { key: string }): Promise<{ success: boolean }> }
}

export interface Deps {
  fetch: typeof fetch
  now: () => number
  randomId: () => string
}

export const SESSION_TTL_MS = 24 * 60 * 60 * 1000

export function defaultDeps(): Deps {
  return {
    fetch: (input, init) => fetch(input, init),
    now: () => Date.now(),
    randomId: () => {
      const bytes = new Uint8Array(15)
      crypto.getRandomValues(bytes)
      return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('')
    },
  }
}

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  })
}

const fail = (status: number, error: string): Response => json({ error }, status)

export function cleanName(name: unknown): string | null {
  if (typeof name !== 'string') return null
  const n = name.trim().replace(/\s+/g, ' ')
  return n.length >= 1 && [...n].length <= MAX_NAME ? n : null
}

async function readJson(request: Request): Promise<Record<string, unknown> | null> {
  try {
    const body = (await request.json()) as unknown
    return body && typeof body === 'object' ? (body as Record<string, unknown>) : null
  } catch {
    return null
  }
}

function serviceAccount(env: Env): ServiceAccount {
  const sa = parseServiceAccount(env.FIREBASE_SERVICE_ACCOUNT)
  return { ...sa, project_id: env.FIREBASE_PROJECT_ID || sa.project_id }
}

interface PbRecord {
  id?: string
  email?: string
  name?: string
}

/** POST /api/sesion {token}: token de PocketBase de Kovalt → custom token de Firebase. */
export async function accountSession(request: Request, env: Env, deps: Deps): Promise<Response> {
  const body = await readJson(request)
  const pbToken = body?.['token']
  if (typeof pbToken !== 'string' || !pbToken) return fail(400, 'missing_token')

  const res = await deps.fetch(`${env.PB_URL.replace(/\/+$/, '')}/api/collections/auth_users/auth-refresh`, {
    method: 'POST',
    headers: { Authorization: pbToken },
  })
  // 400/401/403/404 = sesión inválida o correo fuera de la lista blanca.
  if (res.status === 400 || res.status === 401 || res.status === 403 || res.status === 404) {
    return fail(403, 'not_allowed')
  }
  if (!res.ok) return fail(502, 'kovalt_unavailable')

  const auth = (await res.json()) as { token?: string; record?: PbRecord }
  const record = auth.record ?? {}
  if (!record.id) return fail(502, 'kovalt_unexpected')
  const name = cleanName(record.name) ?? cleanName(record.email?.split('@')[0]) ?? 'Jugador'
  const claims = { name, kvExp: deps.now() + SESSION_TTL_MS }
  const firebaseToken = await createCustomToken(serviceAccount(env), record.id, claims, Math.floor(deps.now() / 1000))
  return json({ firebaseToken, pbToken: auth.token, pbRecord: record })
}

/** POST /api/invitado {codigo, nombre} o {idToken}: sesión de invitado limitada a una sala. */
export async function guestSession(request: Request, env: Env, deps: Deps): Promise<Response> {
  if (env.GUEST_LIMIT) {
    const ip = request.headers.get('CF-Connecting-IP') ?? 'desconocida'
    const { success } = await env.GUEST_LIMIT.limit({ key: ip })
    if (!success) return fail(429, 'too_many')
  }

  const body = await readJson(request)
  if (!body) return fail(400, 'bad_request')
  const sa = serviceAccount(env)
  const nowS = Math.floor(deps.now() / 1000)

  // Renovación: el invitado conserva su uid (y su asiento) en la misma sala.
  if (typeof body['idToken'] === 'string' && body['idToken']) {
    const claims = await verifyIdToken(body['idToken'], sa.project_id, deps.fetch, nowS)
    const uid = typeof claims?.['sub'] === 'string' ? claims['sub'] : null
    const room = typeof claims?.['room'] === 'string' ? claims['room'] : null
    if (!claims || claims['guest'] !== true || !uid || !room) return fail(401, 'bad_session')
    const name = cleanName(claims['name']) ?? 'Invitado'
    const firebaseToken = await createCustomToken(sa, uid, { name, guest: true, room, kvExp: deps.now() + SESSION_TTL_MS }, nowS)
    return json({ firebaseToken, room })
  }

  const code = typeof body['codigo'] === 'string' ? body['codigo'].trim().toUpperCase() : ''
  if (!isRoomCode(code)) return fail(404, 'no_room')
  const name = cleanName(body['nombre'])
  if (!name) return fail(400, 'bad_name')

  const uid = `g_${deps.randomId()}`
  const firebaseToken = await createCustomToken(sa, uid, { name, guest: true, room: code, kvExp: deps.now() + SESSION_TTL_MS }, nowS)
  return json({ firebaseToken, room: code })
}

export async function handleApi(request: Request, env: Env, deps: Deps = defaultDeps()): Promise<Response> {
  const { pathname } = new URL(request.url)
  if (request.method !== 'POST') return fail(405, 'method_not_allowed')
  // Sin cuenta de servicio el multijugador está apagado a propósito: es
  // también el interruptor de urgencia (ver docs/multiplayer-setup.md).
  if (!env.FIREBASE_SERVICE_ACCOUNT) return fail(503, 'multiplayer_disabled')
  try {
    if (pathname === '/api/sesion') return await accountSession(request, env, deps)
    if (pathname === '/api/invitado') return await guestSession(request, env, deps)
    return fail(404, 'not_found')
  } catch (e) {
    console.error(e)
    return fail(500, 'session_failed')
  }
}
