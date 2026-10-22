// Firebase, cargado BAJO DEMANDA y solo por el multijugador.
//
// El juego de un jugador no importa este módulo jamás: ui/net.ts lo trae con
// `import()` al crear o unirse a una sala, y el chunk `mp-vendor` queda fuera
// del precache (vite.config.ts). Sin conexión, el modo de un jugador sigue
// siendo el de siempre.
//
// La configuración del proyecto es PÚBLICA (identifica el proyecto, no es un
// secreto; los datos los protegen las Security Rules de firebase/). Llega por
// variables VITE_FIREBASE_* del `.env`: sin ellas el multijugador está apagado
// y la UI lo dice ("no disponible"), que es también el interruptor de urgencia.

import { initializeApp, type FirebaseApp } from 'firebase/app'
import { getAuth, type Auth } from 'firebase/auth'
import {
  getDatabase, ref, get, set, update, remove, runTransaction, onValue, onChildAdded,
  onDisconnect, query, orderByKey, startAt, serverTimestamp, type Database,
} from 'firebase/database'
import type { RoomStore, Unsub } from '../net/store'

export interface FirebaseHandles {
  app: FirebaseApp
  auth: Auth
  rtdb: Database
}

const env = import.meta.env

/** `true` si el build trae un proyecto de Firebase configurado. */
export function firebaseConfigured(): boolean {
  return Boolean(env['VITE_FIREBASE_API_KEY'] && env['VITE_FIREBASE_DATABASE_URL'])
}

let handles: FirebaseHandles | null = null
let offset = 0

export function firebase(): FirebaseHandles {
  if (handles) return handles
  if (!firebaseConfigured()) throw new Error('disabled')
  const opt = (key: string): Record<string, string> => {
    const v = env[`VITE_FIREBASE_${key}`] as string | undefined
    return v ? { [camel(key)]: v } : {}
  }
  const app = initializeApp({
    apiKey: env['VITE_FIREBASE_API_KEY'] as string,
    databaseURL: env['VITE_FIREBASE_DATABASE_URL'] as string,
    ...opt('AUTH_DOMAIN'),
    ...opt('PROJECT_ID'),
    ...opt('APP_ID'),
  })
  const rtdb = getDatabase(app)
  // Desfase reloj del servidor − reloj local: con él cada cliente calcula lo
  // que queda de un plazo escrito por el árbitro sin fiarse de su propia hora.
  onValue(ref(rtdb, '.info/serverTimeOffset'), (snap) => {
    offset = typeof snap.val() === 'number' ? (snap.val() as number) : 0
  })
  handles = { app, auth: getAuth(app), rtdb }
  return handles
}

/** `AUTH_DOMAIN` → `authDomain` (las claves de FirebaseOptions). */
function camel(key: string): string {
  return key.toLowerCase().replace(/_([a-z])/g, (_, c: string) => c.toUpperCase())
}

/** `RoomStore` sobre `rooms/{code}` de la Realtime Database. */
export function roomStore(code: string): RoomStore {
  const { rtdb } = firebase()
  const root = `rooms/${code}`
  const at = (path: string) => ref(rtdb, path ? `${root}/${path}` : root)

  return {
    async get<T>(path: string): Promise<T | null> {
      try {
        const snap = await get(at(path))
        return snap.exists() ? (snap.val() as T) : null
      } catch {
        return null // sin permiso = como si no existiera
      }
    },
    set: (path, value) => set(at(path), value),
    update: (values) => update(at(''), values),
    remove: (path) => remove(at(path)),
    async claim(path, value) {
      const res = await runTransaction(at(path), (cur: unknown) => (cur === null ? value : undefined))
      return res.committed
    },
    watch<T>(path: string, cb: (value: T | null) => void): Unsub {
      return onValue(
        at(path),
        (snap) => cb(snap.exists() ? (snap.val() as T) : null),
        () => cb(null), // permiso denegado: el nodo "no existe" para este cliente
      )
    },
    watchAppend<T>(path: string, fromKey: string, cb: (key: string, value: T) => void): Unsub {
      return onChildAdded(
        query(at(path), orderByKey(), startAt(fromKey)),
        (snap) => { if (snap.key !== null) cb(snap.key, snap.val() as T) },
        () => { /* sin permiso: la sala ya avisará por `meta` */ },
      )
    },
    presence(path: string): Unsub {
      const mine = at(path)
      // `.info/connected` se dispara en cada reconexión: se reprograma el
      // borrado al caer y se vuelve a escribir la presencia.
      const stop = onValue(ref(rtdb, '.info/connected'), (snap) => {
        if (snap.val() !== true) return
        void onDisconnect(mine).remove()
          .then(() => set(mine, true))
          .catch(() => { /* sin permiso: simplemente no aparece conectado */ })
      })
      return () => {
        stop()
        void onDisconnect(mine).cancel().catch(() => {})
        void remove(mine).catch(() => {})
      }
    },
    serverTimestamp: () => serverTimestamp(),
    serverOffset: () => offset,
  }
}
