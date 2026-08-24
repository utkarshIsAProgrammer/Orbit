import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

/**
 * The 3D world is desktop-only and lazy-loaded (React.lazy), but Vite's
 * manualChunks for three emits a <link rel="modulepreload"> in the HTML
 * which makes ALL browsers — including phones — download the ~1MB three
 * chunk eagerly. This strips that preload link so mobile/tablet visitors
 * never fetch the 3D code; desktop still gets it via the dynamic import
 * the moment the canvas mounts.
 */
function stripThreePreload(): Plugin {
  return {
    name: "strip-three-preload",
    transformIndexHtml(html) {
      return html.replace(
        /<link rel="modulepreload"[^>]*href="[^"]*three[^"]*"[^>]*>/g,
        "",
      );
    },
  };
}

// ORBIT landing page — standalone Vite app (React 19 + Tailwind v4 + R3F/three)
export default defineConfig({
  plugins: [react(), tailwindcss(), stripThreePreload()],
  server: {
    port: 5174,
    open: false,
    // Dev proxy: the waitlist form posts to same-origin `/api`, which is
    // forwarded to the local ORBIT backend (see src/config.ts).
    proxy: {
      "/api": {
        target: "http://localhost:5006",
        changeOrigin: true,
      },
    },
  },
  build: {
    target: "es2022",
    chunkSizeWarningLimit: 1600,
    // NO manualChunks: React must stay in the main graph, and three/fiber
    // must only ever live in the lazily-imported WorldCanvas chunk. A
    // manual `three` chunk would hoist React into it (fiber imports React),
    // making the entry statically import the 1MB three bundle on ALL
    // devices. Vite's automatic code-splitting for the dynamic import
    // handles this perfectly: main = React + app, async = three + fiber.
  },
});
