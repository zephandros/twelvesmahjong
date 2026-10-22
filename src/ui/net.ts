// Multijugador, del lado de la UI: junta la sesión (ui/session.ts), el almacén
// real (ui/firebase.ts) y el cliente de sala (net/client.ts), y traduce los
// códigos de error. El lobby solo ve `openAsHost` / `openAsGuest`.
//
// Este módulo arrastra Firebase y PocketBase, así que el lobby lo carga con
// `import()` solo al crear o unirse a una sala: el juego de un jugador y la
// portada no tocan la red jamás.

import { newRoomCode } from '../net/codes'
import { createRoom, joinRoom, type ClientHandlers, type RoomConnection } from '../net/client'
import type { ErrorCode } from '../net/protocol'
import { roomStore } from './firebase'
import { hostSession, guestSession, currentSession, SessionError } from './session'
import { PATH, type RoomMeta } from '../net/protocol'
import { t } from './i18n'

export type { ClientHandlers, RoomConnection }
export { account, requestOtp, verifyOtp, loginWithGoogle, logout, SessionError } from './session'
export { firebaseConfigured } from './firebase'

export type ErrorKey = ErrorCode | SessionError['code'] | 'offline'

/** Mensaje traducido de un código de error. */
export function errorMessage(code: ErrorKey): string {
  // Los códigos del protocolo van en snake_case y las claves i18n en kebab.
  return t(`mp.error.${code.replace(/_/g, '-')}` as Parameters<typeof t>[0])
}

export function errorKey(err: unknown): ErrorKey {
  if (!navigator.onLine) return 'offline'
  if (err instanceof SessionError) return err.code
  if (err instanceof Error && err.message === 'disabled') return 'disabled'
  return 'network'
}

export interface Opened {
  code: string
  conn: RoomConnection
}

/** Crea una sala nueva (hace falta cuenta de Kovalt) y se sienta de anfitrión. */
export async function openAsHost(name: string, h: ClientHandlers): Promise<Opened> {
  const me = await hostSession(name)
  // El código lo sortea el cliente; chocar con una sala viva es 1 entre 10^9,
  // y si pasa, la escritura falla (las reglas no dejan pisar un `meta` ajeno).
  for (let i = 0; i < 3; i++) {
    const code = newRoomCode()
    const store = roomStore(code)
    try {
      await createRoom(store, { uid: me.uid, name })
    } catch {
      continue
    }
    return { code, conn: joinRoom(store, code, { uid: me.uid, name }, h) }
  }
  throw new SessionError('network')
}

/**
 * Entra en la sala `code`. Normalmente como invitado; pero si este navegador
 * tiene la sesión de la CUENTA que creó esa sala, vuelve como anfitrión (es
 * como se recupera el mando tras cerrar la pestaña o recargar): las reglas
 * solo dejan leer `meta` al anfitrión o a un invitado de esa sala, así que
 * leerlo con la cuenta ya dice si la sala es suya.
 */
export async function openAsGuest(code: string, name: string, h: ClientHandlers): Promise<Opened> {
  const have = await currentSession()
  if (have && !have.guest) {
    const store = roomStore(code)
    const meta = await store.get<RoomMeta>(PATH.meta)
    if (meta?.host === have.uid) {
      return { code, conn: joinRoom(store, code, { uid: have.uid, name }, h) }
    }
  }
  const me = await guestSession(code, name)
  const store = roomStore(code)
  return { code, conn: joinRoom(store, code, { uid: me.uid, name }, h) }
}
