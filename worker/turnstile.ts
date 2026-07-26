// Validación de Turnstile — la prueba «soy humano» de Cloudflare.
//
// Se exige SOLO al crear sala, que es lo único que puede instanciar un Durable
// Object. Unirse por código no la pide: el código ya es el secreto de esa sala.
//
// Los tokens son de un solo uso y caducan a los ~300 s, así que reenviar uno
// válido en bucle no sirve de nada: el segundo intento ya falla en siteverify.

const VERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify'

export async function verifyTurnstile(
  secret: string,
  token: string,
  ip: string | null,
): Promise<boolean> {
  const body = new FormData()
  body.append('secret', secret)
  body.append('response', token)
  if (ip) body.append('remoteip', ip)

  try {
    const res = await fetch(VERIFY_URL, { method: 'POST', body })
    if (!res.ok) return false
    const data = (await res.json()) as { success?: boolean }
    return data.success === true
  } catch {
    // Turnstile caído o red cortada: se falla CERRADO. Es preferible no poder
    // crear salas un rato a dejar la puerta abierta de par en par.
    return false
  }
}
