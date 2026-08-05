import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      // Atualização entra sozinha no próximo carregamento. Sem Play Store,
      // é isso que substitui a publicação de versão do app 1.x.
      registerType: 'autoUpdate',
      includeAssets: ['icons/*.png'],
      manifest: {
        name: 'Themis - Contagem de Estoque',
        short_name: 'Themis',
        description: 'Contagem e auditoria de estoque do Grupo Ice Beer',
        lang: 'pt-BR',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        orientation: 'portrait',
        background_color: '#0f172a',
        theme_color: '#0f172a',
        icons: [
          { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          {
            src: '/icons/icon-512-maskable.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
        // Relatório (jspdf, exceljs, html2canvas) é ~1,5 MB e só interessa a quem exporta.
        // Fora do precache, entram em cache no primeiro uso — o funcionário que só conta
        // não baixa nada disso na instalação.
        globIgnores: ['**/{jspdf,exceljs,html2canvas,purify,index.es}*.js'],
        // O SDK do Firestore tem persistência própria (IndexedDB). Se o service worker
        // também cachear essas chamadas, os dois mecanismos brigam e o app serve dado
        // velho achando que está fresco. O tráfego do Firebase passa direto.
        navigateFallback: 'index.html',
        navigateFallbackDenylist: [/^\/api\//],
        runtimeCaching: [
          {
            urlPattern: ({ url }) =>
              url.hostname.endsWith('googleapis.com') || url.hostname.endsWith('firebaseio.com'),
            handler: 'NetworkOnly',
          },
          {
            urlPattern: ({ url }) => url.pathname.startsWith('/api/'),
            handler: 'NetworkOnly',
          },
          {
            // Chunks com hash no nome nunca mudam de conteúdo: CacheFirst é seguro e
            // deixa a exportação funcionar offline depois do primeiro uso.
            urlPattern: ({ url, sameOrigin }) => sameOrigin && url.pathname.startsWith('/assets/'),
            handler: 'CacheFirst',
            options: {
              cacheName: 'chunks-sob-demanda',
              expiration: { maxEntries: 40, maxAgeSeconds: 60 * 60 * 24 * 60 },
            },
          },
        ],
      },
      devOptions: {
        enabled: false,
      },
    }),
  ],
  server: {
    port: 5173,
    proxy: {
      // Em desenvolvimento o front fala com a API local sem CORS.
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
  },
});
