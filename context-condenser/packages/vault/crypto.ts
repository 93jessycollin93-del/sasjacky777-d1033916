/**
 * Encryption at rest for vault pods: AES-256-GCM with PBKDF2-derived keys.
 *
 * Rules this module enforces, because getting any of them wrong silently
 * destroys the confidentiality the vault claims to provide:
 *  - A fresh random 12-byte IV for EVERY frame. GCM catastrophically fails
 *    if an IV is reused under the same key, so IVs are never derived or reused.
 *  - A fresh random 16-byte salt per pod, stored in the header.
 *  - The GCM tag is kept with the frame, so tampering fails the open rather
 *    than returning wrong plaintext.
 *  - The iteration count is read back out of the pod header, which means it
 *    arrives from whoever wrote the pod rather than from this module. It is
 *    bounded on the way in: too low and the KDF it names is not work-hardening
 *    anything, too high and opening a pod is a way to hang the process holding
 *    it.
 */
const IV_BYTES = 12;
const SALT_BYTES = 16;
const KDF_ITERATIONS = 600_000;
/** Floor: OWASP's PBKDF2-HMAC-SHA256 guidance, an order of magnitude down. */
const MIN_KDF_ITERATIONS = 100_000;
/** Ceiling: still seconds, not minutes, on hardware nobody would call fast. */
const MAX_KDF_ITERATIONS = 10_000_000;

export interface KdfParams { salt: string; iterations: number; }

export function newKdfParams(): KdfParams {
  const salt = new Uint8Array(SALT_BYTES);
  crypto.getRandomValues(salt);
  return { salt: Buffer.from(salt).toString('base64'), iterations: KDF_ITERATIONS };
}

export async function deriveKey(passphrase: string, params: KdfParams): Promise<CryptoKey> {
  if (!passphrase) throw new Error('passphrase required for an encrypted pod');
  const iterations = params?.iterations;
  if (!Number.isInteger(iterations) || iterations < MIN_KDF_ITERATIONS || iterations > MAX_KDF_ITERATIONS) {
    throw new Error(
      `pod declares an unusable KDF iteration count (${String(iterations)}); ` +
      `expected an integer between ${MIN_KDF_ITERATIONS} and ${MAX_KDF_ITERATIONS}`,
    );
  }
  const material = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(passphrase), 'PBKDF2', false, ['deriveKey'],
  );
  return crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: Buffer.from(params.salt, 'base64'),
      iterations,
      hash: 'SHA-256',
    },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

/** Returns ciphertext (tag appended by WebCrypto) and the IV used for it. */
export async function sealFrame(key: CryptoKey, plain: Uint8Array): Promise<{ data: Uint8Array; iv: string }> {
  const iv = new Uint8Array(IV_BYTES);
  crypto.getRandomValues(iv);
  const buf = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, plain);
  return { data: new Uint8Array(buf), iv: Buffer.from(iv).toString('base64') };
}

export async function openFrame(key: CryptoKey, data: Uint8Array, iv: string): Promise<Uint8Array> {
  try {
    const buf = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: Buffer.from(iv, 'base64') }, key, data,
    );
    return new Uint8Array(buf);
  } catch {
    throw new Error('frame failed to decrypt — wrong passphrase, or the pod was tampered with');
  }
}

export async function sha256Hex(data: Uint8Array): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', data);
  return Buffer.from(new Uint8Array(buf)).toString('hex');
}
