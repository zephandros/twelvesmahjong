// Sesiones del multijugador: la cuenta de Kovalt y la sesión de Firebase.
//
// Dos identidades, una detrás de otra:
//
//  1. CUENTA DE KOVALT (PocketBase en api.kovalt.mx). Solo la necesita quien
//     CREA la sala. Entra por código al correo (OTP) o con Google; la lista
//     blanca la aplica el servidor de Kovalt (hooks de `auth_users`), este
//     cliente ni la ve. El token vive en el `LocalAuthStore` del SDK
//     (localStorage): twelvesmahjong.com NO es un subdominio de kovalt.mx,
//     así que la cookie compartida de la suite (`kv_suite_auth`,
//     suiteAuth.ts en Roller/Notes) no llegaría aquí y no se copia.
//
//  2. SESIÓN DE FIREBASE. La emite SOLO nuestro Worker (`/api/sesion` y
//     `/api/invitado`) como custom token; sus claims (`name`, `kvExp`, `guest`,
//     `room`) son lo que leen las Security Rules:
//       - anfitrión: el token de PocketBase se canjea en `/api/sesion`, que
//         pasa por `auth-refresh` de Kovalt API (= la lista blanca);
//       - invitado: código de sala + nombre en `/api/invitado`; queda limitado
//         a esa sala por el claim `room`.
//
// Todo bajo demanda: este módulo lo importa ui/net.ts con `import()`.

import PocketBase from 'pocketbase'
import { signInWithCustomToken, signOut } from 'firebase/auth'
import { firebase } from './firebase'
import { MAX_NAME } from '../net/protocol'

const KOVALT_URL = (import.meta.env['VITE_KOVALT_API_URL'] as string | undefined) || 'https://api.kovalt.mx'

export class SessionError extends Error {
  constructor(readonly code: 'not-allowed' | 'login' | 'network' | 'disabled' | 'no-room' | 'name') {
    super(code)
  }
}

// --- cuenta de Kovalt -----------------------------------------------------------------

const pb = new PocketBase(KOVALT_URL)
pb.autoCancellation(false)
const store = pb.authStore

export interface Account {
  id: string
  name: string
  email: string
}

/** La cuenta de Kovalt con sesión en este navegador, si la hay. */
export function account(): Account | null {
  const r = store.record as Record<string, unknown> | null
  if (!store.token || !r || typeof r['id'] !== 'string') return null
  return { id: r['id'], name: displayName(r), email: String(r['email'] ?? '') }
}

function displayName(r: Record<string, unknown>): string {
  const name = typeof r['name'] === 'string' ? r['name'].trim() : ''
  if (name) return name
  const email = typeof r['email'] === 'string' ? r['email'] : ''
  return email.split('@')[0] || 'Jugador'
}

/** Pide el código de un solo uso al correo. Devuelve el `otpId` para `verifyOtp`. */
export async function requestOtp(email: string): Promise<string> {
  const clean = email.trim().toLowerCase()
  try {
    const res = await pb.collection('auth_users').requestOTP(clean)
    return res.otpId
  } catch (e) {
    throw sessionError(e)
  }
}

export async function verifyOtp(otpId: string, code: string): Promise<Account> {
  try {
    await pb.collection('auth_users').authWithOTP(otpId, code.trim())
  } catch (e) {
    throw sessionError(e)
  }
  return account() ?? raise('login')
}

/** Google, en una ventana emergente (el redirect lo hace Kovalt API). */
export async function loginWithGoogle(): Promise<Account> {
  try {
    await pb.collection('auth_users').authWithOAuth2({ provider: 'google' })
  } catch (e) {
    throw sessionError(e)
  }
  return account() ?? raise('login')
}

/** Cierra la cuenta de Kovalt y la sesión de Firebase que colgaba de ella. */
export async function logout(): Promise<void> {
  store.clear()
  try {
    await signOut(firebase().auth)
  } catch { /* sin Firebase configurado no hay nada que cerrar */ }
}

function raise(code: SessionError['code']): never {
  throw new SessionError(code)
}

/** PocketBase lanza `ClientResponseError`; aquí se reduce a lo que la UI distingue. */
function sessionError(e: unknown): SessionError {
  const status = typeof (e as { status?: unknown }).status === 'number'
    ? (e as { status: number }).status
    : 0
  // El hook de la lista blanca contesta 400 "Cuenta no permitida." tanto al
  // pedir el OTP como al canjearlo; un 400 con otro mensaje es un código malo.
  const msg = String((e as { message?: unknown }).message ?? '')
  if (status === 400 && /no permitida/i.test(msg)) return new SessionError('not-allowed')
  if (status === 403) return new SessionError('not-allowed')
  if (status === 0) return new SessionError('network')
  return new SessionError('login')
}

// --- sesión de Firebase --------------------------------------------------------------

export interface FirebaseSession {
  uid: string
  name: string
  guest: boolean
  room: string | null
}

async function callWorker(path: string, body: unknown): Promise<Record<string, unknown>> {
  let res: Response
  try {
    res = await fetch(path, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
  } catch {
    throw new SessionError('network')
  }
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>
  if (res.ok) return data
  if (res.status === 503) throw new SessionError('disabled')
  if (res.status === 403) throw new SessionError('not-allowed')
  if (res.status === 404) throw new SessionError('no-room')
  if (res.status === 400) throw new SessionError('name')
  throw new SessionError('network')
}

/** La sesión de Firebase que haya en este navegador, si sigue vigente. */
export async function currentSession(): Promise<FirebaseSession | null> {
  const user = firebase().auth.currentUser
  if (!user) return null
  const { claims } = await user.getIdTokenResult()
  const kvExp = typeof claims['kvExp'] === 'number' ? claims['kvExp'] : 0
  // Margen: una partida dura menos de una hora; si queda menos, se renueva ya.
  if (kvExp - Date.now() < 60 * 60 * 1000) return null
  return {
    uid: user.uid,
    name: typeof claims['name'] === 'string' ? claims['name'] : '',
    guest: claims['guest'] === true,
    room: typeof claims['room'] === 'string' ? claims['room'] : null,
  }
}

/**
 * Sesión de Firebase de la CUENTA (para crear salas). Reusa la que haya si
 * sigue vigente y es de la misma cuenta; si no, la canjea en el Worker.
 */
export async function hostSession(name: string): Promise<FirebaseSession> {
  const acc = account() ?? raise('login')
  const have = await currentSession()
  if (have && !have.guest && have.uid === acc.id) return { ...have, name }
  const data = await callWorker('/api/sesion', { token: store.token })
  // `auth-refresh` devuelve un token renovado: se guarda para alargar la sesión.
  if (typeof data['pbToken'] === 'string') store.save(data['pbToken'], store.record)
  const cred = await signInWithCustomToken(firebase().auth, String(data['firebaseToken']))
  return { uid: cred.user.uid, name, guest: false, room: null }
}

/** Sesión de INVITADO limitada a la sala `code`. */
export async function guestSession(code: string, name: string): Promise<FirebaseSession> {
  const have = await currentSession()
  if (have?.guest && have.room === code) return { ...have, name }
  const data = await callWorker('/api/invitado', { codigo: code, nombre: cleanName(name) })
  const cred = await signInWithCustomToken(firebase().auth, String(data['firebaseToken']))
  return { uid: cred.user.uid, name, guest: true, room: code }
}

function cleanName(name: string): string {
  return name.trim().replace(/\s+/g, ' ').slice(0, MAX_NAME)
}
