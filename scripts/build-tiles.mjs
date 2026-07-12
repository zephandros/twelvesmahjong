// Pipeline de fichas: raw/tiles/*.svg → public/tiles/{label}.svg
//
// Los nombres de salida son EXACTAMENTE las etiquetas de labelId() de
// core/tile.ts (1m..9m, 1p..9p, 1s..9s, E, S, W, N, haku, hatsu, chun y
// 0m/0p/0s para las aka). El renderer resuelve `tiles/<labelId(id)>.svg`
// por identidad — no hay tabla de mapeo en runtime; toda la traducción de
// orden externo vive AQUÍ, en el borde del sistema (regla de oro, CLAUDE.md).
//
// TRAMPA 2 (CLAUDE.md): los honores del set vienen en orden no canónico.
// Evidencia — el atributo sodipodi:docname de cada SVG conserva el nombre
// original en kanji del arte:
//   tile_honor_01 = 0401東  → E        tile_honor_05 = (glifo rojo #870000) → chun
//   tile_honor_02 = 0402西  → W (¡!)   tile_honor_06 = 0406發 → hatsu
//   tile_honor_03 = 0403南  → S (¡!)   tile_honor_07 = 0407白 → haku (¡!)
//   tile_honor_04 = 0404北風 → N
// Es decir: S/W intercambiados y dragones invertidos (5↔7), tal y como
// avisaba la trampa. Mapeo verificado visualmente en ?debug=tiles.
// NUNCA derivar un honor del número del nombre de archivo.
//
// Uso: npm run assets:tiles

import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { optimize } from 'svgo'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const SRC = join(ROOT, 'raw', 'tiles')
const OUT = join(ROOT, 'public', 'tiles')

const EXPECTED_VIEWBOX = '0 0 139.764 200'

// --- tabla de mapeo explícita: archivo crudo → etiqueta canónica -----------

/** @type {Record<string, string>} */
const MAP = {
  // números: aquí sí el número del archivo es el rango (verificado visualmente;
  // los docname de los números son copias rancias y NO se usan como evidencia)
  ...Object.fromEntries(
    ['man', 'pin', 'so'].flatMap((suit, si) =>
      Array.from({ length: 9 }, (_, i) => [
        `tile_${suit}_0${i + 1}`,
        `${i + 1}${'mps'[si]}`,
      ]),
    ),
  ),
  // aka dora (labelId usa 0m/0p/0s)
  tile_aka_man_05: '0m',
  tile_aka_pin_05: '0p',
  tile_aka_so_05: '0s',
  // honores: mapeo NO trivial (ver cabecera). null = sin verificar → el
  // pipeline falla; solo se rellena con evidencia + verificación visual.
  tile_honor_01: 'E',
  tile_honor_02: 'W',
  tile_honor_03: 'S',
  tile_honor_04: 'N',
  tile_honor_05: 'chun',
  tile_honor_06: 'hatsu',
  tile_honor_07: 'haku',
}

/** Los 37 labels que DEBEN existir al terminar (34 caras + 3 aka). */
const ALL_LABELS = [
  ...['m', 'p', 's'].flatMap((s) => Array.from({ length: 9 }, (_, i) => `${i + 1}${s}`)),
  'E', 'S', 'W', 'N', 'haku', 'hatsu', 'chun',
  '0m', '0p', '0s',
]

// --- proceso -----------------------------------------------------------------

const files = (await readdir(SRC)).filter((f) => f.endsWith('.svg'))
await mkdir(OUT, { recursive: true })

const produced = new Map()
let inBytes = 0
let outBytes = 0

for (const file of files.sort()) {
  const base = file.replace(/\.svg$/, '')
  const label = MAP[base]
  if (label === undefined) throw new Error(`sin mapeo para ${file} — amplía MAP`)
  if (label === null) throw new Error(`honor sin verificar: ${file} — verifica en ?debug=tiles y rellena MAP`)
  if (produced.has(label)) throw new Error(`label duplicado ${label} (${file} y ${produced.get(label)})`)

  const raw = await readFile(join(SRC, file), 'utf8')
  const vb = /viewBox="([^"]*)"/.exec(raw)?.[1]
  if (vb !== EXPECTED_VIEWBOX) {
    throw new Error(`${file}: viewBox inesperado "${vb}" (esperaba "${EXPECTED_VIEWBOX}")`)
  }

  // svgo v4: preset-default ya NO toca el viewBox (removeViewBox salió del preset)
  const { data } = optimize(raw, {
    multipass: true,
    plugins: [
      'preset-default',
      'removeDimensions', // width/height fuera; manda el viewBox
    ],
  })

  if (!data.includes(`viewBox="${EXPECTED_VIEWBOX}"`)) {
    throw new Error(`${file}: la optimización perdió el viewBox`)
  }

  await writeFile(join(OUT, `${label}.svg`), data)
  produced.set(label, file)
  inBytes += raw.length
  outBytes += data.length
}

const missing = ALL_LABELS.filter((l) => !produced.has(l))
if (missing.length > 0) throw new Error(`faltan labels: ${missing.join(', ')}`)

console.log(`OK: ${produced.size} fichas → public/tiles/ (${(inBytes / 1024).toFixed(0)} KB → ${(outBytes / 1024).toFixed(0)} KB)`)
