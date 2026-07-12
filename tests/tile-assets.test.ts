// Ata el pipeline de fichas (scripts/build-tiles.mjs) al contrato del runtime:
// public/tiles/{label}.svg debe existir para cada label de core/tile.ts, sin
// metadata de editor, con el viewBox intacto, y con la anti-regresión de la
// trampa 2 (dragones invertidos en el set crudo): chun es el honor rojo, haku no.

import { describe, it, expect } from 'vitest'
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { TILE34_COUNT, label34 } from '../src/core/tile'

const DIR = join(__dirname, '..', 'public', 'tiles')

const ALL_LABELS = [
  ...Array.from({ length: TILE34_COUNT }, (_, t) => label34(t)),
  '0m', '0p', '0s',
]

const read = (label: string): string =>
  readFileSync(join(DIR, `${label}.svg`), 'utf8')

describe('assets de fichas (public/tiles)', () => {
  it('existen los 37 SVG, uno por label canónico', () => {
    for (const label of ALL_LABELS) {
      expect(existsSync(join(DIR, `${label}.svg`)), `falta ${label}.svg`).toBe(true)
    }
  })

  it('conservan el viewBox y no arrastran metadata de editor', () => {
    for (const label of ALL_LABELS) {
      const svg = read(label)
      expect(svg, `${label}.svg sin viewBox`).toContain('viewBox="0 0 139.764 200"')
      for (const junk of ['sodipodi', 'inkscape', 'rdf:', 'dc:']) {
        expect(svg.includes(junk), `${label}.svg contiene ${junk}`).toBe(false)
      }
    }
  })

  it('anti-regresión trampa 2: chun es el honor rojo, haku no', () => {
    expect(read('chun')).toContain('#870000')
    expect(read('haku')).not.toContain('#870000')
  })

  it('las aka son arte distinto del 5 normal de su palo', () => {
    for (const [aka, five] of [['0m', '5m'], ['0p', '5p'], ['0s', '5s']] as const) {
      expect(read(aka), `${aka} idéntica a ${five}`).not.toBe(read(five))
    }
  })
})
