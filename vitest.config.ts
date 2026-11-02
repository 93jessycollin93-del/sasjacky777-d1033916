import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react-swc";
import path from "path";

// `host/serve.mjs` is an executable script and keeps its `#!` line so it can be
// run directly. Vite does not strip a shebang from a module pulled into the test
// graph, and `#` is not a valid token, so the host tests failed to parse at all.
// Rewrite the `#!` to `//` for the module graph only — same length, so line and
// column numbers in stack traces still match the file on disk, which keeps its
// shebang and stays directly executable.
const stripShebang = {
  name: "strip-shebang",
  enforce: "pre" as const,
  transform(code: string, id: string) {
    if (!id.endsWith(".mjs") || !code.startsWith("#!")) return null;
    return { code: "//" + code.slice(2), map: null };
  },
};

export default defineConfig({
  plugins: [stripShebang, react()],
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test/setup.ts"],
    include: ["src/**/*.{test,spec}.{ts,tsx}"],
  },
  resolve: {
    alias: { "@": path.resolve(__dirname, "./src") },
  },
});
