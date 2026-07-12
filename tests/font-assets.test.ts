// Ata el pipeline de fuentes (npm run assets:fonts) al CSS: cada woff2 que
// styles.css declara en @font-face debe existir en public/fonts/, y las
// familias retiradas no deben reaparecer. Guardia extra: el insumo intermedio
// _noto-serif-jp-full.ttf (13 MB) no puede vivir en public/ (acabaría en dist/).

import { describe, it, expect } from 'vitest'
import { readFileSync, existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = join(__dirname, '..')
const CSS = readFileSync(join(ROOT, 'src', 'styles.css'), 'utf8')
const FONTS = join(ROOT, 'public', 'fonts')

const declared = [...CSS.matchAll(/url\('\/fonts\/([^']+\.woff2)'\)/g)].map((m) => m[1]!)

describe('assets de fuentes (public/fonts)', () => {
  it('styles.css declara al menos las familias esperadas', () => {
    const families = new Set(
      [...CSS.matchAll(/font-family:\s*'([^']+)';/g)].map((m) => m[1]!),
    )
    for (const f of ['Murecho', 'Cormorant Garamond', 'EB Garamond', 'Noto Serif JP', 'Teko']) {
      expect(families, `falta @font-face de ${f}`).toContain(f)
    }
    expect(families, 'Rajdhani fue retirada en A2').not.toContain('Rajdhani')
  })

  it('cada woff2 declarado en @font-face existe', () => {
    expect(declared.length).toBeGreaterThan(0)
    for (const file of declared) {
      expect(existsSync(join(FONTS, file)), `falta public/fonts/${file}`).toBe(true)
    }
  })

  it('no quedan woff2 huérfanos ni insumos intermedios en public/fonts', () => {
    const onDisk = readdirSync(FONTS)
    for (const file of onDisk) {
      expect(file.startsWith('_'), `insumo intermedio ${file} en public/ (va en raw/font/)`).toBe(false)
      if (file.endsWith('.woff2')) {
        expect(declared, `${file} sin @font-face que lo use`).toContain(file)
      }
    }
  })
})
