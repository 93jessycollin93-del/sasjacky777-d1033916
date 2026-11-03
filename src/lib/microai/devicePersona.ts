import { callEdgeFunction, describeEdgeFailure, NotSignedInError } from "@/lib/edgeFunction";
import { clampContext } from "../../../supabase/functions/_shared/chatRequest";
import { currentUserId, loadDevicePersona, saveDevicePersona } from "./personaCache";

export interface DevicePersonaIssue {
  code: "NOT_DEPLOYED" | "SIGNED_OUT" | "OWNER_ONLY" | "TIMEOUT" | "UNREACHABLE" | "INVALID_PROFILE";
  title: string;
  detail: string;
  recovery: string;
  href?: string;
}

export type DevicePersonaResult =
  | {
      ok: true;
      prompt: string;
      mode: string;
      /** True when this came from this device rather than the profile service. */
      fromCache?: boolean;
      /** When the saved copy was last fetched online. */
      fetchedAt?: number;
      issue?: undefined;
      stopped?: undefined;
    }
  | { ok: false; issue: DevicePersonaIssue; stopped?: boolean };

export const DEVICE_PROFILE_DEPLOY_COMMAND =
  "supabase functions deploy jackie-device --project-ref iezgzdhhmwmbqshnxrie --use-api";

/**
 * Keep the downloaded weights separate from the server profile they need.
 *
 * A profile that arrives is saved to this device (`personaCache.ts`), and when
 * the request fails because the network itself is the problem — not a sign-in,
 * a missing deployment or a bad response — the saved copy answers instead.
 * Without that, a model already sitting on the device still cannot answer with
 * the radio off, and the person is sent to debug a backend that is fine.
 */
export async function fetchDevicePersona(options: {
  context?: string;
  signal?: AbortSignal;
  timeoutMs?: number;
} = {}): Promise<DevicePersonaResult> {
  const controller = new AbortController();
  let timedOut = false;
  const stop = () => controller.abort();
  const cancelled = (): DevicePersonaResult => ({ ok: false, stopped: true, issue: {
    code: "UNREACHABLE", title: "Stopped", detail: "The profile request was cancelled.", recovery: "Run again when you are ready.",
  } });
  // Checked before the request starts as well as in its failure path: a signal
  // that is already aborted never fires `abort` again, so a caller who cancelled
  // while the session was being read would otherwise wait on a fetch that never
  // runs.
  if (options.signal?.aborted) return cancelled();
  options.signal?.addEventListener("abort", stop, { once: true });
  const timer = setTimeout(() => { timedOut = true; stop(); }, options.timeoutMs ?? 15_000);
  const userId = await currentUserId();
  if (options.signal?.aborted) {
    clearTimeout(timer);
    return cancelled();
  }
  try {
    const response = await callEdgeFunction("jackie-device", {
      context: clampContext(options.context, 2_000),
    }, { signal: controller.signal });
    const body = await response.json().catch(() => null);
    if (response.status === 404) return { ok: false, issue: {
      code: "NOT_DEPLOYED", title: "Jackie's profile service is missing",
      detail: "jackie-device returned HTTP 404. The model download is intact; the backend function has not been deployed to this project.",
      recovery: "Deploy jackie-device in Lovable Cloud or Supabase, then check the connection again. You do not need to download the model again.",
    } };
    if (response.status === 401) return { ok: false, issue: {
      code: "SIGNED_OUT", title: "Sign-in needs attention",
      detail: "Your session was refused by Jackie's profile service.",
      recovery: "Sign in to your owner account, then check the connection again.", href: "/auth?next=/",
    } };
    if (response.status === 403) return { ok: false, issue: {
      code: "OWNER_ONLY", title: "Owner access is required",
      detail: "Jackie's profile is protected; only the owner's account can fetch it.",
      recovery: "Sign in to the verified, allowlisted account and claim owner access in Jackie Core.", href: "/core",
    } };
    if (!response.ok || typeof body?.prompt !== "string" || !body.prompt.trim()) return { ok: false, issue: {
      code: "INVALID_PROFILE", title: "Jackie's profile could not be fetched",
      detail: `The profile service did not return a usable profile (HTTP ${response.status}).`,
      recovery: "Check the jackie-device deployment and its logs, then try Check connection again.",
    } };
    const mode = typeof body.mode === "string" ? body.mode : "unknown";
    await saveDevicePersona({ userId: userId ?? "", prompt: body.prompt, mode, fetchedAt: Date.now() });
    return { ok: true, prompt: body.prompt, mode };
  } catch (error) {
    if (options.signal?.aborted) return cancelled();
    if (error instanceof NotSignedInError) return { ok: false, issue: {
      code: "SIGNED_OUT", title: "Sign-in needs attention", detail: error.message,
      recovery: "Sign in to your owner account, then check the connection again.", href: "/auth?next=/",
    } };
    // Only a request that could not be answered counts as the network being
    // out. A refused or malformed profile is a real fault, and answering from
    // a saved copy would hide it until the next online visit.
    const cached = await loadDevicePersona(userId);
    if (cached) return { ok: true, prompt: cached.prompt, mode: cached.mode, fromCache: true, fetchedAt: cached.fetchedAt };
    return { ok: false, issue: {
      code: timedOut ? "TIMEOUT" : "UNREACHABLE",
      title: timedOut ? "Profile check timed out" : "Profile service is unreachable",
      detail: timedOut ? "No profile arrived within 15 seconds." : describeEdgeFailure(error, "jackie-device"),
      recovery: "Check your connection and the backend deployment, then try again. Your downloaded model is safe. Opening Jackie online once saves a profile copy here, after which this works with no signal.",
    } };
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener("abort", stop);
  }
}
