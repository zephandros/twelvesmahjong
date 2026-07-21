import { defineConfig } from 'vitest/config'
import { VitePWA } from 'vite-plugin-pwa'

// Base '' keeps asset URLs relative, so the build works under any GitHub Pages subpath.
export default defineConfig({
  base: '',
  plugins: [
    VitePWA({
      registerType: 'autoUpdate',
      manifest: {
        id: './',
        name: 'Mahjong Twelves',
        short_name: 'Twelves',
        description:
          'Riichi mahjong japonés para un jugador: tonpuusen, aka dora, yaku y fu completos, ' +
          'rivales con IA y los 12 personajes de Twelves. Gratis y jugable sin conexión.',
        lang: 'es',
        dir: 'ltr',
        categories: ['games', 'entertainment'],
        theme_color: '#0a0805',
        background_color: '#0a0805',
        display: 'standalone',
        orientation: 'landscape',
        // Mismos nombres de archivo que los iconos marcador que sustituyen (los
        // hornea scripts/bake-logo.ps1): las instalaciones ya existentes cogen
        // el logo nuevo al actualizarse el service worker.
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          {
            src: 'icons/icon-maskable-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      workbox: {
        // Precache lo ligero que la app necesita 100% offline tras la primera
        // carga: código, fuentes, fichas SVG, retratos, y el audio pequeño
        // (sfx ~50 KB y voces ~50 KB c/u). La MÚSICA (31 temas, ~130 MB) NO se
        // precachea: se cachea bajo demanda (runtimeCaching, abajo).
        globPatterns: [
          '**/*.{js,css,html,woff2,svg,png,webp,jpg}',
          'sfx/**/*.m4a',
          'voices/**/*.m4a',
        ],
        // La imagen social (og/cover.jpg) solo la piden los rastreadores, y la
        // 404 nunca la ve un usuario con el SW instalado (navigateFallback
        // sirve index.html): ninguna de las dos pinta nada offline.
        globIgnores: ['og/**', '404.html'],
        runtimeCaching: [
          {
            // Música: CacheFirst con rangeRequests (HTMLAudioElement pide rangos).
            // Offline funciona salvo la música aún no escuchada (asumido).
            urlPattern: /\/music\/[^/]+\.m4a$/,
            handler: 'CacheFirst',
            options: {
              cacheName: 'tm-music',
              rangeRequests: true,
              // Con holgura sobre el nº de temas del catálogo: si maxEntries se
              // queda corto, el LRU desaloja temas ya escuchados y se pierde el
              // offline. Subirlo al ampliar el catálogo.
              expiration: { maxEntries: 48 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
        ],
      },
    }),
  ],
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
})
