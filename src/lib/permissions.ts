import { supabase } from "@/integrations/supabase/client";

/**
 * Tables introduced by the roles/audit migrations that are not yet reflected in
 * the generated database types. Narrow, local escape hatch — nothing else.
 */
type UntypedClient = {
  from: (table: string) => {
    select: (cols: string) => { eq: (col: string, val: string) => Promise<{ data: { role: AppRole }[] | null; error: unknown }> };
    insert: (row: Record<string, unknown>) => Promise<{ error: unknown }>;
  };
};

/**
 * Roles and the audit trail, client side.
 *
 * The database is the authority here, not this file. Every function below is a
 * convenience over tables that enforce the same rules in RLS, so a caller who
 * skips these helpers — or lies to them — gains nothing. `canGrantRoles()`
 * deciding to show a button is a UI affordance; the policy on user_roles is
 * what actually stops the insert.
 *
 * See supabase/migrations/*_bc967989-*.sql (roles) and *_27ebac05-*.sql (trail).
 */

/** Mirrors the public.app_role enum. */
export type AppRole = "owner" | "admin" | "operator" | "auditor";

/** Mirrors public.audit_category. */
export type AuditCategory =
  | "model_call"
  | "file_access"
  | "permission_change"
  | "shell_exec"
  | "data_export"
  | "auth"
  | "other";

/** Mirrors public.audit_result. */
export type AuditResult = "success" | "denied" | "error";

export interface AuditEvent {
  action: string;
  category?: AuditCategory;
  /** Scope or app that performed it — the PC's `actor`. */
  actor?: string;
  details?: Record<string, unknown>;
  result?: AuditResult;
}

/** Roles that may grant and revoke. Kept in one place so UI and prose agree. */
const ADMIN_ROLES: readonly AppRole[] = ["owner", "admin"];

/**
 * Every role held by a user. Defaults to the signed-in user.
 *
 * Returns [] rather than throwing when the read fails or nobody is signed in:
 * an empty set is the safe answer, because every check below is a positive
 * one — no role means no permission, never accidental permission.
 */
export async function fetchRoles(userId?: string): Promise<AppRole[]> {
  let id = userId;
  if (!id) {
    const { data } = await supabase.auth.getUser();
    id = data?.user?.id;
  }
  if (!id) return [];

  // Cast: user_roles/audit_events are not present in the generated types yet.
  const { data, error } = await (supabase as unknown as UntypedClient)
    .from("user_roles")
    .select("role")
    .eq("user_id", id);

  if (error || !data) return [];
  return data.map((row: { role: AppRole }) => row.role);
}

/** Whether `roles` includes `role`. Pure — the DB has already had its say. */
export function hasRole(roles: readonly AppRole[], role: AppRole): boolean {
  return roles.includes(role);
}

/** Owner or admin. Mirrors public.is_admin(). */
export function isAdmin(roles: readonly AppRole[]): boolean {
  return roles.some((r) => ADMIN_ROLES.includes(r));
}

/** Only admins may grant or revoke — the same rule the RLS policy enforces. */
export function canGrantRoles(roles: readonly AppRole[]): boolean {
  return isAdmin(roles);
}

/**
 * Who can read the whole trail rather than only their own rows. An auditor
 * reads everything and writes nothing, which is the point of the seat.
 */
export function canReadAllAudit(roles: readonly AppRole[]): boolean {
  return isAdmin(roles) || hasRole(roles, "auditor");
}

/**
 * Append one event to the trail, attributed to the signed-in user.
 *
 * `user_id` is set from the session rather than taken as an argument on
 * purpose: the insert policy requires it to equal auth.uid(), so accepting a
 * caller-supplied id would only produce rejected writes that look like bugs.
 *
 * Never throws. An audit write failing must not take down the action it was
 * recording — losing the entry is bad, losing the operation is worse.
 */
export async function recordAuditEvent(event: AuditEvent): Promise<boolean> {
  try {
    const { data } = await supabase.auth.getUser();
    const userId = data?.user?.id;
    if (!userId) return false;

    const { error } = await (supabase as unknown as UntypedClient).from("audit_events").insert({
      user_id: userId,
      action: event.action,
      actor: event.actor ?? "jackie",
      category: event.category ?? "other",
      details: event.details ?? null,
      result: event.result ?? "success",
    });
    return !error;
  } catch {
    return false;
  }
}
