/**
 * The solo CollinSurvivalCraft build: only the game, from the same src/craft
 * the SAS-JACKY app mounts at /craft, with no Supabase, no router and no app
 * shell. `@/` still means the repo's src/, so the game's imports are unchanged.
 *
 *   npm run csc:build    → csc/dist/         (the desktop app and any web server load this)
 *   npm run csc:single   → csc/dist-single/  (one .html that opens from disk, offline)
 *   npm run csc:dev      → http://localhost:8090
 *
 * Tailwind is configured here, not from the app's tailwind.config.ts, so the
 * solo copy carries only the utilities the game's UI uses.
 */
import path from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import tailwindcss from "tailwindcss";
import autoprefixer from "autoprefixer";
import { viteSingleFile } from "vite-plugin-singlefile";

export default defineConfig(({ mode }) => {
  const single = mode === "single";
  return {
    root: __dirname,
    // Relative, so the build works from file://, from the desktop app's protocol, and from any sub-path.
    base: "./",
    // The app's .env (Supabase keys) is not the solo copy's business.
    envDir: __dirname,
    plugins: [react(), ...(single ? [viteSingleFile({ removeViteModuleLoader: true })] : [])],
    resolve: {
      alias: { "@": path.resolve(__dirname, "../src") },
    },
    css: {
      postcss: {
        plugins: [
          tailwindcss({
            content: [path.join(__dirname, "index.html"), path.join(__dirname, "src/**/*.{ts,tsx}"), path.join(__dirname, "../src/craft/**/*.{ts,tsx}")],
            theme: { extend: {} },
            plugins: [],
          }),
          autoprefixer(),
        ],
      },
    },
    // Chromium will not start a *module* worker from a blob on a file:// page (it fails
    // silently, after the fact), but it will start a classic one — so the single file
    // inlines its chunk worker as a classic script.
    worker: { format: single ? "iife" : "es" },
    build: {
      outDir: single ? "dist-single" : "dist",
      emptyOutDir: true,
      target: "es2020",
      // three.js and the engine are one game; splitting them buys nothing offline.
      chunkSizeWarningLimit: 4096,
    },
    server: { port: 8090, host: "127.0.0.1" },
    preview: { port: 8091, host: "127.0.0.1" },
  };
});
