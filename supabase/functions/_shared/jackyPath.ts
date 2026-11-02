/**
 * What the jacky proxy is allowed to reach.
 *
 * The proxy forwards to a host that is not on the internet — the owner's own
 * rig, holding GPU control, model management and a secrets file — and it
 * attaches the server's `JACKY_API_TOKEN` to whatever it sends. So the path is
 * the security boundary, and it was not being checked.
 *
 * The original stripped leading slashes and interpolated the rest:
 *
 *     fetch(`${base}/api/${rawPath}`)
 *
 * `..` survives that, and `new URL()` then collapses it, so any authenticated
 * caller could ask for `../../admin` and reach `${base}/admin` — off the `/api`
 * prefix entirely, carrying the server's credentials. Anything the rig serves
 * was reachable.
 *
 * The fix is an allowlist rather than a blocklist. The client contract is five
 * calls and they are all here; a blocklist of `..` would still leave the next
 * encoding trick to be discovered, while a shape that must match cannot be
 * talked into fetching something else.
 */

/** Exactly what `src/lib/jackyClient.ts` calls, and nothing else. */
export const ALLOWED_PATHS: RegExp[] = [
  /^status$/,
  /^assessment$/,
  /^ask$/,
  /^control$/,
  /^squads\/[A-Za-z0-9_-]{1,64}\/ask$/,
];

export interface PathVerdict {
  ok: boolean;
  /** The path to forward, only when ok. */
  path?: string;
  reason?: string;
}

/**
 * Checks a requested path against the contract.
 *
 * Leading slashes are stripped first, as the original did, so a caller writing
 * "/status" still works — but everything after that must match a shape, so
 * there is nowhere for a traversal to hide. Percent-encoding is decoded before
 * matching: `%2e%2e` and `..` have to be judged by the same rule, or the check
 * is only as good as the encodings someone thought of.
 */
export function checkJackyPath(raw: unknown): PathVerdict {
  if (typeof raw !== "string" || raw.length === 0) {
    return { ok: false, reason: "missing 'path'" };
  }
  if (raw.length > 256) {
    return { ok: false, reason: "path too long" };
  }

  const trimmed = raw.replace(/^\/+/, "");

  let decoded: string;
  try {
    decoded = decodeURIComponent(trimmed);
  } catch {
    return { ok: false, reason: "malformed percent-encoding" };
  }

  // Judged on the decoded form, so an encoded traversal meets the same rule as
  // a literal one.
  if (decoded !== trimmed) {
    return { ok: false, reason: "path must not be percent-encoded" };
  }
  // eslint-disable-next-line no-control-regex -- rejecting control characters is the whole purpose of this check
  if (/[\0-\x1f\x7f]/.test(decoded)) {
    return { ok: false, reason: "control characters in path" };
  }

  const matched = ALLOWED_PATHS.some((pattern) => pattern.test(decoded));
  if (!matched) {
    return { ok: false, reason: `path '${decoded}' is not one this proxy forwards` };
  }

  return { ok: true, path: decoded };
}
