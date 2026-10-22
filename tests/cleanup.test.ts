// La limpieza de salas del Worker (worker/cleanup.ts, Cron Trigger diario). Se ata:
//  - qué salas caducan dado su `meta` y un `now` (lógica pura, sin red);
//  - que una pasada entera, con la red STUBBEADA, pide el access token con un
//    JWT firmado por la cuenta de servicio y los scopes de la RTDB, lista
//    `rooms` en superficial, lee el `meta` de cada sala y borra las caducadas
//    en UN solo PATCH multi-ruta (y no manda ningún PATCH si no hay nada que borrar);
//  - que el árbitro deja `meta/endedAt` al terminar la partida, que es lo que
//    permite borrar una sala terminada sin esperar las 24 h.

import { describe, it, expect, beforeAll, beforeEach } from 'vitest'
import { decodeJwt, verifyRs256 } from '../worker/jwt'
import {
  cleanupRooms, databaseUrl, deletionPatch, expiredRooms, isExpired, resetTokenCache,
  DONE_TTL_MS, MAX_ROOMS_PER_RUN, ROOM_TTL_MS, SCOPES, TOKEN_URL, type Deps, type Env, type MetaLike,
} from '../worker/cleanup'

const PROJECT = 'twelves-mahjong-test'
const NOW = 1_800_000_000_000
const H = 60 * 60 * 1000

let pem: string
let publicKey: CryptoKey

