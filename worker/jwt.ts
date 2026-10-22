/* JWT RS256 con WebCrypto (Workers y Node 20+): firmar custom tokens de Firebase y assertions de OAuth con la
 * cuenta de servicio, y verificar ID tokens de Firebase con las claves públicas de securetoken. */

export interface ServiceAccount {
  project_id: string;
  client_email: string;
  private_key: string;
}

export function parseServiceAccount(json: string | undefined): ServiceAccount {
  if (!json) throw new Error('Falta el secreto FIREBASE_SERVICE_ACCOUNT');
  const sa = JSON.parse(json) as Partial<ServiceAccount>;
  if (!sa.client_email || !sa.private_key || !sa.project_id) throw new Error('FIREBASE_SERVICE_ACCOUNT incompleto');
  return { project_id: sa.project_id, client_email: sa.client_email, private_key: sa.private_key };
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export function base64url(data: Uint8Array | string): string {
  const bytes = typeof data === 'string' ? encoder.encode(data) : data;
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

// Devuelve una vista sobre un ArrayBuffer propio (no `ArrayBufferLike`): el
// `lib: DOM` del tsconfig raíz (los tests cargan este módulo) no acepta otra
// cosa donde WebCrypto pide BufferSource.
function bytesOf(text: string): Uint8Array<ArrayBuffer> {
  const src = encoder.encode(text);
  const out = new Uint8Array(new ArrayBuffer(src.length));
  out.set(src);
  return out;
}

export function base64urlDecode(s: string): Uint8Array<ArrayBuffer> {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (s.length % 4)) % 4);
  const bin = atob(b64);
  const out = new Uint8Array(new ArrayBuffer(bin.length));
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

const RS256 = { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' } as const;
const keyCache = new Map<string, Promise<CryptoKey>>();

/** Clave privada PKCS#8 en PEM (la de la cuenta de servicio). */
export function importPrivateKey(pem: string): Promise<CryptoKey> {
  let key = keyCache.get(pem);
  if (!key) {
    const body = pem.replace(/-----(BEGIN|END) PRIVATE KEY-----/g, '').replace(/\s+/g, '');
    key = crypto.subtle.importKey('pkcs8', base64urlDecode(body), RS256, false, ['sign']);
    keyCache.set(pem, key);
  }
  return key;
}

export async function signJwt(payload: Record<string, unknown>, privateKeyPem: string, kid?: string): Promise<string> {
  const header = { alg: 'RS256', typ: 'JWT', ...(kid ? { kid } : {}) };
  const input = `${base64url(JSON.stringify(header))}.${base64url(JSON.stringify(payload))}`;
  const sig = await crypto.subtle.sign(RS256, await importPrivateKey(privateKeyPem), encoder.encode(input));
  return `${input}.${base64url(new Uint8Array(sig))}`;
}

export interface DecodedJwt {
  header: { alg?: string; kid?: string };
  payload: Record<string, unknown>;
  signingInput: Uint8Array<ArrayBuffer>;
  signature: Uint8Array<ArrayBuffer>;
}

export function decodeJwt(token: string): DecodedJwt {
  const parts = token.split('.');
  if (parts.length !== 3) throw new Error('JWT mal formado');
  const [h, p, s] = parts as [string, string, string];
  return {
    header: JSON.parse(decoder.decode(base64urlDecode(h))) as DecodedJwt['header'],
    payload: JSON.parse(decoder.decode(base64urlDecode(p))) as Record<string, unknown>,
    signingInput: bytesOf(`${h}.${p}`),
    signature: base64urlDecode(s),
  };
}

export async function verifyRs256(jwt: DecodedJwt, key: CryptoKey): Promise<boolean> {
  return crypto.subtle.verify(RS256, key, jwt.signature, jwt.signingInput);
}

export const CUSTOM_TOKEN_AUDIENCE = 'https://identitytoolkit.googleapis.com/google.identity.identitytoolkit.v1.IdentityToolkit';

/** Custom token de Firebase (válido 1 h para canjearlo con `signInWithCustomToken`). Los `claims` quedan en el
 *  ID token de la sesión y las reglas los leen en `request.auth.token`. */
export function createCustomToken(sa: ServiceAccount, uid: string, claims: Record<string, unknown>, nowS = Math.floor(Date.now() / 1000)): Promise<string> {
  return signJwt(
    { iss: sa.client_email, sub: sa.client_email, aud: CUSTOM_TOKEN_AUDIENCE, iat: nowS, exp: nowS + 3600, uid, claims },
    sa.private_key,
  );
}
