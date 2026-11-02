const SECURITY_PATTERNS = [
  /hardcoded\s*(api[_ ]?key|secret|password|token|credential)/i,
  /exposed\s*(secret|token|key|credential)/i,
  /api[_ ]?key\s*(in|exposed|hardcoded|leaked|visible)/i,
  /password\s*(in|exposed|hardcoded|leaked|visible|plain)/i,
  /secret\s*(in|exposed|hardcoded|leaked|visible)/i,
  /security\s*(breach|risk|vulnerability|issue|concern|warning|flaw)/i,
  /\beval\s*\(/i,
  /shell\s*=\s*True/i,
  /unsafe\s*(pickle|deserialization)/i,
  /credential[s]?\s*(exposed|leaked|hardcoded)/i,
  /\b(CVE-\d{4}-\d+)\b/i,
  /injection\s*(attack|vulnerability|risk)/i,
  /XSS|cross.site.scripting/i,
  /SQL\s*injection/i,
];

/**
 * The banner above an answer used to come only from phrases, so it reported
 * incidents that never happened: Jackie's persona says she "warns about …
 * exposed secrets", and an answer describing her own job came back labelled
 * EXPOSED CREDENTIAL. Meanwhile an answer that really contained a key raised
 * nothing, because a key is not a phrase. The alarm is now reserved for a
 * credential-shaped value in the answer itself; talking about security is
 * labelled as talking about it.
 */
export const CREDENTIAL_FLAG_PREFIX = "Credential in this answer";
const DISCUSSES = "Discusses";

const TOPIC_LABELS: Array<{ pattern: RegExp; label: string }> = [
  { pattern: /hardcoded\s*(api[_ ]?key|secret|password|token|credential)/i, label: `${DISCUSSES} hardcoded secrets` },
  { pattern: /exposed\s*(secret|token|key|credential)/i, label: `${DISCUSSES} exposed credentials` },
  { pattern: /api[_ ]?key\s*(in|exposed|hardcoded|leaked|visible)/i, label: `${DISCUSSES} API key exposure` },
  { pattern: /password\s*(in|exposed|hardcoded|leaked|visible|plain)/i, label: `${DISCUSSES} password exposure` },
  { pattern: /security\s*(breach|risk|vulnerability|issue|concern|warning|flaw)/i, label: `${DISCUSSES} a security risk` },
  { pattern: /\beval\s*\(/i, label: `${DISCUSSES} eval()` },
  { pattern: /shell\s*=\s*True/i, label: `${DISCUSSES} shell=True` },
  { pattern: /injection\s*(attack|vulnerability|risk)/i, label: `${DISCUSSES} injection` },
  { pattern: /XSS|cross.site.scripting/i, label: `${DISCUSSES} XSS` },
  { pattern: /SQL\s*injection/i, label: `${DISCUSSES} SQL injection` },
];

/** What the phrase matcher used to save with each message, and what it actually meant. */
const LEGACY_LABELS: Record<string, string> = {
  "Hardcoded Secret Detected": `${DISCUSSES} hardcoded secrets`,
  "Exposed Credential": `${DISCUSSES} exposed credentials`,
  "API Key Exposure": `${DISCUSSES} API key exposure`,
  "Password Exposure": `${DISCUSSES} password exposure`,
  "Security Risk Identified": `${DISCUSSES} a security risk`,
  "Unsafe eval() Usage": `${DISCUSSES} eval()`,
  "Unsafe Shell Execution": `${DISCUSSES} shell=True`,
  "Injection Vulnerability": `${DISCUSSES} injection`,
  "XSS Vulnerability": `${DISCUSSES} XSS`,
  "SQL Injection Risk": `${DISCUSSES} SQL injection`,
};

/**
 * Shapes real credentials take. Each has a fixed prefix or structure, so an
 * answer *about* keys does not match, and none of them is a publishable
 * value: a Supabase anon key ships in every browser and is left alone, while
 * a service_role key, which bypasses row-level security, is flagged.
 */
const CREDENTIAL_SHAPES: Array<{ kind: string; pattern: RegExp }> = [
  { kind: "private key", pattern: /-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP |ENCRYPTED )?PRIVATE KEY(?: BLOCK)?-----/ },
  { kind: "Anthropic API key", pattern: /\bsk-ant-[A-Za-z0-9_-]{20,}/ },
  { kind: "OpenRouter API key", pattern: /\bsk-or-v1-[a-f0-9]{48,}/ },
  { kind: "OpenAI API key", pattern: /\bsk-proj-[A-Za-z0-9_-]{20,}/ },
  { kind: "OpenAI or DeepSeek API key", pattern: /(?<![A-Za-z0-9_-])sk-[A-Za-z0-9]{32,}/ },
  { kind: "Groq API key", pattern: /\bgsk_[A-Za-z0-9]{40,}/ },
  { kind: "Google API key", pattern: /\bAIza[0-9A-Za-z_-]{35}/ },
  { kind: "Hugging Face token", pattern: /\bhf_[A-Za-z]{30,}/ },
  { kind: "GitHub token", pattern: /\b(?:gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{60,})/ },
  { kind: "Slack token", pattern: /\bxox[abprs]-[A-Za-z0-9-]{10,}/ },
  { kind: "Stripe live key", pattern: /\b(?:sk|rk)_live_[A-Za-z0-9]{20,}/ },
  { kind: "AWS access key", pattern: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/ },
  { kind: "Supabase secret key", pattern: /\bsb_secret_[A-Za-z0-9_-]{16,}/ },
  { kind: "Supabase access token", pattern: /\bsbp_[a-f0-9]{40}\b/ },
  { kind: "Telegram bot token", pattern: /\b\d{8,10}:AA[A-Za-z0-9_-]{33}\b/ },
];

/** AWS's own documentation key: everywhere in examples, valid nowhere. */
const KNOWN_EXAMPLES = new Set(["AKIAIOSFODNN7EXAMPLE"]);

/** A run like sk-xxxxxxxx… or sk-1111… is a placeholder in an example, not a key. */
function looksLikePlaceholder(value: string): boolean {
  const body = value.replace(/^[A-Za-z]+[-_](?:[a-z0-9]+[-_])?/, "");
  return KNOWN_EXAMPLES.has(value) || /^(.)\1+$/.test(body) || /x{8,}|\.{3}|…|your|example|placeholder|redacted/i.test(value);
}

function base64UrlJson(segment: string): Record<string, unknown> | null {
  try {
    const padded = segment.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (segment.length % 4)) % 4);
    return JSON.parse(atob(padded));
  } catch {
    return null;
  }
}

