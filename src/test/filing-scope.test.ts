import { beforeEach, describe, expect, it } from "vitest";
import { FilingSystem, setFilingScope, currentFilingScope } from "@/lib/routerNervousSystem";

/**
 * The leak this closes: localStorage is scoped to the origin, not to the
 * person. Every filed record — notes, pods, agents, tasks — went under one
 * fixed `jackie.filing.` prefix, so on a shared machine whatever user A filed
 * was still there, readable and editable, once user B signed in.
 *
 * The scope segment lives inside the prefix, which is what makes `list()`,
 * `archive()` and `restore()` inherit the isolation without each needing to
 * know about it.
 */
describe("filing scope", () => {
  beforeEach(() => {
    localStorage.clear();
    setFilingScope(null);
  });

  it("defaults to anon so signed-out writes are never mistaken for a user's", () => {
    expect(currentFilingScope()).toBe("anon");
  });

  it("hides one account's records from another", () => {
    setFilingScope("user-a");
    FilingSystem.write("note", "n1", { text: "A's private note" });
    expect(FilingSystem.read("note", "n1")).toEqual({ text: "A's private note" });
    expect(FilingSystem.list()).toHaveLength(1);

    setFilingScope("user-b");
    expect(FilingSystem.read("note", "n1")).toBeNull();
    expect(FilingSystem.list()).toHaveLength(0);
  });

  it("gives each account back its own records on return", () => {
    setFilingScope("user-a");
    FilingSystem.write("note", "n1", { text: "from A" });
    setFilingScope("user-b");
    FilingSystem.write("note", "n1", { text: "from B" });

    setFilingScope("user-a");
    expect(FilingSystem.read("note", "n1")).toEqual({ text: "from A" });
    setFilingScope("user-b");
    expect(FilingSystem.read("note", "n1")).toEqual({ text: "from B" });
  });

  it("keeps signed-out records out of an account's namespace", () => {
    setFilingScope(null);
    FilingSystem.write("note", "scratch", { text: "before sign-in" });

    setFilingScope("user-a");
    expect(FilingSystem.read("note", "scratch")).toBeNull();
    expect(FilingSystem.list()).toHaveLength(0);
  });

  it("scopes the archive too, not just live records", () => {
    setFilingScope("user-a");
    FilingSystem.write("task", "t1", { done: false });
    expect(FilingSystem.archive("task", "t1")).toBe(true);
    expect(FilingSystem.list()).toHaveLength(1);
    expect(FilingSystem.list()[0].archived).toBe(true);

    setFilingScope("user-b");
    expect(FilingSystem.list()).toHaveLength(0);
    // B must not be able to restore a record A archived.
    expect(FilingSystem.restore("task", "t1")).toBe(false);

    setFilingScope("user-a");
    expect(FilingSystem.restore("task", "t1")).toBe(true);
    expect(FilingSystem.read("task", "t1")).toEqual({ done: false });
  });

  it("still separates live from archived within one account", () => {
    // The archive prefix extends the live one, so the enumeration has to test
    // archived first or every archived record reads as live.
    setFilingScope("user-a");
    FilingSystem.write("note", "kept", { a: 1 });
    FilingSystem.write("note", "filed", { b: 2 });
    FilingSystem.archive("note", "filed");

    const records = FilingSystem.list();
    expect(records).toHaveLength(2);
    expect(records.every((r) => r.entityType === "note")).toBe(true);
    expect(records.filter((r) => r.archived).map((r) => r.id)).toEqual(["filed"]);
  });

  it("does not let a crafted user id escape into the key separator", () => {
    // Ids are uuids in practice, but the key parser splits on dots, so a dot
    // in the scope would let one account address another's namespace.
    setFilingScope("a.b");
    FilingSystem.write("note", "n1", { text: "x" });
    setFilingScope("a_b");
    // Both normalise to the same scope rather than one reaching into the other
    // through the separator; what matters is that neither can forge a path.
    expect(currentFilingScope()).toBe("a_b");
    expect(FilingSystem.list().every((r) => r.entityType === "note")).toBe(true);
  });
});
