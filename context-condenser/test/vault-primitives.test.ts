import test from 'node:test';
import assert from 'node:assert/strict';
import { lzwCompress, lzwDecompress, gzipEncode, gzipDecode } from '../packages/vault/codecs.ts';
import { newKdfParams, deriveKey, sealFrame, openFrame, sha256Hex } from '../packages/vault/crypto.ts';

const TEXT = 'The quick brown fox. '.repeat(200) + 'Ünïcödé ✓ tail';
const BYTES = new TextEncoder().encode(TEXT);

test('lzw round-trips exactly', () => {
  assert.equal(lzwDecompress(lzwCompress(TEXT)), TEXT);
});

test('lzw round-trips the empty string', () => {
  assert.equal(lzwDecompress(lzwCompress('')), '');
});

test('gzip round-trips exactly and actually compresses', () => {
  const gz = gzipEncode(BYTES);
  assert.deepEqual(gzipDecode(gz), BYTES);
  assert.ok(gz.length < BYTES.length, 'gzip should shrink repetitive text');
});

test('refuses a pod whose header names a KDF cost that is not one', async () => {
  // `iterations` is read back out of the pod header, so it comes from whoever
  // wrote the pod. A count in the single digits names a KDF that hardens
  // nothing, and one in the billions turns opening a pod into a way to hang
  // the process holding it. Neither is a number this module ever writes.
  const { salt } = newKdfParams();
  for (const iterations of [1, 1000, 0, -1, 1e12, 1.5, NaN, undefined as unknown as number]) {
    await assert.rejects(
      () => deriveKey('correct horse battery staple', { salt, iterations }),
      /KDF iteration count/,
      `iterations=${String(iterations)} should be refused`,
    );
  }
});

test('accepts the cost it writes itself', async () => {
  const params = newKdfParams();
  assert.equal(params.iterations, 600_000);
  assert.ok(await deriveKey('correct horse battery staple', params));
});

test('aes-gcm round-trips, rejects the wrong passphrase, never reuses an IV', async () => {
  const params = newKdfParams();
  const key = await deriveKey('correct horse battery staple', params);

  const a = await sealFrame(key, BYTES);
  assert.deepEqual(await openFrame(key, a.data, a.iv), BYTES);

  const wrong = await deriveKey('wrong horse', params);
  await assert.rejects(() => openFrame(wrong, a.data, a.iv), /failed to decrypt/);

  const b = await sealFrame(key, BYTES);
  assert.notEqual(a.iv, b.iv, 'IV must be fresh per frame');
});

test('tampered ciphertext fails to open rather than returning wrong plaintext', async () => {
  const params = newKdfParams();
  const key = await deriveKey('pw', params);
  const { data, iv } = await sealFrame(key, BYTES);
  const tampered = new Uint8Array(data);
  tampered[10] ^= 0xff;
  await assert.rejects(() => openFrame(key, tampered, iv), /failed to decrypt/);
});

test('an empty passphrase is refused', async () => {
  await assert.rejects(() => deriveKey('', newKdfParams()), /passphrase required/);
});

test('sha256 is stable and 64 hex chars', async () => {
  const h = await sha256Hex(BYTES);
  assert.match(h, /^[0-9a-f]{64}$/);
  assert.equal(h, await sha256Hex(BYTES));
});
