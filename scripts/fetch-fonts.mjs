// Descarga y auto-aloja las fuentes de la PWA en public/fonts/:
//  - Teko (variable 400-700) y Rajdhani (400/500/600/700): slice latino de
//    Google Fonts tal cual (woff2 pequeños).
//  - Noto Serif JP Bold: se descarga el TTF variable y scripts/subset-jp.py
//    lo recorta a los glifos que usa el juego (queda en ~10 KB).
// Reproducible: node scripts/fetch-fonts.mjs && python scripts/subset-jp.py

import { mkdirSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const out = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'fonts')
mkdirSync(out, { recursive: true })

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36'

/** Extrae del CSS de Google Fonts la URL del slice cuyo unicode-range es latino. */
function latinUrls(css) {
  const blocks = css.split('@font-face').slice(1)
  const found = new Map() // weightKey -> url
  for (const b of blocks) {
    if (!b.includes('U+0000-00FF')) continue
    const url = /url\((https:[^)]+\.woff2)\)/.exec(b)?.[1]
    const weight = /font-weight:\s*([\d ]+);/.exec(b)?.[1]?.trim() ?? '400'
    if (url) found.set(weight, url)
  }
  return found
}

async function fetchText(url) {
  const r = await fetch(url, { headers: { 'user-agent': UA } })
  if (!r.ok) throw new Error(`${r.status} ${url}`)
  return r.text()
}

async function download(url, file) {
  const r = await fetch(url, { headers: { 'user-agent': UA } })
  if (!r.ok) throw new Error(`${r.status} ${url}`)
  const buf = Buffer.from(await r.arrayBuffer())
  writeFileSync(join(out, file), buf)
  console.log(`${file.padEnd(28)} ${(buf.length / 1024).toFixed(1)} KB`)
}

// Teko variable (un solo woff2 cubre 400-700)
{
  const css = await fetchText(
    'https://fonts.googleapis.com/css2?family=Teko:wght@400..700&display=swap',
  )
  const urls = latinUrls(css)
  const [weight, url] = [...urls.entries()][0]
  console.log(`Teko variable (${weight})`)
  await download(url, 'teko-var-latin.woff2')
}

// Rajdhani estáticas
{
  const css = await fetchText(
    'https://fonts.googleapis.com/css2?family=Rajdhani:wght@400;500;600;700&display=swap',
  )
  const urls = latinUrls(css)
  for (const [weight, url] of urls) {
    await download(url, `rajdhani-${weight}-latin.woff2`)
  }
}

// Noto Serif JP variable TTF (entrada del subset; NO se sirve tal cual)
await download(
  'https://github.com/google/fonts/raw/main/ofl/notoserifjp/NotoSerifJP%5Bwght%5D.ttf',
  '_noto-serif-jp-full.ttf',
)
console.log('ahora: python scripts/subset-jp.py')
