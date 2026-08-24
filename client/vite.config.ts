import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { sentryVitePlugin } from "@sentry/vite-plugin";
import { visualizer } from "rollup-plugin-visualizer";
import { VitePWA } from 'vite-plugin-pwa';
import path from 'path';
import { defineConfig } from 'vite';

const isProd = process.env.NODE_ENV === 'production';

export default defineConfig(() => {
  return {
    plugins: [
      react(),
      tailwindcss(),
      sentryVitePlugin({
        org: process.env.SENTRY_ORG || "orbit-app",
        project: process.env.SENTRY_PROJECT || "orbit-frontend",
        authToken: process.env.SENTRY_AUTH_TOKEN,
        disable: !process.env.SENTRY_AUTH_TOKEN,
        sourcemaps: {
          assets: "./dist/assets/**",
        },
      }),
      // PWA — custom service worker (src/sw.js) that handles web-push
      // notifications AND workbox runtime caching for offline support.
      VitePWA({
        registerType: 'autoUpdate',
        // injectManifest builds our custom SW so the push/notificationclick
        // handlers survive the build (generateSW would produce a caching-only
        // worker with NO push support — the root cause of missing device
        // notifications).
        strategies: 'injectManifest',
        srcDir: 'src',
        filename: 'sw.js',
        // Registration is hand-rolled in main.tsx (updateViaCache: 'none') +
        // public/registerSW.js (for browsers still holding a cached index.html
        // that references the old generated file). The plugin's generated
        // registerSW.js omitted updateViaCache, letting browsers serve a stale
        // /sw.js from the HTTP cache for up to 24h — the classic stale-app trap.
        injectRegister: false,
        // Enable the service worker in DEV too. Without this the push-capable
        // worker is never registered during local development, so on-device
        // notifications silently never arrive (injectRegister only injects the
        // registration script into production builds).
        devOptions: {
          enabled: true,
          type: 'module',
        },
        includeAssets: ['favicon.svg', 'icon-192.png', 'icon-512.png'],
        manifest: {
          name: 'ORBIT — Your Inner Circle',
          short_name: 'ORBIT',
          description: 'A modern social platform for your inner circle — share posts, chat in real-time, and stay connected.',
          theme_color: '#09090b',
          background_color: '#09090b',
          display: 'standalone',
          orientation: 'portrait-primary',
          icons: [
            { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
            { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
            { src: '/favicon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any maskable' },
          ],
        },
        injectManifest: {
          globPatterns: ['**/*.{js,css,html,ico,png,svg,woff,woff2}'],
        },
      }),
      // Visualize bundle composition (run with ANALYZE=true to open report)
      ...(process.env.ANALYZE === 'true' ? [visualizer({
        filename: 'dist/stats.html',
        open: true,
        gzipSize: true,
        brotliSize: true,
      })] : []),
    ],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    build: {
      // Generate sourcemaps only in development (or when explicitly opted in)
      sourcemap: !isProd || process.env.GENERATE_SOURCEMAPS === 'true',
      rollupOptions: {
        output: {
          manualChunks: {
            // React ecosystem only. Do NOT add UI libs here (lucide-react,
            // react-easy-crop, motion/react...): a manual chunk that names a
            // package pulls only its ENTRY module into the chunk while the
            // package's transitive deps land in consumer chunks, producing
            // inter-chunk import cycles. At runtime those cycles break
            // namespace imports — we've hit three of these crashes:
            //   - icons chunk:   "can't access property 'forwardRef' of undefined"
            //   - cropper chunk: "can't access property 'Component' of undefined"
            //   - vendor chunk:  "Cannot set properties of undefined (setting 'Activity')"
            //     (motion/react's deps landed in the feed chunk, and vendor
            //      imported them back — a vendor↔feed cycle)
            vendor: ['react', 'react-dom', 'react-dom/client'],
            socket: ['socket.io-client'],
            gsap: ['gsap'],
            // react-easy-crop is NOT split into its own chunk — same crash as
            // lucide: the forced split rewrote its `import * as React` into a
            // broken named import, so opening the crop modal threw "can't
            // access property 'Component' of undefined". Bundled tree-shaken
            // into the consumer chunk instead.
            // dexie (~95 KB) was bundled inside the Feed chunk — every Feed.tsx
            // change re-served it. Split it so offline-DB code is cached once.
            dexie: ['dexie'],
            chat: ['./src/components/Chat.tsx'],
            feed: ['./src/components/Feed.tsx'],
            profile: ['./src/components/Profile.tsx'],
            leftnav: ['./src/components/LeftSidebar.tsx'],
            // lucide-react is deliberately NOT split into its own chunk: the
            // forced split broke its namespace import of React (same crash
            // above). Bundling it tree-shaken into the consumer chunks is
            // safe and only costs a few KB of duplication.
          },
        },
      },
      chunkSizeWarningLimit: 600,
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modify—file watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      // Disable file watching when DISABLE_HMR is true to save CPU during agent edits.
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
      proxy: {
        '/api': {
          target: 'http://localhost:5006',
          changeOrigin: true,
          configure: (proxy) => {
            proxy.on('proxyReq', (proxyReq) => {
              proxyReq.setHeader('Origin', 'http://localhost:5006');
            });
          },
        },
        '/socket.io': {
          target: 'ws://localhost:5006',
          ws: true,
          changeOrigin: true,
        },
      },
    },
  };
});
