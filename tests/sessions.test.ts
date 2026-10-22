// El Worker de sesiones (worker/sessions.ts): es la ÚNICA puerta al
// multijugador. Se ata que:
//  - sin cuenta de servicio el multijugador está apagado (503);
//  - la cuenta pasa por `auth-refresh` de Kovalt API (la lista blanca) y el
//    uid del custom token es el id de PocketBase;
//  - un invitado recibe un token limitado a SU sala (claim `room`), y un
//    código mal formado no recibe nada.

import { describe, it, expect, beforeAll } from 'vitest'
import { CUSTOM_TOKEN_AUDIENCE, decodeJwt, verifyRs256 } from '../worker/jwt'
import { handleApi, SESSION_TTL_MS, type Deps, type Env } from '../worker/sessions'

const PROJECT = 'twelves-mahjong-test'
const NOW = 1_800_000_000_000

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

function setup(opts: { pbStatus?: number; limited?: boolean; noServiceAccount?: boolean } = {}) {
  const calls: string[] = []
  const fetchFn = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    calls.push(url)
    if (url.endsWith('/api/collections/auth_users/auth-refresh')) {
      expect((init?.headers as Record<string, string> | undefined)?.['Authorization']).toBe('pb-token')
      const status = opts.pbStatus ?? 200
      if (status !== 200) return new Response('{"message":"Cuenta no permitida."}', { status })
      return Response.json({ token: 'pb-token-2', record: { id: 'abc123def456ghi', email: 'ana@example.com', name: 'Ana' } })
    }
    throw new Error(`fetch inesperado: ${url}`)
  }) as typeof fetch

  const env: Env = {
    PB_URL: 'https://api.kovalt.mx',
    FIREBASE_PROJECT_ID: PROJECT,
    GUEST_LIMIT: { limit: async () => ({ success: !opts.limited }) },
  }
  if (!opts.noServiceAccount) {
    env.FIREBASE_SERVICE_ACCOUNT = JSON.stringify({
      project_id: PROJECT, client_email: 'sa@test.iam.gserviceaccount.com', private_key: pem,
    })
  }
  const deps: Deps = { fetch: fetchFn, now: () => NOW, randomId: () => 'r4nd0m' }
  const post = (path: string, body: unknown) =>
    handleApi(new Request(`https://twelvesmahjong.com${path}`, {
      method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json' },
    }), env, deps)
  return { post, calls }
}

async function customTokenOf(res: Response) {
  expect(res.status).toBe(200)
  const body = (await res.json()) as { firebaseToken: string; room?: string; pbToken?: string }
  const jwt = decodeJwt(body.firebaseToken)
  expect(await verifyRs256(jwt, publicKey)).toBe(true)
  expect(jwt.payload['aud']).toBe(CUSTOM_TOKEN_AUDIENCE)
  return { body, payload: jwt.payload as { uid: string; claims: Record<string, unknown> } }
}

describe('/api/sesion (anfitrión)', () => {
  it('canjea la sesión de Kovalt por un custom token con el id de PocketBase', async () => {
    const { post, calls } = setup()
    const { body, payload } = await customTokenOf(await post('/api/sesion', { token: 'pb-token' }))
    expect(calls.some((u) => u.endsWith('/auth-refresh'))).toBe(true)
    expect(payload.uid).toBe('abc123def456ghi')
    expect(payload.claims['name']).toBe('Ana')
    expect(payload.claims['guest']).toBeUndefined()
    expect(payload.claims['kvExp']).toBe(NOW + SESSION_TTL_MS)
    expect(body.pbToken).toBe('pb-token-2')
  })

  it('la lista blanca manda: un 400/401/403 de Kovalt es "sin acceso"', async () => {
    for (const status of [400, 401, 403]) {
      const { post } = setup({ pbStatus: status })
      const res = await post('/api/sesion', { token: 'pb-token' })
      expect(res.status).toBe(403)
    }
  })

  it('sin token no hay sesión', async () => {
    const { post } = setup()
    expect((await post('/api/sesion', {})).status).toBe(400)
  })
})

describe('/api/invitado', () => {
  it('emite un token limitado a la sala del código', async () => {
    const { post } = setup()
    const { body, payload } = await customTokenOf(
      await post('/api/invitado', { codigo: 'abcdef', nombre: '  Luis  ' }),
    )
    expect(payload.uid).toBe('g_r4nd0m')
    expect(payload.claims['guest']).toBe(true)
    expect(payload.claims['room']).toBe('ABCDEF')
    expect(payload.claims['name']).toBe('Luis')
    expect(body.room).toBe('ABCDEF')
  })

  it('un código que no es un código no recibe token', async () => {
    const { post } = setup()
    expect((await post('/api/invitado', { codigo: 'ABC', nombre: 'Luis' })).status).toBe(404)
    expect((await post('/api/invitado', { codigo: 'ABCDE0', nombre: 'Luis' })).status).toBe(404)
  })

  it('sin nombre (o demasiado largo) no entra', async () => {
    const { post } = setup()
    expect((await post('/api/invitado', { codigo: 'ABCDEF', nombre: '   ' })).status).toBe(400)
    expect((await post('/api/invitado', { codigo: 'ABCDEF', nombre: 'x'.repeat(40) })).status).toBe(400)
  })

  it('el límite por IP frena la fuerza bruta', async () => {
    const { post } = setup({ limited: true })
    expect((await post('/api/invitado', { codigo: 'ABCDEF', nombre: 'Luis' })).status).toBe(429)
  })
})

describe('interruptor', () => {
  it('sin cuenta de servicio el multijugador está apagado', async () => {
    const { post } = setup({ noServiceAccount: true })
    expect((await post('/api/sesion', { token: 'pb-token' })).status).toBe(503)
    expect((await post('/api/invitado', { codigo: 'ABCDEF', nombre: 'Luis' })).status).toBe(503)
  })

  it('solo POST, y solo esas dos rutas', async () => {
    const { post } = setup()
    expect((await post('/api/otra', {})).status).toBe(404)
    const env: Env = { PB_URL: '', FIREBASE_PROJECT_ID: '', FIREBASE_SERVICE_ACCOUNT: '{}' }
    const res = await handleApi(new Request('https://twelvesmahjong.com/api/sesion'), env)
    expect(res.status).toBe(405)
  })
})
