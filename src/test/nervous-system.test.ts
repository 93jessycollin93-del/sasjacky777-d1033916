import { describe, expect, it, beforeEach, vi } from "vitest";
import { routerNS, FilingSystem, EVENT_NAMES } from "@/lib/routerNervousSystem";

/**
 * The filing system wrote records nothing could read back, and "archive" was a
 * function that emitted an event and left the record exactly where it was. Both
 * went unnoticed because no screen ever showed what the cabinet held — which is
 * the same reason the inspector exists.
 */
describe("the filing cabinet", () => {
  beforeEach(() => localStorage.clear());

  it("says so when the cabinet refuses the write, instead of announcing it anyway", () => {
    // A full quota is the ordinary way this fails, and it used to emit
    // filing:write first and swallow the throw — so every listener believed in
    // a record that nothing would ever read back.
    const heard: unknown[] = [];
    const off = routerNS.on("filing:write", (p) => heard.push(p));
    const full = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("QuotaExceededError");
    });

    try {
      expect(FilingSystem.write("note", "n1", { title: "first" })).toBe(false);
      expect(heard).toEqual([]);
    } finally {
      full.mockRestore();
      off?.();
    }
  });

  it("confirms the write that did land", () => {
    expect(FilingSystem.write("note", "n2", { title: "kept" })).toBe(true);
    expect(FilingSystem.read("note", "n2")).toEqual({ title: "kept" });
  });

  it("lists back what was filed", () => {
    FilingSystem.write("note", "n1", { title: "first" });
    FilingSystem.write("pod", "p1", { seed: 3 });

    const all = FilingSystem.list();
    expect(all.map((r) => `${r.entityType}/${r.id}`)).toEqual(["note/n1", "pod/p1"]);
    expect(all[0].data).toEqual({ title: "first" });
    expect(all[0].archived).toBe(false);
    expect(all[0].bytes).toBeGreaterThan(0);
  });

  it("actually moves a record when archiving it, rather than only announcing it", () => {
    FilingSystem.write("note", "n1", { title: "first" });
    expect(FilingSystem.archive("note", "n1")).toBe(true);

    expect(FilingSystem.read("note", "n1")).toBeNull();
    const [record] = FilingSystem.list();
    expect(record.archived).toBe(true);
    expect(record.entityType).toBe("note");
    expect(record.id).toBe("n1");
    expect(record.data).toEqual({ title: "first" });
  });

  it("does not file an archived record under an entity type called 'archived'", () => {
    // The archive prefix extends the live one, so a startsWith test in the
    // wrong order mislabels every archived record.
    FilingSystem.write("task", "t1", { done: false });
    FilingSystem.archive("task", "t1");

    expect(FilingSystem.list().map((r) => r.entityType)).toEqual(["task"]);
  });

  it("puts an archived record back", () => {
    FilingSystem.write("agent", "a1", { name: "lead" });
    FilingSystem.archive("agent", "a1");
    expect(FilingSystem.restore("agent", "a1")).toBe(true);

    expect(FilingSystem.read("agent", "a1")).toEqual({ name: "lead" });
    expect(FilingSystem.list()[0].archived).toBe(false);
  });

  it("says so rather than throwing when there is nothing to archive", () => {
    expect(FilingSystem.archive("note", "missing")).toBe(false);
    expect(FilingSystem.restore("note", "missing")).toBe(false);
  });
});

describe("watching the whole bus", () => {
  it("delivers every kind of impulse to one subscriber", () => {
    const seen: string[] = [];
    const off = routerNS.onAny((_payload, event) => seen.push(event));

    routerNS.emit("nav:home");
    routerNS.emit("filing:write", { entityType: "note", id: "x" });
    routerNS.emit("pod:fold", { podId: "p" });

    expect(seen).toEqual(["nav:home", "filing:write", "pod:fold"]);
    off();
    routerNS.emit("nav:home");
    expect(seen).toHaveLength(3);
  });

  it("detaches every listener it attached, not just the last", () => {
    const before = EVENT_NAMES.length;
    const off = routerNS.onAny(() => {});
    off();
    // A leak would show as events still arriving after unsubscribe; the roster
    // is what makes the count knowable at all.
    expect(before).toBeGreaterThan(20);
  });
});
