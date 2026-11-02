import { defineConfig, loadEnv, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';
import path from 'node:path';
import { notifyDevMiddleware } from './server/notifications/dev-middleware';

function localNotifyApiPlugin(): Plugin {
  return {
    name: 'cynex-notify-api',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        void notifyDevMiddleware(request, response, next);
      });
    },
  };
}

export default defineConfig(({ mode }) => {
  // Server-only keys are placed in process.env for the local /api/notify
  // adapter. Only VITE_* variables are exposed to the browser by Vite.
  const env = loadEnv(mode, import.meta.dirname, '');
  for (const key of [
    'RESEND_API_KEY',
    'RESEND_FROM_EMAIL',
    'NOTIFY_FROM_EMAIL',
    'RESEND_REPLY_TO',
    'NOTIFY_API_SECRET',
  ]) {
    if (!process.env[key] && env[key]) process.env[key] = env[key];
  }

  return {
    plugins: [
      react(),
      tailwindcss(),
      localNotifyApiPlugin(),
      VitePWA({
        registerType: 'prompt',
        includeAssets: ['icon-192.png', 'icon-512.png', 'apple-touch-icon.png', 'favicon.svg'],
        manifest: {
          name: 'JEGZ Mobile Repair POS',
          short_name: 'JEGZ POS',
          description: 'Offline-first mobile repair point of sale system',
          display: 'standalone',
          start_url: '/',
          scope: '/',
          theme_color: '#FF3C00',
          background_color: '#ffffff',
          icons: [
            { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
            { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
            { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
            { src: 'favicon.svg', sizes: 'any', type: 'image/svg+xml' },
          ],
          categories: ['business', 'shopping', 'productivity'],
        },
        workbox: {
          navigateFallback: '/index.html',
          globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2}'],
        },
      }),
    ],
    resolve: {
      alias: {
        '@': path.resolve(import.meta.dirname, 'src'),
        '@assets': path.resolve(import.meta.dirname, '..', '..', 'attached_assets'),
      },
      dedupe: ['react', 'react-dom'],
    },
    root: path.resolve(import.meta.dirname),
    build: { outDir: path.resolve(import.meta.dirname, 'dist/public'), emptyOutDir: true },
    server: { port: 5173, strictPort: true, host: '0.0.0.0' },
  };
});
