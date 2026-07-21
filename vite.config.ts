import { defineConfig } from 'vitest/config'
import { VitePWA } from 'vite-plugin-pwa'

// Base '' keeps asset URLs relative, so the build works under any GitHub Pages subpath.
export default defineConfig({
  base: '',
  plugins: [
    VitePWA({
      registerType: 'autoUpdate',
      manifest: {
        name: 'Mahjong Twelves',
        short_name: 'Mahjong',
        description: 'Mahjong Twelves — single-player offline riichi mahjong',
        theme_color: '#0c0f0d',
        background_color: '#0c0f0d',
        display: 'standalone',
        orientation: 'landscape',
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
