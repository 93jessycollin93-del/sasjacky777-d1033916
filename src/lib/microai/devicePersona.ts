import { callEdgeFunction, describeEdgeFailure, NotSignedInError } from "@/lib/edgeFunction";
import { clampContext } from "../../../supabase/functions/_shared/chatRequest";

export interface DevicePersonaIssue {
  code: "NOT_DEPLOYED" | "SIGNED_OUT" | "OWNER_ONLY" | "TIMEOUT" | "UNREACHABLE" | "INVALID_PROFILE";
  title: string;
  detail: string;
  recovery: string;
  href?: string;
}

export type DevicePersonaResult =
  | { ok: true; prompt: string; mode: string; issue?: undefined; stopped?: undefined }
  | { ok: false; issue: DevicePersonaIssue; stopped?: boolean };

export const DEVICE_PROFILE_DEPLOY_COMMAND =
  "supabase functions deploy jackie-device --project-ref iezgzdhhmwmbqshnxrie --use-api";

/** Keep the downloaded weights separate from the server profile they need. */
export async function fetchDevicePersona(options: {
  context?: string;
  signal?: AbortSignal;
  timeoutMs?: number;
} = {}): Promise<DevicePersonaResult> {
  const controller = new AbortController();
  let timedOut = false;
  const stop = () => controller.abort();
  if (options.signal?.aborted) stop();
  options.signal?.addEventListener("abort", stop, { once: true });
  const timer = setTimeout(() => { timedOut = true; stop(); }, options.timeoutMs ?? 15_000);
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
    return { ok: true, prompt: body.prompt, mode: typeof body.mode === "string" ? body.mode : "unknown" };
  } catch (error) {
    if (options.signal?.aborted) return { ok: false, stopped: true, issue: {
      code: "UNREACHABLE", title: "Stopped", detail: "The profile request was cancelled.", recovery: "Run again when you are ready.",
    } };
    if (error instanceof NotSignedInError) return { ok: false, issue: {
      code: "SIGNED_OUT", title: "Sign-in needs attention", detail: error.message,
      recovery: "Sign in to your owner account, then check the connection again.", href: "/auth?next=/",
    } };
    return { ok: false, issue: {
      code: timedOut ? "TIMEOUT" : "UNREACHABLE",
      title: timedOut ? "Profile check timed out" : "Profile service is unreachable",
      detail: timedOut ? "No profile arrived within 15 seconds." : describeEdgeFailure(error, "jackie-device"),
      recovery: "Check your connection and the backend deployment, then try again. Your downloaded model is safe.",
    } };
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener("abort", stop);
  }
}
