// Integridad del CSV de traducciones y frescura del módulo generado.
// Reusa el parser/validador REAL de scripts/build-i18n.mjs (una sola
// implementación): si el CSV está mal, esto falla igual que `npm run
// assets:i18n`. Las claves derivadas de ids del core (yaku.*, limit.*, …)
// las vigila el tipo DerivedKeyCheck de src/ui/i18n.ts en el typecheck.

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import {
  parseCsv, buildMessages, glyphsOf, missingGlyphs, CSV_PATH, GLYPHS_PATH,
} from '../scripts/build-i18n.mjs'
import { MESSAGES } from '../src/ui/i18n-strings.generated'
import { CHARACTERS } from '../src/ui/characters'

const csv = readFileSync(CSV_PATH, 'utf8')

describe('i18n/strings.csv', () => {
  it('valida: cabecera, claves, es no vacía y placeholders consistentes', () => {
    // buildMessages lanza con mensaje claro ante cualquier defecto
    expect(() => buildMessages(csv)).not.toThrow()
  })

  it('parsea con separador | y campos entrecomillados (pipes, comillas dobladas, saltos)', () => {
    const rows = parseCsv('a|"b|1"|"c ""q"" d"\r\nx|"multi\nlínea"|z, con comas\n')
    expect(rows).toEqual([
      ['a', 'b|1', 'c "q" d'],
      ['x', 'multi\nlínea', 'z, con comas'],
    ])
  })

  it('todo glifo CJK/kana del CSV está en GLYPHS de jp_glyphs.py', () => {
    const messages = buildMessages(csv)
    const missing = missingGlyphs(messages, glyphsOf(readFileSync(GLYPHS_PATH, 'utf8')))
    expect(missing, `añade a jp_glyphs.py y relanza assets:fonts: ${missing.join('')}`)
      .toEqual([])
  })

  it('frescura: i18n-strings.generated.ts está al día con el CSV', () => {
    // si esto falla: `npm run assets:i18n` y commitea el módulo regenerado
    expect(MESSAGES).toEqual(buildMessages(csv))
  })

  it('cada personaje tiene char.<id>.name y char.<id>.epithet', () => {
    const keys = new Set(Object.keys(MESSAGES))
    for (const c of CHARACTERS) {
      expect(keys, `falta char.${c.id}.name`).toContain(`char.${c.id}.name`)
      expect(keys, `falta char.${c.id}.epithet`).toContain(`char.${c.id}.epithet`)
    }
  })
})
