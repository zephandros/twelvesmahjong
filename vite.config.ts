import { defineConfig } from 'vitest/config'
import { VitePWA } from 'vite-plugin-pwa'

// Base '' keeps asset URLs relative, so the build works under any GitHub Pages subpath.
export default defineConfig({
  base: '',
  plugins: [
    VitePWA({
      registerType: 'autoUpdate',
      manifest: {
        name: 'RIICHI · 咲',
        short_name: 'Riichi',
        description: 'Single-player offline riichi mahjong',
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
        // Precache TODO lo que la app sirve: la partida debe funcionar 100%
        // offline tras la primera carga (jpg = retratos, woff2 = fuentes).
        globPatterns: ['**/*.{js,css,html,woff2,svg,png,webp,jpg}'],
      },
    }),
  ],
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
})
