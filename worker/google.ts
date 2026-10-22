import { decodeJwt, verifyRs256 } from './jwt';

/* Verificación de ID tokens de Firebase con las claves públicas de securetoken (para renovar la sesión de un
 * invitado sin pedirle otra vez el código). Copiado del Worker de Kovalt Roller, sin la parte de Firestore. */

type FetchFn = typeof fetch;

const JWKS_URL = 'https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com';
let jwksCache: { keys: Map<string, CryptoKey>; expiresAt: number } | null = null;

async function securetokenKeys(fetchFn: FetchFn, nowS: number): Promise<Map<string, CryptoKey>> {
  if (jwksCache && jwksCache.expiresAt > nowS) return jwksCache.keys;
  const res = await fetchFn(JWKS_URL);
  if (!res.ok) throw new Error(`JWKS ${res.status}`);
  const { keys } = (await res.json()) as { keys: (JsonWebKey & { kid: string })[] };
  const map = new Map<string, CryptoKey>();
  for (const jwk of keys) {
    map.set(jwk.kid, await crypto.subtle.importKey('jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']));
  }
  jwksCache = { keys: map, expiresAt: nowS + 3600 };
  return map;
}

export function resetJwksCache(): void {
  jwksCache = null;
}

/** Verifica un ID token de Firebase del proyecto y devuelve sus claims (o `null` si no es válido). */
export async function verifyIdToken(idToken: string, projectId: string, fetchFn: FetchFn = fetch, nowS = Math.floor(Date.now() / 1000)): Promise<Record<string, unknown> | null> {
  let jwt;
  try {
    jwt = decodeJwt(idToken);
  } catch {
    return null;
  }
  if (jwt.header.alg !== 'RS256' || !jwt.header.kid) return null;
  const key = (await securetokenKeys(fetchFn, nowS)).get(jwt.header.kid);
  if (!key || !(await verifyRs256(jwt, key))) return null;
  const p = jwt.payload;
  const ok =
    p.aud === projectId &&
    p.iss === `https://securetoken.google.com/${projectId}` &&
    typeof p.sub === 'string' &&
    p.sub.length > 0 &&
    typeof p.exp === 'number' &&
    p.exp > nowS &&
    typeof p.iat === 'number' &&
    p.iat <= nowS + 300;
  return ok ? p : null;
}
