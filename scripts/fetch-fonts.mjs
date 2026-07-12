// Descarga y auto-aloja las fuentes de la PWA en public/fonts/:
//  - Cormorant Garamond (500/600/700 + itálicas) y EB Garamond (400/500/600 +
//    400 itálica): display/serif del look Antique Parlour. Slice latino.
//  - Noto Serif JP: se descarga el TTF variable y scripts/subset-jp.py lo
//    recorta a los glifos del juego (fallback de --jp: cubre 發搶槓, que
//    Murecho no trae).
//  - Murecho NO se descarga: vive en raw/font/ y lo subsetea
//    scripts/subset-murecho.py.
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

// Cormorant Garamond (display del look Antique Parlour; el mockup usa
// itálica 700 en título y "Tsumo!")
{
  const css = await fetchText(
    'https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,500;0,600;0,700;1,500;1,600;1,700&display=swap',
  )
  for (const [key, url] of latinUrls(css)) {
    await download(url, `cormorant-${key}-latin.woff2`)
  }
}

// EB Garamond (serif de texto del mockup; "your turn" es itálica 400)
{
  const css = await fetchText(
    'https://fonts.googleapis.com/css2?family=EB+Garamond:ital,wght@0,400;0,500;0,600;1,400&display=swap',
  )
  for (const [key, url] of latinUrls(css)) {
    await download(url, `ebgaramond-${key}-latin.woff2`)
  }
}

// Noto Serif JP variable TTF (entrada del subset; NO se sirve tal cual)
await download(
  'https://github.com/google/fonts/raw/main/ofl/notoserifjp/NotoSerifJP%5Bwght%5D.ttf',
  '_noto-serif-jp-full.ttf',
  rawFont,
)
console.log('ahora: python scripts/subset-murecho.py && python scripts/subset-jp.py')
