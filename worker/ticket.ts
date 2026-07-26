// Ticket de anfitrión: la prueba de que quien abre una sala pasó por Turnstile.
//
// POR QUÉ EXISTE. La sala tenía que ser "perezosa": no gastar nada hasta que
// alguien la use de verdad. Pero un Durable Object con WebSockets hibernados
// puede desalojarse mientras el anfitrión espera en el lobby, y entonces el
// estado en memoria se pierde — o sea que "no escribir en storage" no es una
// opción si el DO ya existe.
//
// La pereza se mueve un paso antes: `POST /api/room` NO instancia ningún DO.
// Solo comprueba Turnstile, sortea un código y firma este ticket. Un bot que
// martillee el POST 10.000 veces no crea ni una sala. El DO nace —y escribe por
// primera vez— cuando alguien abre el WebSocket con un ticket válido, y para
// eso hay que haber resuelto Turnstile.
//
// La clave se DERIVA de TURNSTILE_SECRET con HKDF y una etiqueta propia, para
// no tener que configurar un segundo secreto y sin que los dos usos compartan
// material de clave.

const TTL_MS = 10 * 60 * 1000 // margen de sobra para elegir personaje y abrir la sala
const INFO = new TextEncoder().encode('twelvesmahjong/host-ticket/v1')

async function signingKey(secret: string): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(secret), 'HKDF', false, ['deriveKey'],
  )
  return crypto.subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(0), info: INFO },
    base,
    { name: 'HMAC', hash: 'SHA-256', length: 256 },
    false,
    ['sign', 'verify'],
  )
}

function b64url(bytes: ArrayBuffer): string {
  let s = ''
  for (const b of new Uint8Array(bytes)) s += String.fromCharCode(b)
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

/** `{exp}.{firma}` — el código va en el mensaje firmado, no en el ticket. */
export async function mintHostTicket(secret: string, code: string): Promise<string> {
  const exp = Date.now() + TTL_MS
  const key = await signingKey(secret)
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${code}|${exp}`))
  return `${exp}.${b64url(sig)}`
}

/** Verifica el ticket. `crypto.subtle.verify` ya compara en tiempo constante. */
export async function checkHostTicket(
  secret: string,
  code: string,
  ticket: string,
): Promise<boolean> {
  const dot = ticket.indexOf('.')
  if (dot < 1) return false
  const exp = Number(ticket.slice(0, dot))
  if (!Number.isFinite(exp) || exp < Date.now()) return false

  const raw = ticket.slice(dot + 1).replace(/-/g, '+').replace(/_/g, '/')
  // Se construye un ArrayBuffer propio en vez de `Uint8Array.from`: el `lib:
  // DOM` del tsconfig raíz (los tests importan este módulo) no acepta un
  // Uint8Array de buffer genérico donde pide BufferSource.
  let sig: ArrayBuffer
  try {
    const bin = atob(raw)
    sig = new ArrayBuffer(bin.length)
    const view = new Uint8Array(sig)
    for (let i = 0; i < bin.length; i++) view[i] = bin.charCodeAt(i)
  } catch {
    return false
  }
  const key = await signingKey(secret)
  return crypto.subtle.verify('HMAC', key, sig, new TextEncoder().encode(`${code}|${exp}`))
}
