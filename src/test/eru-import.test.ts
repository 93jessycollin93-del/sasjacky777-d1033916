import { describe, expect, it, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  EXCLUDED_ROUTES,
  JACKIE_OWNED,
  isSkipped,
  renderRoutes,
  rewriteImports,
  routesFromApp,
} from "../../scripts/import-eru.mjs";
import { ERU_ROUTES } from "@/eru/routes.generated";

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    auth: {
      getSession: async () => ({ data: { session: null } }),
      getUser: async () => ({ data: { user: null } }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => {} } } }),
    },
  },
}));

const ERU = join(process.cwd(), "src", "eru");
const read = (rel: string) => readFileSync(join(ERU, rel), "utf8");

/**
 * The rules that let a newer Eru come in without undoing Jackie (see
 * docs/ERU_IMPORT.md). The first import was by hand; these make the second and
 * every one after it repeatable, and fail if a hand copy undoes a bridge.
 */
describe("importing a newer Eru", () => {
  it("rewrites Eru's @/ imports to where Eru lives here", () => {
    expect(rewriteImports(`import x from '@/lib/a';\nimport("@/pages/B")`)).toBe(
      `import x from '@/eru/lib/a';\nimport("@/eru/pages/B")`,
    );
    expect(rewriteImports(`const email = "me@/not-an-import"`)).toBe(`const email = "me@/not-an-import"`);
  });

  it("reads Eru's routes from its App.jsx, leaving out sign-in, the catch-all and excluded pages", () => {
    const app = `
      const Home = lazy(() => import('./pages/Home'));
      const Login = lazy(() => import('./pages/Login'));
      const JackyLive = lazy(() => import('./pages/JackyLive'));
      const TeamBuilder = lazy(() => import('./pages/TeamBuilder'));
      <Route path="/login" element={<Login />} />
      <Route path="/" element={<ProtectedRoute><Layout><Home /></Layout></ProtectedRoute>} />
      <Route path="/jacky-live" element={<JackyLive />} />
      <Route path="/team-builder" element={<Layout><TeamBuilder /></Layout>} />
      <Route path="*" element={<PageNotFound />} />`;
    expect(routesFromApp(app)).toEqual([
      { path: "", name: "Home", file: "Home" },
      { path: "team-builder", name: "TeamBuilder", file: "TeamBuilder" },
    ]);
    expect(renderRoutes(routesFromApp(app))).toContain(
      `{ path: "team-builder", name: "TeamBuilder", loader: () => import('@/eru/pages/TeamBuilder.jsx') },`,
    );
  });

  it("keeps Eru's shell, its documents and its weaker engine client out", () => {
    for (const rel of ["App.jsx", "main.jsx", "index.css", "SECURITY_AUDIT_SUMMARY.md", "security/PHASE1_CONTROL_MATRIX.json", "lib/jackyClient.ts", "lib/jackyBootstrap.js"]) {
      expect(isSkipped(rel), rel).toBe(true);
    }
    expect(isSkipped("pages/TeamBuilder.jsx")).toBe(false);
    expect(existsSync(join(ERU, "lib/jackyClient.ts"))).toBe(false);
  });
});

describe("what the import may never overwrite", () => {
  // Each bridge carries something only Jackie's version has. If a hand copy of
  // Eru's file lands on top, the marker goes and this fails — before the Eru
  // pages quietly stop signing in as the Jackie user.
  const markers: Record<string, RegExp> = {
    "api/base44Client.js": /@\/integrations\/supabase\/client/,
    "lib/AuthContext.jsx": /@\/integrations\/supabase\/client/,
    "context/LanguageContext.jsx": /@\/lib\/i18n\/service/,
    "context/ThemeContext.jsx": /Inside Jackie this provider is mounted over the Eru subtree only/,
    "lib/economyVerification.js": /getRandomValues/,
  };

  it("protects exactly the bridge files, each still Jackie's version", () => {
    expect([...JACKIE_OWNED].sort()).toEqual(Object.keys(markers).sort());
    for (const [rel, marker] of Object.entries(markers)) expect(read(rel), rel).toMatch(marker);
  });

  it("never lets Node's crypto into a file the browser loads", () => {
    expect(read("lib/economyVerification.js")).not.toMatch(/from ['"]crypto['"]/);
  });

  it("gives the newer pages the sign-in calls they make, inside the provider and out", async () => {
    const { AuthProvider, useAuth } = await import("@/eru/lib/AuthContext");
    const inside = renderHook(() => useAuth() as Record<string, unknown>, { wrapper: AuthProvider });
    const outside = renderHook(() => useAuth() as Record<string, unknown>);
    for (const auth of [inside.result.current, outside.result.current]) {
      for (const name of ["navigateToLogin", "checkAppState"]) expect(typeof auth[name], name).toBe("function");
      expect(auth).toHaveProperty("currentUser", null);
    }
  });
});

describe("the Eru routes Jackie mounts", () => {
  it("load page files that are really there", () => {
    // Read from the file on disk: the test runner rewrites import() calls, so
    // the loaders' own source no longer names the file.
    const files = [...read("routes.generated.ts").matchAll(/import\('@\/eru\/(pages\/[^']+)'\)/g)].map((m) => m[1]);
    expect(files).toHaveLength(ERU_ROUTES.length);
    for (const file of files) expect(existsSync(join(ERU, file)), file).toBe(true);
  });

  it("include the newer Eru's pages and leave out the one that shows invented telemetry", () => {
    const paths = new Set(ERU_ROUTES.map((r) => r.path));
    for (const path of ["team-builder", "bot-studio", "command", "data", "admin/secure-slice"]) {
      expect(paths.has(path), path).toBe(true);
    }
    for (const excluded of EXCLUDED_ROUTES.keys()) expect(paths.has(excluded.replace(/^\//, "")), excluded).toBe(false);
  });
});
