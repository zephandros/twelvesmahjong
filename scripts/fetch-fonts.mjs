// Descarga y auto-aloja las fuentes de la PWA en public/fonts/:
//  - Lexend (variable, eje wght): títulos (--title). Slice latino.
//  - Belanosima (solo 400 — NUNCA se usa en negrita): acciones, submenús y UI
//    en general (--ui). Slice latino.
//  - Kosugi: caracteres japoneses (--jp y fallback CJK de todos los stacks).
//    Se descarga el TTF completo y scripts/subset-jp.py lo recorta a los
//    glifos del juego (jp_glyphs.py).
// Reproducible: npm run assets:fonts

import { mkdirSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const out = join(root, 'public', 'fonts')
// insumos intermedios (NO se sirven): fuera de public/ para no inflar dist/
const rawFont = join(root, 'raw', 'font')
mkdirSync(out, { recursive: true })
mkdirSync(rawFont, { recursive: true })

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36'

/** Extrae del CSS de Google Fonts la URL del slice cuyo unicode-range es latino.
 *  Clave: "peso" o "peso-italic" (p.ej. "600", "600-italic"). */
function latinUrls(css) {
  const blocks = css.split('@font-face').slice(1)
  const found = new Map()
  for (const b of blocks) {
    if (!b.includes('U+0000-00FF')) continue
    const url = /url\((https:[^)]+\.woff2)\)/.exec(b)?.[1]
    const weight = /font-weight:\s*([\d ]+);/.exec(b)?.[1]?.trim() ?? '400'
    const italic = /font-style:\s*italic/.test(b)
    if (url) found.set(italic ? `${weight}-italic` : weight, url)
  }
  return found
}

async function fetchText(url) {
  const r = await fetch(url, { headers: { 'user-agent': UA } })
  if (!r.ok) throw new Error(`${r.status} ${url}`)
  return r.text()
}

async function download(url, file, dir = out) {
  const r = await fetch(url, { headers: { 'user-agent': UA } })
  if (!r.ok) throw new Error(`${r.status} ${url}`)
  const buf = Buffer.from(await r.arrayBuffer())
  writeFileSync(join(dir, file), buf)
  console.log(`${file.padEnd(28)} ${(buf.length / 1024).toFixed(1)} KB`)
}

// Lexend variable (títulos). Pedir el rango wght@100..900 hace que la API
// css2 sirva el woff2 variable en un solo slice latino.
{
  const css = await fetchText(
    'https://fonts.googleapis.com/css2?family=Lexend:wght@100..900&display=swap',
  )
  const urls = latinUrls(css)
  const url = urls.get('100 900') ?? urls.get('400')
  if (!url) throw new Error('no se encontró el slice latino variable de Lexend')
  await download(url, 'lexend-var-latin.woff2')
}

// Belanosima (acciones/submenús/UI). Solo 400: el proyecto no usa Belanosima
// en negrita (regla explícita del usuario).
{
  const css = await fetchText(
    'https://fonts.googleapis.com/css2?family=Belanosima:wght@400&display=swap',
  )
  const url = latinUrls(css).get('400')
  if (!url) throw new Error('no se encontró Belanosima 400 (slice latino)')
  await download(url, 'belanosima-400-latin.woff2')
}

// Kosugi TTF completo (entrada del subset JP; NO se sirve tal cual)
await download(
  'https://github.com/google/fonts/raw/main/apache/kosugi/Kosugi-Regular.ttf',
  '_kosugi-full.ttf',
  rawFont,
)
console.log('ahora: python scripts/subset-jp.py')