beforeAll(async () => {
  const pair = (await crypto.subtle.generateKey(
    { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
    true,
    ['sign', 'verify'],
  )) as CryptoKeyPair
  const pkcs8 = new Uint8Array((await crypto.subtle.exportKey('pkcs8', pair.privateKey)) as ArrayBuffer)
  const b64 = btoa(String.fromCharCode(...pkcs8))
  pem = `-----BEGIN PRIVATE KEY-----\n${b64.match(/.{1,64}/g)!.join('\n')}\n-----END PRIVATE KEY-----\n`
  publicKey = pair.publicKey
})

beforeEach(() => resetTokenCache())

describe('qué salas caducan (puro)', () => {
  const fresh: MetaLike = { host: 'u1', phase: 'lobby', createdAt: NOW - H } as MetaLike

  it('una sala viva de menos de 24 h se queda', () => {
    expect(isExpired(fresh, NOW)).toBe(false)
    expect(isExpired({ phase: 'playing', createdAt: NOW - ROOM_TTL_MS + 1 }, NOW)).toBe(false)
  })

  it('una sala de más de 24 h caduca, esté en la fase que esté', () => {
    for (const phase of ['lobby', 'playing', 'done']) {
      expect(isExpired({ phase, createdAt: NOW - ROOM_TTL_MS - 1 }, NOW)).toBe(true)
    }
    expect(isExpired({ phase: 'lobby', createdAt: NOW - ROOM_TTL_MS }, NOW)).toBe(false) // el límite exacto no caduca
  })

  it('una sala terminada caduca 1 h después de `endedAt`, no antes', () => {
    expect(isExpired({ phase: 'done', createdAt: NOW - 3 * H, endedAt: NOW - DONE_TTL_MS - 1 }, NOW)).toBe(true)
    expect(isExpired({ phase: 'done', createdAt: NOW - 3 * H, endedAt: NOW - DONE_TTL_MS + 1 }, NOW)).toBe(false)
    // sin `endedAt` (salas de antes de esta versión) espera a las 24 h de createdAt
    expect(isExpired({ phase: 'done', createdAt: NOW - 3 * H }, NOW)).toBe(false)
    // `endedAt` solo cuenta si la fase es `done`
    expect(isExpired({ phase: 'playing', createdAt: NOW - 3 * H, endedAt: NOW - 3 * H }, NOW)).toBe(false)
  })

  it('sin `meta` o sin `createdAt` numérico es basura y caduca', () => {
    expect(isExpired(null, NOW)).toBe(true)
    expect(isExpired({}, NOW)).toBe(true)
    expect(isExpired({ phase: 'lobby', createdAt: 'ayer' }, NOW)).toBe(true)
  })

  it('expiredRooms devuelve solo los códigos caducados, en orden', () => {
    const codes = expiredRooms([
      { code: 'AAAAAA', meta: fresh },
      { code: 'BBBBBB', meta: { phase: 'lobby', createdAt: NOW - 2 * ROOM_TTL_MS } },
      { code: 'CCCCCC', meta: { phase: 'done', createdAt: NOW - 2 * H, endedAt: NOW - 2 * H } },
      { code: 'DDDDDD', meta: null },
    ], NOW)
    expect(codes).toEqual(['BBBBBB', 'CCCCCC', 'DDDDDD'])
    expect(deletionPatch(codes)).toEqual({ BBBBBB: null, CCCCCC: null, DDDDDD: null })
  })

  it('la URL de la base sale de la variable o, sin ella, del id del proyecto, sin barra final', () => {
    expect(databaseUrl({ FIREBASE_PROJECT_ID: 'p' })).toBe('https://p-default-rtdb.firebaseio.com')
    expect(databaseUrl({ FIREBASE_PROJECT_ID: 'p', FIREBASE_DATABASE_URL: 'https://p.europe-west1.firebasedatabase.app/' }))
      .toBe('https://p.europe-west1.firebasedatabase.app')
    expect(databaseUrl({ FIREBASE_PROJECT_ID: 'p', FIREBASE_DATABASE_URL: '  ' })).toBe('https://p-default-rtdb.firebaseio.com')
  })
})

// --- una pasada con la red stubbeada -----------------------------------------------------

const DB = 'https://test-default-rtdb.firebaseio.com'

interface Call { method: string; url: string; headers: Record<string, string>; body: string | null }

function fakeNet(rooms: Record<string, MetaLike | null>) {
  const calls: Call[] = []
  let assertion: string | null = null
  const fetchFn = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    const method = init?.method ?? 'GET'
    const headers = Object.fromEntries(Object.entries((init?.headers as Record<string, string> | undefined) ?? {}).map(([k, v]) => [k.toLowerCase(), v]))
    calls.push({ method, url, headers, body: typeof init?.body === 'string' ? init.body : null })

    if (url === TOKEN_URL) {
      const form = new URLSearchParams(init?.body as string)
      expect(form.get('grant_type')).toBe('urn:ietf:params:oauth:grant-type:jwt-bearer')
      assertion = form.get('assertion')
      return Response.json({ access_token: 'ya29.test', expires_in: 3599, token_type: 'Bearer' })
    }
    expect(headers['authorization']).toBe('Bearer ya29.test')
    if (url === `${DB}/rooms.json?shallow=true`) {
      const codes = Object.keys(rooms)
      return Response.json(codes.length ? Object.fromEntries(codes.map((c) => [c, true])) : null)
    }
    const m = /^.*\/rooms\/([A-Z0-9]+)\/meta\.json$/.exec(url)
    if (m && method === 'GET') return Response.json(rooms[m[1]!] ?? null)
    if (url === `${DB}/rooms.json?print=silent` && method === 'PATCH') {
      for (const [code, v] of Object.entries(JSON.parse(init!.body as string) as Record<string, unknown>)) {
        expect(v).toBeNull()
        delete rooms[code]
      }
      return new Response(null, { status: 204 })
    }
    throw new Error(`fetch inesperado: ${method} ${url}`)
  }) as typeof fetch

  const env: Env = {
    FIREBASE_PROJECT_ID: PROJECT,
    FIREBASE_DATABASE_URL: `${DB}/`,
    FIREBASE_SERVICE_ACCOUNT: JSON.stringify({ project_id: PROJECT, client_email: 'sa@test.iam.gserviceaccount.com', private_key: pem }),
  }
  const deps: Deps = { fetch: fetchFn, now: () => NOW }
  return { env, deps, calls, rooms, assertion: () => assertion }
}

