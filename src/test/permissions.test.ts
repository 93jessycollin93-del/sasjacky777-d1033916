import { beforeEach, describe, expect, it, vi } from "vitest";

const getUser = vi.fn();
const from = vi.fn();

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    auth: { getUser: () => getUser() },
    from: (t: string) => from(t),
  },
}));

import {
  canGrantRoles,
  canReadAllAudit,
  fetchRoles,
  hasRole,
  isAdmin,
  recordAuditEvent,
  type AppRole,
} from "@/lib/permissions";

const signedInAs = (id: string | null) =>
  getUser.mockResolvedValue({ data: { user: id ? { id } : null } });

/** Minimal stand-in for the query builder shape these helpers use. */
const rolesTable = (result: { data?: unknown; error?: unknown }) =>
  from.mockImplementation((table: string) => {
    if (table === "user_roles") {
      return { select: () => ({ eq: () => Promise.resolve(result) }) };
    }
    throw new Error(`unexpected table ${table}`);
  });

beforeEach(() => {
  getUser.mockReset();
  from.mockReset();
});

describe("role predicates", () => {
  it("recognises owner and admin as admin, others not", () => {
    expect(isAdmin(["owner"])).toBe(true);
    expect(isAdmin(["admin"])).toBe(true);
    expect(isAdmin(["operator"])).toBe(false);
    expect(isAdmin(["auditor"])).toBe(false);
    expect(isAdmin([])).toBe(false);
  });

  it("lets only admins grant roles, matching the RLS policy", () => {
    expect(canGrantRoles(["owner"])).toBe(true);
    expect(canGrantRoles(["operator", "auditor"])).toBe(false);
  });

  it("gives auditors full read of the trail but not admin", () => {
    expect(canReadAllAudit(["auditor"])).toBe(true);
    expect(isAdmin(["auditor"])).toBe(false);
    expect(canGrantRoles(["auditor"])).toBe(false);
  });

  it("does not treat an unknown role as privileged", () => {
    const roles = ["superuser" as AppRole];
    expect(isAdmin(roles)).toBe(false);
    expect(canReadAllAudit(roles)).toBe(false);
  });

  it("matches exact role names only", () => {
    expect(hasRole(["operator"], "owner")).toBe(false);
    expect(hasRole(["owner"], "owner")).toBe(true);
  });
});

describe("fetchRoles", () => {
  it("returns the roles the row set contains", async () => {
    signedInAs("u1");
    rolesTable({ data: [{ role: "owner" }, { role: "auditor" }], error: null });
    await expect(fetchRoles()).resolves.toEqual(["owner", "auditor"]);
  });

  it("returns none when signed out, without querying", async () => {
    signedInAs(null);
    await expect(fetchRoles()).resolves.toEqual([]);
    expect(from).not.toHaveBeenCalled();
  });

  it("returns none — never a privilege — when the read errors", async () => {
    signedInAs("u1");
    rolesTable({ data: null, error: { message: "network" } });
    const roles = await fetchRoles();
    expect(roles).toEqual([]);
    expect(isAdmin(roles)).toBe(false);
  });
});

describe("recordAuditEvent", () => {
  it("attributes the row to the session user and fills defaults", async () => {
    signedInAs("u1");
    const insert = vi.fn().mockResolvedValue({ error: null });
    from.mockReturnValue({ insert });

    await expect(recordAuditEvent({ action: "rotated key" })).resolves.toBe(true);
    expect(from).toHaveBeenCalledWith("audit_events");
    expect(insert).toHaveBeenCalledWith({
      user_id: "u1",
      action: "rotated key",
      actor: "jackie",
      category: "other",
      details: null,
      result: "success",
    });
  });

  it("cannot be told to write under another user", async () => {
    signedInAs("u1");
    const insert = vi.fn().mockResolvedValue({ error: null });
    from.mockReturnValue({ insert });

    await recordAuditEvent({
      // A caller trying to forge attribution has nowhere to put it.
      ...({ user_id: "someone-else" } as Record<string, unknown>),
      action: "forged",
    });
    expect(insert.mock.calls[0][0].user_id).toBe("u1");
  });

  it("reports failure instead of throwing when the insert errors", async () => {
    signedInAs("u1");
    from.mockReturnValue({
      insert: vi.fn().mockResolvedValue({ error: { message: "denied" } }),
    });
    await expect(recordAuditEvent({ action: "x" })).resolves.toBe(false);
  });

  it("never throws when the client blows up mid-write", async () => {
    signedInAs("u1");
    from.mockImplementation(() => {
      throw new Error("client exploded");
    });
    await expect(recordAuditEvent({ action: "x" })).resolves.toBe(false);
  });
});
