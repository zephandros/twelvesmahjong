// Compila los iconos SVG de raw/icons/ (set Lucide: 24×24, stroke=currentColor)
// a src/ui/icons.generated.ts, commiteado (raw/ está fuera del repo). Se
// inyectan inline vía innerHTML: currentColor hereda el color del botón y no
// hay fetch en runtime ni entradas nuevas en el precache.
// Normalización: svgo + sin width/height (el tamaño lo pone el CSS) ni class.
// Añadir un icono = soltar el SVG en raw/icons/ y relanzar `npm run assets:icons`.

import { readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { optimize } from 'svgo'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const srcDir = join(root, 'raw', 'icons')
const outFile = join(root, 'src', 'ui', 'icons.generated.ts')

const files = readdirSync(srcDir).filter((f) => f.endsWith('.svg')).sort()
if (files.length === 0) {
  console.error(`sin SVGs en ${srcDir}`)
  process.exit(1)
}

const entries = files.map((file) => {
  const name = file.replace(/\.svg$/, '')
  const raw = readFileSync(join(srcDir, file), 'utf8')
  // svgo v4 conserva el viewBox por defecto (removeViewBox ya no está en el preset).
  // OJO: width/height solo del <svg> raíz — los <rect> internos (p. ej. pause)
  // los necesitan (patrón elem:attr de removeAttrs).
  const { data } = optimize(raw, {
    multipass: true,
    plugins: [
      'preset-default',
      { name: 'removeAttrs', params: { attrs: ['svg:width', 'svg:height', 'class'] } },
    ],
  })
  if (!data.includes('currentColor')) {
    console.error(`${file}: sin currentColor — el icono no heredaría el color del botón`)
    process.exit(1)
  }
  console.log(`${name.padEnd(16)} ${data.length} B`)
  return [name, data]
})

const body = entries
  .map(([name, svg]) => `  '${name}': ${JSON.stringify(svg)},`)
  .join('\n')

writeFileSync(
  outFile,
  `// GENERADO por scripts/build-icons.mjs a partir de raw/icons/ — NO EDITAR A MANO.\n` +
    `// Regenerar: npm run assets:icons\n\n` +
    `export const ICONS = {\n${body}\n} as const\n\n` +
    `export type IconName = keyof typeof ICONS\n`,
)
console.log(`OK: ${entries.length} iconos → src/ui/icons.generated.ts`)
