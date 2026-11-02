/**
 * The four ways a station can be checked.
 *
 * Each is a `StationProbe`. Nothing outside this file knows which one a given
 * station uses: the health service calls `check()` and gets the same shape
 * back, so a station can change from a declared repo to a live service without
 * touching a caller.
 *
 * Every probe takes its boundary (the fetch, the engine call) as an argument.
 * That is what lets the tests run the real probe logic — the branch that turns
 * a 404 into `absent`, the branch that turns a thrown error into its message —
 * against a stub that only returns plain data.
 */
import type { StationProbe, StationProbeResult } from "./types";

/** How long a probe waits before calling a station absent. */
export const PROBE_TIMEOUT_MS = 4000;

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

function message(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

/**
 * The surface this code is running in. If it can ask the question, the answer
 * is yes — so this reports `live` without a round trip.
 */
export function inAppProbe(what: string): StationProbe {
  return {
    method: "in-app",
    async check(): Promise<StationProbeResult> {
      return { state: "live", detail: `${what} is served by this app` };
    },
  };
}

/**
 * A whole build shipped under /public and framed by a route. Present when its
 * entry file is served, absent when the build was never copied in — which is
 * the real failure, and previously showed up as a blank frame with no error.
 */
export function assetProbe(url: string, fetchImpl: FetchLike): StationProbe {
  return {
    method: `GET ${url}`,
    async check(signal?: AbortSignal): Promise<StationProbeResult> {
      try {
        const res = await fetchImpl(url, { method: "GET", signal });
        if (!res.ok) return { state: "absent", detail: `${url} → HTTP ${res.status}` };
        return { state: "live", detail: `${url} served` };
      } catch (error) {
        return { state: "absent", detail: `${url} → ${message(error)}` };
      }
    },
  };
}

/**
 * A running engine reached over the network — the Jacky Flask API through its
 * proxy, an Ollama host on the machine. `call` resolves with a line describing
 * what answered, or throws.
 */
export function serviceProbe(
  method: string,
  call: (signal?: AbortSignal) => Promise<string>,
): StationProbe {
  return {
    method,
    async check(signal?: AbortSignal): Promise<StationProbeResult> {
      try {
        return { state: "live", detail: await call(signal) };
      } catch (error) {
        return { state: "absent", detail: message(error) };
      }
    },
  };
}

/**
 * Source that is real but cannot be observed from a browser: an iOS app, an
 * Android driver, a C++ inference library. Reporting it `live` because the repo
 * exists would be a lie the panel then repeats, so it reports `declared` — named
 * by the system, liveness unclaimed.
 */
export function declaredProbe(runsOn: string): StationProbe {
  return {
    method: "declared",
    async check(): Promise<StationProbeResult> {
      return { state: "declared", detail: `runs on ${runsOn} — not observable from the browser` };
    },
  };
}

/** Wraps a probe so a hung boundary becomes `absent` instead of a stuck panel. */
export function withTimeout(probe: StationProbe, ms = PROBE_TIMEOUT_MS): StationProbe {
  return {
    method: probe.method,
    async check(signal?: AbortSignal): Promise<StationProbeResult> {
      const controller = new AbortController();
      const abort = () => controller.abort();
      signal?.addEventListener("abort", abort);
      const timer = setTimeout(abort, ms);
      try {
        return await probe.check(controller.signal);
      } finally {
        clearTimeout(timer);
        signal?.removeEventListener("abort", abort);
      }
    },
  };
}
