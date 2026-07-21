// Ata los metadatos de index.html a los archivos que referencian y al dominio
// publicado. Tres cosas que se rompen solas y en silencio:
//   - un icono o la imagen social que se renombra en el pipeline y deja un 404
//     que solo se ve en la pestaña del navegador o en la tarjeta de WhatsApp;
//   - el origen canónico repetido en cuatro sitios (canonical, og, robots,
//     sitemap) que se actualiza en unos y no en otros;
//   - og/cover.jpg colándose en el precache de la PWA (nadie la ve offline).

import { describe, it, expect } from 'vitest'
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = join(__dirname, '..')
const PUBLIC = join(ROOT, 'public')
const HTML = readFileSync(join(ROOT, 'index.html'), 'utf8')
const ROBOTS = readFileSync(join(PUBLIC, 'robots.txt'), 'utf8')
const SITEMAP = readFileSync(join(PUBLIC, 'sitemap.xml'), 'utf8')
const VITE = readFileSync(join(ROOT, 'vite.config.ts'), 'utf8')

/** Origen canónico del sitio. Cambiarlo aquí obliga a cambiarlo en los 4 sitios. */
const ORIGIN = 'https://twelvesmahjong.com'

/** Contenido de un <meta name|property>; `\s+` cubre las etiquetas multilínea. */
const metaOf = (name: string): string | undefined =>
  HTML.match(new RegExp(`<meta\\s+(?:name|property)="${name}"\\s+content="([^"]*)"`))?.[1]

describe('metadatos SEO (index.html)', () => {
  it('tiene title, description y canonical', () => {
    const title = HTML.match(/<title>([^<]+)<\/title>/)?.[1]
    expect(title?.trim(), 'falta <title>').toBeTruthy()
    expect(title!.length, 'title demasiado largo para el SERP').toBeLessThanOrEqual(70)

    const desc = metaOf('description')
    expect(desc, 'falta meta description').toBeTruthy()
    // Google recorta el snippet en torno a los 160 caracteres.
    expect(desc!.length, `description de ${desc!.length} caracteres`).toBeLessThanOrEqual(160)

    expect(HTML).toContain(`<link rel="canonical" href="${ORIGIN}/" />`)
  })

  it('la tarjeta social está completa y con URLs absolutas', () => {
    for (const p of ['og:type', 'og:site_name', 'og:title', 'og:description', 'og:url']) {
      expect(metaOf(p), `falta ${p}`).toBeTruthy()
    }
    expect(metaOf('twitter:card')).toBe('summary_large_image')
    for (const p of ['og:image', 'twitter:image']) {
      const url = metaOf(p)
      expect(url, `falta ${p}`).toBeTruthy()
      // Los rastreadores sociales no resuelven rutas relativas.
      expect(url!.startsWith(`${ORIGIN}/`), `${p} debe ser absoluta: ${url}`).toBe(true)
      const file = url!.slice(`${ORIGIN}/`.length)
      expect(existsSync(join(PUBLIC, file)), `falta public/${file}`).toBe(true)
    }
    expect(metaOf('og:image:width')).toBe('1200')
    expect(metaOf('og:image:height')).toBe('630')
  })

  it('el JSON-LD es JSON válido y describe el juego', () => {
    const raw = HTML.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)?.[1]
    expect(raw, 'falta el bloque application/ld+json').toBeTruthy()
    const data = JSON.parse(raw!) as Record<string, unknown>
    expect(data['@type']).toBe('VideoGame')
    expect(data['url']).toBe(`${ORIGIN}/`)
    expect(data['image']).toBe(`${ORIGIN}/og/cover.jpg`)
    // Inventar valoraciones que no existen es motivo de penalización.
    expect(data).not.toHaveProperty('aggregateRating')
  })

  it('todo asset local que referencia existe en public/', () => {
    const refs = [...HTML.matchAll(/(?:href|src)="\.\/([^"]+)"/g)].map((m) => m[1]!)
    expect(refs.length, 'index.html no referencia ningún asset').toBeGreaterThan(0)
    for (const ref of refs) {
      expect(existsSync(join(PUBLIC, ref)), `falta public/${ref}`).toBe(true)
    }
  })

  it('el bloque rastreable .tm-boot trae texto en los tres idiomas', () => {
    expect(HTML, 'falta el bloque .tm-boot (el HTML servido no tendría texto)').toContain(
      'class="tm-boot"',
    )
    expect(HTML).toMatch(/<h1>/)
    for (const lang of ['en', 'ja']) {
      expect(HTML, `falta el párrafo lang="${lang}"`).toContain(`<p lang="${lang}">`)
    }
    expect(HTML).toContain('<noscript>')
  })
})

describe('robots.txt y sitemap.xml', () => {
  it('robots.txt permite el rastreo y apunta al sitemap', () => {
    expect(ROBOTS).toMatch(/^User-agent: \*$/m)
    expect(ROBOTS).toMatch(/^Allow: \/$/m)
    expect(ROBOTS).toContain(`Sitemap: ${ORIGIN}/sitemap.xml`)
    // Las páginas de depuración no son contenido.
    expect(ROBOTS).toMatch(/^Disallow: \/\*\?debug=$/m)
  })

  it('sitemap.xml declara la portada con un lastmod válido', () => {
    expect(SITEMAP).toContain(`<loc>${ORIGIN}/</loc>`)
    const lastmod = SITEMAP.match(/<lastmod>([^<]+)<\/lastmod>/)?.[1]
    expect(lastmod, 'falta <lastmod>').toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(Number.isNaN(Date.parse(lastmod!)), `lastmod inválido: ${lastmod}`).toBe(false)
  })

  it('nadie apunta al host www (no tiene registro DNS)', () => {
    for (const [name, text] of [['index.html', HTML], ['robots.txt', ROBOTS], ['sitemap.xml', SITEMAP]] as const) {
      expect(text.includes('www.twelvesmahjong.com'), `${name} apunta a www, que no resuelve`).toBe(false)
    }
  })
})

describe('manifest PWA (vite.config.ts)', () => {
  const manifestIcons = [...VITE.matchAll(/src: '(icons\/[^']+)'/g)].map((m) => m[1]!)

  it('cada icono del manifest existe en public/', () => {
    expect(manifestIcons.length, 'el manifest no declara iconos').toBeGreaterThanOrEqual(3)
    for (const icon of manifestIcons) {
      expect(existsSync(join(PUBLIC, icon)), `falta public/${icon}`).toBe(true)
    }
  })

  it('hay un icono maskable (Android recorta los que no lo son)', () => {
    expect(VITE).toContain("purpose: 'maskable'")
  })

  it('la imagen social y la 404 quedan fuera del precache', () => {
    const ignores = VITE.match(/globIgnores: \[([^\]]*)\]/)?.[1]
    expect(ignores, 'falta globIgnores').toBeTruthy()
    expect(ignores).toContain("'og/**'")
    expect(ignores).toContain("'404.html'")
  })
})