/**
 * Every credential in a text, with its value. Only for callers that never show
 * the value — src/test/no-credentials.test.ts fingerprints it; anything that
 * displays should use findCredentials.
 */
export function credentialMatches(content: string): Array<{ kind: string; value: string }> {
  const found: Array<{ kind: string; value: string }> = [];
  for (const { kind, pattern } of CREDENTIAL_SHAPES) {
    const global = new RegExp(pattern.source, pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`);
    for (const match of content.matchAll(global)) {
      if (kind === "private key" || !looksLikePlaceholder(match[0])) found.push({ kind, value: match[0] });
    }
  }
  for (const [token] of content.matchAll(/eyJ[A-Za-z0-9_-]{8,}\.(eyJ[A-Za-z0-9_-]{8,})\.[A-Za-z0-9_-]{8,}/g)) {
    const payload = base64UrlJson(token.split(".")[1]);
    if (payload?.role === "service_role") found.push({ kind: "Supabase service-role key", value: token });
  }
  return found;
}

/** The kinds of real credential an answer contains. Never the values. */
export function findCredentials(content: string): string[] {
  return [...new Set(credentialMatches(content).map((m) => m.kind))];
}

export function detectSecurityFlag(content: string): string | null {
  const credentials = findCredentials(content);
  if (credentials.length) return `${CREDENTIAL_FLAG_PREFIX}: ${credentials.join(", ")}`;
  for (const { pattern, label } of TOPIC_LABELS) {
    if (pattern.test(content)) return label;
  }
  return null;
}

/** A saved flag, in words that say what happened; older messages carry the phrase matcher's labels. */
export function describeFlag(stored: string | null | undefined): string | null {
  if (!stored) return null;
  return LEGACY_LABELS[stored] ?? stored;
}

/** Whether a flag reports a real credential, which the banner shows as an alarm, rather than a topic. */
export function isCredentialFlag(flag: string | null | undefined): boolean {
  return !!flag && flag.startsWith(CREDENTIAL_FLAG_PREFIX);
}

export function detectMemoryTier(content: string, userInput: string): 1 | 2 | 3 {
  // Gold: identity, architecture, core decisions
  const goldPatterns = [/core identity/i, /architecture/i, /foundational/i, /non-negotiable/i, /gold memory/i];
  if (goldPatterns.some((p) => p.test(content))) return 3;

  // Durable: security, preferences, project context
  const durablePatterns = [/security/i, /hardcoded/i, /credential/i, /preference/i, /remember/i, /important/i];
  if (durablePatterns.some((p) => p.test(content) || p.test(userInput))) return 2;

  return 1;
}

export function hasSecurityContent(content: string): boolean {
  return SECURITY_PATTERNS.some((p) => p.test(content));
}
