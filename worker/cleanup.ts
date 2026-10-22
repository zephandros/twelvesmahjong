// Limpieza de salas abandonadas en la Realtime Database (Cron Trigger).
//
// Una sala la borra su anfitrión al salir con el botón (`closeAll` en
// src/net/client.ts); si cierra la pestaña sin más, `rooms/{code}` se queda
// para siempre. Las reglas dejan que cualquier cuenta borre salas de más de
// 24 h, pero ningún cliente puede LISTAR `rooms` (`.read` es por sala), así que
// nadie lo hacía. Este módulo lo hace desde el Worker, con la cuenta de
// servicio (que no pasa por las reglas), una vez al día (wrangler.jsonc →
// `triggers.crons`).
//
// Caduca una sala si:
//   - `meta/createdAt` tiene más de ROOM_TTL_MS (24 h), o
//   - está en `meta/phase = 'done'` y `meta/endedAt` tiene más de DONE_TTL_MS
//     (1 h; el árbitro lo escribe al acabar la partida, src/net/host.ts), o
//   - no tiene `meta` con `createdAt` numérico (basura: una sala se crea con su
//     `meta` en una sola escritura, así que sin él no hay sala).
//
// Red: un access token OAuth2 de Google (JWT RS256 firmado con la misma clave
// que los custom tokens, canjeado en oauth2.googleapis.com), un GET superficial
// de `rooms` para los códigos, un GET de `meta` por sala y UN PATCH multi-ruta
// que borra todas las caducadas de golpe. La lógica de qué caduca
// (`expiredRooms`) es pura y se testea sin red (tests/cleanup.test.ts).

import { parseServiceAccount, signJwt, type ServiceAccount } from './jwt'

export const ROOM_TTL_MS = 24 * 60 * 60 * 1000
export const DONE_TTL_MS = 60 * 60 * 1000

/**
 * Tope de salas inspeccionadas por pasada: cada `meta` es una subpetición y el
 * plan gratuito de Workers da 50 por invocación. Lo que sobre cae en la
 * siguiente pasada (las más viejas primero, porque los códigos se recorren en
 * el orden que devuelve RTDB y el tope solo se alcanza si algo va muy mal).
 */
export const MAX_ROOMS_PER_RUN = 40

export interface Env {
  FIREBASE_PROJECT_ID: string
  /** URL de la RTDB (la misma de VITE_FIREBASE_DATABASE_URL). Sin ella se deriva del id del proyecto. */
  FIREBASE_DATABASE_URL?: string
  FIREBASE_SERVICE_ACCOUNT?: string
}

export interface Deps {
  fetch: typeof fetch
  now: () => number
}

/** Lo que de `meta` mira la limpieza; `unknown` porque viene de la red. */
export interface MetaLike {
  phase?: unknown
  createdAt?: unknown
  endedAt?: unknown
}

export interface RoomSnapshot {
  code: string
  meta: MetaLike | null
}

/** Qué salas caducan dado su `meta` y la hora actual (ms). Pura. */
export function isExpired(meta: MetaLike | null, now: number): boolean {
  if (!meta || typeof meta.createdAt !== 'number') return true
  if (meta.createdAt < now - ROOM_TTL_MS) return true
  return meta.phase === 'done' && typeof meta.endedAt === 'number' && meta.endedAt < now - DONE_TTL_MS
}

export function expiredRooms(rooms: readonly RoomSnapshot[], now: number): string[] {
  return rooms.filter((r) => isExpired(r.meta, now)).map((r) => r.code)
}

/** Cuerpo del PATCH multi-ruta sobre `rooms.json`: `null` borra cada hijo. */
export function deletionPatch(codes: readonly string[]): Record<string, null> {
  const patch: Record<string, null> = {}
  for (const code of codes) patch[code] = null
  return patch
}

/** URL de la base sin barra final. Por defecto, la instancia por omisión del proyecto (us-central1). */
export function databaseUrl(env: Env): string {
  const url = env.FIREBASE_DATABASE_URL?.trim() || `https://${env.FIREBASE_PROJECT_ID}-default-rtdb.firebaseio.com`
  return url.replace(/\/+$/, '')
}

// --- OAuth2 con la cuenta de servicio --------------------------------------------------

export const TOKEN_URL = 'https://oauth2.googleapis.com/token'
export const SCOPES = 'https://www.googleapis.com/auth/firebase.database https://www.googleapis.com/auth/userinfo.email'

let tokenCache: { token: string; expiresAt: number } | null = null

export function resetTokenCache(): void {
  tokenCache = null
}

/** Access token de Google para la REST API de la RTDB (flujo JWT bearer de cuentas de servicio). */
export async function accessToken(sa: ServiceAccount, deps: Deps): Promise<string> {
  const now = deps.now()
  if (tokenCache && tokenCache.expiresAt > now + 60_000) return tokenCache.token
  const nowS = Math.floor(now / 1000)
  const assertion = await signJwt({ iss: sa.client_email, scope: SCOPES, aud: TOKEN_URL, iat: nowS, exp: nowS + 3600 }, sa.private_key)
  const res = await deps.fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion }).toString(),
  })
  if (!res.ok) throw new Error(`oauth2 token ${res.status}: ${await res.text()}`)
  const data = (await res.json()) as { access_token?: string; expires_in?: number }
  if (!data.access_token) throw new Error('oauth2 token sin access_token')
  tokenCache = { token: data.access_token, expiresAt: now + (data.expires_in ?? 3600) * 1000 }
  return tokenCache.token
}

// --- la pasada ------------------------------------------------------------------------

export interface CleanupResult {
  /** Códigos listados en `rooms` (todos, aunque no se hayan inspeccionado). */
  listed: number
  /** Salas cuyo `meta` se leyó en esta pasada. */
  scanned: number
  deleted: string[]
}

async function readJson<T>(deps: Deps, url: string, token: string): Promise<T> {
  const res = await deps.fetch(url, { headers: { authorization: `Bearer ${token}` } })
  if (!res.ok) throw new Error(`GET ${url} → ${res.status}: ${await res.text()}`)
  return (await res.json()) as T
}

/** Una pasada de limpieza. Lanza si la red falla: el cron lo registra y lo reintenta al día siguiente. */
export async function cleanupRooms(env: Env, deps: Deps = { fetch: (i, init) => fetch(i, init), now: () => Date.now() }): Promise<CleanupResult> {
  const sa = parseServiceAccount(env.FIREBASE_SERVICE_ACCOUNT)
  const token = await accessToken(sa, deps)
  const base = databaseUrl(env)

  // `shallow=true` devuelve `{ CODE: true, … }` (o `null` sin salas), sin bajar los logs.
  const shallow = await readJson<Record<string, unknown> | null>(deps, `${base}/rooms.json?shallow=true`, token)
  const codes = shallow ? Object.keys(shallow) : []
  const batch = codes.slice(0, MAX_ROOMS_PER_RUN)

  const rooms: RoomSnapshot[] = []
  for (const code of batch) {
    const meta = await readJson<MetaLike | null>(deps, `${base}/rooms/${encodeURIComponent(code)}/meta.json`, token)
    rooms.push({ code, meta })
  }

  const deleted = expiredRooms(rooms, deps.now())
  if (deleted.length > 0) {
    const res = await deps.fetch(`${base}/rooms.json?print=silent`, {
      method: 'PATCH',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify(deletionPatch(deleted)),
    })
    if (!res.ok) throw new Error(`PATCH rooms → ${res.status}: ${await res.text()}`)
  }
  return { listed: codes.length, scanned: rooms.length, deleted }
}