describe('cleanupRooms (red stubbeada)', () => {
  it('pide el token con un JWT de la cuenta de servicio, lista, lee cada meta y borra las caducadas en un PATCH', async () => {
    const net = fakeNet({
      VIVA01: { host: 'u1', phase: 'playing', createdAt: NOW - 2 * H } as MetaLike,
      VIEJA2: { host: 'u1', phase: 'lobby', createdAt: NOW - 30 * H } as MetaLike,
      HECHA3: { host: 'u2', phase: 'done', createdAt: NOW - 5 * H, endedAt: NOW - 2 * H } as MetaLike,
      RECIEN: { host: 'u2', phase: 'done', createdAt: NOW - 5 * H, endedAt: NOW - H / 2 } as MetaLike,
      ROTA05: null,
    })
    const result = await cleanupRooms(net.env, net.deps)

    expect(result).toEqual({ listed: 5, scanned: 5, deleted: ['VIEJA2', 'HECHA3', 'ROTA05'] })
    expect(Object.keys(net.rooms).sort()).toEqual(['RECIEN', 'VIVA01'])

    // el assertion OAuth: firmado por la cuenta de servicio, con los scopes de la RTDB
    const jwt = decodeJwt(net.assertion()!)
    expect(await verifyRs256(jwt, publicKey)).toBe(true)
    expect(jwt.payload['iss']).toBe('sa@test.iam.gserviceaccount.com')
    expect(jwt.payload['aud']).toBe(TOKEN_URL)
    expect(jwt.payload['scope']).toBe(SCOPES)
    expect(jwt.payload['scope']).toContain('https://www.googleapis.com/auth/firebase.database')
    expect(jwt.payload['iat']).toBe(Math.floor(NOW / 1000))
    expect(jwt.payload['exp']).toBe(Math.floor(NOW / 1000) + 3600)

    // 1 token + 1 shallow + 5 metas + 1 PATCH, y los logs nunca se bajan
    const urls = net.calls.map((c) => `${c.method} ${c.url}`)
    expect(urls).toHaveLength(8)
    expect(urls[0]).toBe(`POST ${TOKEN_URL}`)
    expect(urls[1]).toBe(`GET ${DB}/rooms.json?shallow=true`)
    expect(urls.filter((u) => u.endsWith('/meta.json'))).toHaveLength(5)
    expect(urls.filter((u) => u.startsWith('PATCH'))).toEqual([`PATCH ${DB}/rooms.json?print=silent`])
    expect(urls.some((u) => u.includes('/log'))).toBe(false)
    expect(JSON.parse(net.calls.at(-1)!.body!)).toEqual({ VIEJA2: null, HECHA3: null, ROTA05: null })
  })

  it('sin nada que borrar no manda ningún PATCH, y sin salas ni lee metas', async () => {
    const net = fakeNet({ VIVA01: { host: 'u1', phase: 'lobby', createdAt: NOW - H } as MetaLike })
    expect(await cleanupRooms(net.env, net.deps)).toEqual({ listed: 1, scanned: 1, deleted: [] })
    expect(net.calls.some((c) => c.method === 'PATCH')).toBe(false)

    resetTokenCache() // la pasada anterior dejó el token en caché
    const empty = fakeNet({})
    expect(await cleanupRooms(empty.env, empty.deps)).toEqual({ listed: 0, scanned: 0, deleted: [] })
    expect(empty.calls.map((c) => c.method)).toEqual(['POST', 'GET'])
  })

  it('reutiliza el access token entre pasadas mientras no caduque', async () => {
    const net = fakeNet({})
    await cleanupRooms(net.env, net.deps)
    await cleanupRooms(net.env, net.deps)
    expect(net.calls.filter((c) => c.url === TOKEN_URL)).toHaveLength(1)
  })

  it('no inspecciona más de MAX_ROOMS_PER_RUN salas por pasada (tope de subpeticiones)', async () => {
    const rooms: Record<string, MetaLike | null> = {}
    for (let i = 0; i < MAX_ROOMS_PER_RUN + 10; i++) rooms[`R${String(i).padStart(5, '0')}`] = null
    const net = fakeNet(rooms)
    const result = await cleanupRooms(net.env, net.deps)
    expect(result.listed).toBe(MAX_ROOMS_PER_RUN + 10)
    expect(result.scanned).toBe(MAX_ROOMS_PER_RUN)
    expect(result.deleted).toHaveLength(MAX_ROOMS_PER_RUN)
    expect(Object.keys(net.rooms)).toHaveLength(10)
  })

  it('sin cuenta de servicio lanza antes de tocar la red', async () => {
    const net = fakeNet({})
    const { FIREBASE_SERVICE_ACCOUNT: _sa, ...noSecret } = net.env
    await expect(cleanupRooms(noSecret, net.deps)).rejects.toThrow(/FIREBASE_SERVICE_ACCOUNT/)
    expect(net.calls).toHaveLength(0)
  })

  it('un fallo de la RTDB se propaga (el cron lo registra y reintenta al día siguiente)', async () => {
    const net = fakeNet({})
    const failing: Deps = {
      ...net.deps,
      fetch: (async (input: RequestInfo | URL, init?: RequestInit) =>
        String(input).includes('shallow=true') ? new Response('Permission denied', { status: 401 }) : net.deps.fetch(input, init)) as typeof fetch,
    }
    await expect(cleanupRooms(net.env, failing)).rejects.toThrow(/401/)
  })
})
