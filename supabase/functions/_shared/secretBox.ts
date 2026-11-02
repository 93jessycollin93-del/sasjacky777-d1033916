/**
 * Encrypts connection secrets at rest (docs/CONNECTIONS.md, T1).
 *
 * AES-256-GCM via Web Crypto, which Deno and every test runtime have. The key
 * is CONNECTIONS_SECRET_KEY (32 random bytes, base64), an edge-function
 * secret that never reaches the browser bundle. Each ciphertext is bound to its
 * owner and connection as associated data, so one copied onto another row does
 * not decrypt: a database-level swap cannot point one person's key at another
 * person's connection.
 */

export class SecretBoxError extends Error {}

// Backed by a plain ArrayBuffer on purpose: newer TypeScript DOM types refuse a
// Uint8Array<ArrayBufferLike> as a BufferSource for Web Crypto, which failed the
// typecheck for every build even though the bytes were always fine.
function fromBase64(b64: string): Uint8Array<ArrayBuffer> {
  const bin = atob(b64);
  const out = new Uint8Array(new ArrayBuffer(bin.length));
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function toBase64(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

export async function importKey(base64Key: string | undefined): Promise<CryptoKey> {
  if (!base64Key) {
    throw new SecretBoxError("CONNECTIONS_SECRET_KEY is not set, so secrets cannot be stored or used. Add it in Cloud → Secrets (openssl rand -base64 32).");
  }
  let raw: Uint8Array<ArrayBuffer>;
  try {
    raw = fromBase64(base64Key.trim());
  } catch {
    throw new SecretBoxError("CONNECTIONS_SECRET_KEY is not valid base64.");
  }
  if (raw.length !== 32) throw new SecretBoxError("CONNECTIONS_SECRET_KEY must be 32 bytes (openssl rand -base64 32).");
  return crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt", "decrypt"]);
}

const aad = (userId: string, connectionId: string) => new TextEncoder().encode(`jackie-connection:${userId}:${connectionId}`);

export async function seal(key: CryptoKey, secret: string, userId: string, connectionId: string): Promise<{ iv: string; ciphertext: string }> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv, additionalData: aad(userId, connectionId) },
    key,
    new TextEncoder().encode(secret),
  );
  return { iv: toBase64(iv), ciphertext: toBase64(new Uint8Array(ct)) };
}

export async function open(key: CryptoKey, box: { iv: string; ciphertext: string }, userId: string, connectionId: string): Promise<string> {
  try {
    const pt = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: fromBase64(box.iv), additionalData: aad(userId, connectionId) },
      key,
      fromBase64(box.ciphertext),
    );
    return new TextDecoder().decode(pt);
  } catch {
    // Wrong key, a tampered ciphertext, or one moved from another connection:
    // all of them mean the stored secret cannot be trusted, so none is used.
    throw new SecretBoxError("The stored secret could not be decrypted — it was changed, moved, or the key was rotated. Set it again.");
  }
}

/** A secret is sent in a header or a query string: no line breaks, no control characters (T6). */
export function checkSecretValue(secret: unknown): string | null {
  if (typeof secret !== "string" || !secret.trim()) return "The secret is empty.";
  if (secret.length > 4096) return "The secret is longer than 4,096 characters.";
  // A header carries bytes, not text: a zero-width space or a curly quote
  // pasted with the key makes every call fail in fetch, which then reads to
  // the person as the service being down. Said here, where they can fix it.
  // eslint-disable-next-line no-control-regex
  if (/[^\x20-\x7E]/.test(secret.replace(/[\x00-\x1F\x7F]/g, ""))) {
    return "The key contains a character a request cannot carry — often an invisible one copied along with it. Paste it again, or type it.";
  }
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(secret)) return "The secret contains a line break or control character.";
  return null;
}
