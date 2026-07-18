// Pipeline de i18n: i18n/strings.csv → src/ui/i18n-strings.generated.ts
//
// El CSV es la fuente de verdad de TODOS los textos visibles (es/en/ja); el
// módulo generado entra al bundle (tipado + precache PWA gratis). Toda la
// traducción vive AQUÍ, en el borde del sistema (regla de oro, CLAUDE.md):
// core/ solo devuelve ids y la UI los resuelve con t().
//
// Formato: columnas separadas por PIPE `|` (así las comas y los `·` de los
// textos no necesitan comillas); el entrecomillado estilo RFC 4180 sigue
// disponible para campos con `|`, comillas o saltos de línea.
//
// Validaciones duras (abortan el build):
//  - cabecera exacta `key|context|es|en|ja` y nº de columnas por fila;
//  - claves con forma `dominio.sub[-sub…]`, sin duplicados, columna es no vacía;
//  - placeholders {x} idénticos entre columnas no vacías;
//  - todo glifo CJK/kana usado en CUALQUIER columna debe estar en GLYPHS de
//    scripts/jp_glyphs.py (si no, el woff2 subseteado lo pintaría en tofu).
//
// Uso: npm run assets:i18n   (tests/i18n.test.ts reusa parseCsv/buildMessages)

import { readFile, writeFile } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import process from 'node:process'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
export const CSV_PATH = join(ROOT, 'i18n', 'strings.csv')
export const GLYPHS_PATH = join(ROOT, 'scripts', 'jp_glyphs.py')
const OUT = join(ROOT, 'src', 'ui', 'i18n-strings.generated.ts')

const HEADER = ['key', 'context', 'es', 'en', 'ja']
const SEP = '|'
const KEY_RE = /^[a-z0-9]+(\.[a-z0-9-]+)+$/
// Glifos que dependen del subset JP: símbolos CJK (々・), hiragana, katakana,
// ideogramas y formas de ancho completo. El latín (acentos, ¿¡, º) vive en los
// slices latinos U+0000-00FF de Lexend/Belanosima y no se valida aquí.
const CJK_RE = /[　-〿぀-ゟ゠-ヿ㐀-䶿一-鿿豈-﫿＀-￯]/gu

/** Parser mínimo estilo RFC 4180 con `|` de separador: comillas, `""`, pipes/saltos dentro de campo. */
export function parseCsv(text) {
  const src = text.replace(/^﻿/, '') // BOM fuera
  const rows = []
  let row = []
  let field = ''
  let quoted = false
  for (let i = 0; i < src.length; i++) {
    const ch = src[i]
    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') { field += '"'; i++ } else quoted = false
      } else field += ch
      continue
    }
    if (ch === '"' && field === '') { quoted = true; continue }
    if (ch === SEP) { row.push(field); field = ''; continue }
    if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i++
      row.push(field); field = ''
      rows.push(row); row = []
      continue
    }
    field += ch
  }
  if (quoted) throw new Error('CSV mal formado: comillas sin cerrar al final del archivo')
  if (field !== '' || row.length > 0) { row.push(field); rows.push(row) }
  return rows.filter((r) => !(r.length === 1 && r[0] === ''))
}

const placeholdersOf = (s) => new Set([...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]))

/**
 * Valida las filas y devuelve `{ key: { es, en?, ja? } }` (celdas vacías = fallback
 * deliberado a es y se omiten). Lanza con mensaje claro ante cualquier defecto.
 */
export function buildMessages(csvText) {
  const rows = parseCsv(csvText)
  const header = rows.shift()
  if (!header || header.join(SEP) !== HEADER.join(SEP)) {
    throw new Error(`cabecera inesperada "${header?.join(SEP)}" (esperaba "${HEADER.join(SEP)}")`)
  }
  const messages = {}
  for (const [i, r] of rows.entries()) {
    const line = i + 2 // 1-based + cabecera
    if (r.length !== HEADER.length) {
      throw new Error(`línea ${line}: ${r.length} columnas (esperaba ${HEADER.length})`)
    }
    const [key, , es, en, ja] = r
    if (!KEY_RE.test(key)) throw new Error(`línea ${line}: clave inválida "${key}"`)
    if (key in messages) throw new Error(`línea ${line}: clave duplicada "${key}"`)
    if (es === '') throw new Error(`línea ${line}: la columna es de "${key}" no puede estar vacía`)
    const ph = placeholdersOf(es)
    for (const [col, val] of [['en', en], ['ja', ja]]) {
      if (val === '') continue
      const p = placeholdersOf(val)
      if (p.size !== ph.size || [...p].some((x) => !ph.has(x))) {
        throw new Error(
          `línea ${line}: placeholders de ${col} {${[...p].join(',')}} ≠ es {${[...ph].join(',')}} en "${key}"`,
        )
      }
    }
    const entry = { es }
    if (en !== '') entry.en = en
    if (ja !== '') entry.ja = ja
    messages[key] = entry
  }
  return messages
}

/** Set de glifos declarados en GLYPHS de jp_glyphs.py (literales entre comillas simples). */
export function glyphsOf(pyText) {
  const set = new Set()
  for (const m of pyText.matchAll(/'([^']*)'/g)) for (const ch of m[1]) set.add(ch)
  return set
}

/** Glifos CJK/kana usados por los mensajes que faltan en el set del subset. */
export function missingGlyphs(messages, glyphSet) {
  const missing = new Set()
  for (const entry of Object.values(messages)) {
    for (const text of Object.values(entry)) {
      for (const ch of text.match(CJK_RE) ?? []) {
        if (!glyphSet.has(ch)) missing.add(ch)
      }
    }
  }
  return [...missing]
}

async function main() {
  const csv = await readFile(CSV_PATH, 'utf8')
  const messages = buildMessages(csv)

  const glyphSet = glyphsOf(await readFile(GLYPHS_PATH, 'utf8'))
  const missing = missingGlyphs(messages, glyphSet)
  if (missing.length > 0) {
    throw new Error(
      `faltan ${missing.length} glifos en scripts/jp_glyphs.py: ${missing.join('')}\n` +
      'Añádelos a GLYPHS y relanza `npm run assets:fonts` (si no, saldrían en tofu).',
    )
  }

  const body = Object.entries(messages)
    .map(([k, v]) => {
      const cells = Object.entries(v).map(([c, s]) => `${c}: ${JSON.stringify(s)}`)
      return `  ${JSON.stringify(k)}: { ${cells.join(', ')} },`
    })
    .join('\n')
  const out =
    '// AUTOGENERADO por scripts/build-i18n.mjs — NO editar a mano.\n' +
    '// Fuente de verdad: i18n/strings.csv → `npm run assets:i18n`.\n' +
    '// Celda en/ja ausente = fallback deliberado a es (lo resuelve t()).\n\n' +
    'export const MESSAGES = {\n' + body + '\n} as const\n\n' +
    'export type MsgKey = keyof typeof MESSAGES\n'
  await writeFile(OUT, out)
  console.log(`OK: ${Object.keys(messages).length} claves → src/ui/i18n-strings.generated.ts`)
}

if (process.argv[1] && fileURLToPath(import.meta.url) === join(process.argv[1])) {
  main().catch((err) => {
    console.error(String(err.message ?? err))
    process.exit(1)
  })
}
