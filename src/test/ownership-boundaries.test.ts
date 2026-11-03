import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import * as paymentGuards from "@/eru/lib/paymentGuards";

describe("privileged code acts only on the caller's own records", () => {
  it("pins every agent-cycle write to the signed-in account, and checks ownership before spending quota", () => {
    const src = readFileSync("supabase/functions/gunit-agent-cycle/index.ts", "utf8");
    const updates = [...src.matchAll(/from\("gunit_agents"\)[\s\S]*?\.update\([\s\S]*?;/g)].map((m) => m[0]);
    expect(updates.length).toBeGreaterThan(0);
    for (const u of updates) expect(u).toMatch(/\.eq\("user_id", userId\)/);
    expect(src.indexOf('.eq("user_id", user.id).maybeSingle()')).toBeLessThan(src.indexOf("consumeQuota("));
  });
});

describe("a browser cannot confirm its own payment", () => {
  it("offers no client-side way to mark a transaction verified", () => {
    expect("verifyTransaction" in paymentGuards).toBe(false);
  });

  it("settles Bazar wallet orders on the server, not in the page", () => {
    const page = readFileSync("src/eru/pages/BazarStand.jsx", "utf8");
    expect(page).not.toMatch(/status:\s*'verified'/);
    expect(page).not.toMatch(/updateMe\(\{\s*gold/);
  });
});
