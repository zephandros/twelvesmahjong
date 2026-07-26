// Códigos de sala. Los genera SIEMPRE el servidor, nunca el cliente: si el
// cliente eligiera el código podría okupar los bonitos o enumerar salas ajenas.
// El cliente solo usa `isRoomCode`, para no mandar al servidor lo que ya se sabe
// que no es un código.
//
// Alfabeto sin caracteres ambiguos (fuera I, O, 0, 1) para que se pueda dictar
// por voz o por chat sin equivocarse. Son 32 símbolos = 5 bits exactos, así que
// enmascarar un byte con 0x1f da una distribución uniforme sin rechazar nada.

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
export const CODE_LENGTH = 6 // 32^6 = 2^30 ≈ mil millones de combinaciones

export function newRoomCode(): string {
  const bytes = new Uint8Array(CODE_LENGTH)
  crypto.getRandomValues(bytes)
  let out = ''
  for (const b of bytes) out += ALPHABET[b & 0x1f]
  return out
}

export function isRoomCode(s: string): boolean {
  if (s.length !== CODE_LENGTH) return false
  for (const ch of s) if (!ALPHABET.includes(ch)) return false
  return true
}
