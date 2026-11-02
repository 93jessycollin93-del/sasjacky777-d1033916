import { describe, expect, it, vi } from "vitest";

vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));

import { sortByPriority } from "@/lib/jackie-tasks";

describe("the order the chat lists tasks in", () => {
  it("puts medium above low, which sorting the priority text did not", () => {
    // Ordering by the column's text gave critical, high, low, medium — so the
    // fifteen tasks Jackie sees in every chat could include low work and drop
    // medium work.
    const sorted = sortByPriority([
      { id: "low", priority: "low" as const },
      { id: "medium", priority: "medium" as const },
      { id: "high", priority: "high" as const },
      { id: "critical", priority: "critical" as const },
    ]);
    expect(sorted.map((t) => t.id)).toEqual(["critical", "high", "medium", "low"]);
  });

  it("keeps the newest-first order the database returned within one priority", () => {
    const sorted = sortByPriority([
      { id: "newer", priority: "high" as const },
      { id: "low", priority: "low" as const },
      { id: "older", priority: "high" as const },
    ]);
    expect(sorted.map((t) => t.id)).toEqual(["newer", "older", "low"]);
  });
});
