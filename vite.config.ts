import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { componentTagger } from "lovable-tagger";
import { VitePWA } from "vite-plugin-pwa";
import { mcpPlugin } from "@lovable.dev/mcp-js/stacks/supabase/vite";

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => ({
  server: {
    host: "::",
    port: 8080,
    hmr: {
      overlay: false,
    },
  },
  plugins: [
    react(),
    mcpPlugin(),
    mode === "development" && componentTagger(),
    VitePWA({
      registerType: "autoUpdate",
      injectRegister: null,
      filename: "sw.js",
      devOptions: { enabled: false },
      manifest: {
        name: "eYe Pod System",
        short_name: "eYe",
        description: "Jackie · 24-pod compression intelligence system",
        theme_color: "#0a0a0a",
        background_color: "#0a0a0a",
        display: "standalone",
        start_url: "/",
        icons: [
          { src: "/placeholder.svg", sizes: "any", type: "image/svg+xml", purpose: "any" },
        ],
      },
      workbox: {
        maximumFileSizeToCacheInBytes: 10 * 1024 * 1024,
        // The PC embed under /pc-os/ is a complete build with its own service
        // worker, which precaches its own shell and route chunks from its own
        // .vite/manifest.json. Precaching it again here would duplicate ~26 MB
        // into Jackie's precache manifest and force a full re-download on every
        // PC rebuild — and it hard-fails the build outright, because the
        // on-device AI wasm is 21.6 MB against workbox's per-file limit.
        // Runtime caching below still picks these up on demand.
        // models/** is the guidance model shipped with the app: one 248 MB GGUF.
        // Workbox's per-file limit fails the build on it outright, the same way
        // the PC's 21.6 MB wasm does, and precaching a quarter of a gigabyte
        // nobody reads over HTTP would be wrong even if it fit — Ollama builds
        // the model from the file once and answers from its own copy after that.
        // The on-device inference runtime is 8.4 MB of WebAssembly. It fits
        // under the per-file limit above, which is exactly the problem: it was
        // therefore precached, and every visitor to every route downloaded it
        // on first load whether or not they ever asked the device engine a
        // question. The whole rung is built to cost nothing until it answers
        // (`src/lib/microai/deviceEngine.ts` loads the library by dynamic
        // import for the same reason), and a precache entry undid that
        // silently. Runtime caching below still keeps it offline-capable, from
        // the first time it is actually used.
        // assets/src/** holds the raw source text GitHub Sync compares
        // against, one chunk per file. It is read on demand by one page;
        // precaching it cost every visitor ~20 MB on first load.
        globIgnores: ["**/pc-os/**", "**/models/**", "**/*.wasm", "**/assets/src/**"],
        navigateFallback: "/index.html",
        // /pc-os/index.html is a real navigation when the PC is opened in its
        // own tab. Without this it would fall back to Jackie's shell offline,
        // so the PC could not start standalone.
        navigateFallbackDenylist: [/^\/~oauth/, /^\/api/, /^\/functions/, /^\/pc-os\//],
        runtimeCaching: [
          {
            urlPattern: ({ request }) => request.mode === "navigate",
            handler: "NetworkFirst",
            options: { cacheName: "eye-html", networkTimeoutSeconds: 4 },
          },
          {
            urlPattern: ({ url, sameOrigin }) =>
              sameOrigin && /\.(?:js|css|woff2?|ttf|otf|png|jpg|jpeg|svg|webp|gif|ico)$/.test(url.pathname),
            handler: "CacheFirst",
            options: {
              cacheName: "eye-assets",
              expiration: { maxEntries: 300, maxAgeSeconds: 60 * 60 * 24 * 30 },
            },
          },
          {
            // Kept out of the precache above, cached here the moment it is
            // really used — so the second question on the device rung, and
            // every question after it, works with the radio off. Its own cache
            // name and a count of one: a stale runtime should be replaced, not
            // accumulated alongside the new one.
            urlPattern: ({ url, sameOrigin }) => sameOrigin && url.pathname.endsWith(".wasm"),
            handler: "CacheFirst",
            options: {
              cacheName: "eye-wasm",
              expiration: { maxEntries: 2, maxAgeSeconds: 60 * 60 * 24 * 90 },
            },
          },
        ],
      },
    }),
  ].filter(Boolean),
  build: {
    rollupOptions: {
      output: {
        // Raw source imports (`?raw`, only GitHub Sync uses them) get their own
        // directory so the service worker can leave them out by path.
        chunkFileNames: (chunk) =>
          chunk.facadeModuleId?.endsWith("?raw") ? "assets/src/[name]-[hash].js" : "assets/[name]-[hash].js",
      },
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
}));
