import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';
import path from 'node:path';

export default defineConfig({
  plugins: [
    react(), tailwindcss(),
    VitePWA({
      registerType: 'prompt',
      includeAssets: ['favicon.ico', 'favicon.svg', 'favicon-16.png', 'favicon-32.png', 'apple-touch-icon.png', 'icon-192.png', 'icon-512.png', 'icon-maskable-512.png'],
      manifest: {
        name: 'FixMo PH', short_name: 'FixMo PH',
        description: 'Offline-first mobile repair point of sale system',
        display: 'standalone', start_url: '/', scope: '/', theme_color: '#FD7401', background_color: '#ffffff',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: 'icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
          { src: 'favicon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' }
        ],
        categories: ['business', 'shopping', 'productivity']
      },
      workbox: { navigateFallback: '/index.html', globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2}'] }
    })
  ],
  resolve: { alias: { '@': path.resolve(import.meta.dirname, 'src'), '@assets': path.resolve(import.meta.dirname, '..','..','attached_assets') }, dedupe: ['react','react-dom'] },
  root: path.resolve(import.meta.dirname),
  build: { outDir: path.resolve(import.meta.dirname,'dist/public'), emptyOutDir: true },
  server: { port: 5173, strictPort: true, host: '0.0.0.0' }
});
