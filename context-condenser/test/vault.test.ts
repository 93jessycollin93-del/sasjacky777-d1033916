import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { Vault } from '../packages/vault/vault.ts';

const PARA = 'Distributed systems reduce single points of failure. Consensus mechanisms trade latency for reliability. Eventual consistency is sufficient for most use cases. ';
const BIG = PARA.repeat(900) + 'Ünïcödé ✓ marker at the very end.';

async function withVault(fn: (v: Vault) => Promise<void>) {
  const dir = await mkdtemp(join(tmpdir(), 'cce-vault-'));
  try { await fn(new Vault(dir)); } finally { await rm(dir, { recursive: true, force: true }); }
}

test('seals and restores plaintext byte-for-byte', async () => {
  await withVault(async (v) => {
    const stats = await v.seal(BIG);
    assert.ok(stats.frames > 1, 'large text should span several frames');
    assert.ok(stats.ratio < 0.2, `expected real compression, got ratio ${stats.ratio}`);
    assert.equal(await v.restore(stats.sha256), BIG);
  });
});

test('restores an empty source', async () => {
  await withVault(async (v) => {
    const stats = await v.seal('');
    assert.equal(await v.restore(stats.sha256), '');
  });
});

test('span read returns exactly the requested bytes', async () => {
  await withVault(async (v) => {
    const stats = await v.seal(BIG);
    const bytes = new TextEncoder().encode(BIG);
    for (const [start, end] of [[0, 50], [4210, 4655], [bytes.length - 40, bytes.length]] as const) {
      const expected = new TextDecoder().decode(bytes.subarray(start, end));
      assert.equal(await v.readSpan(stats.sha256, start, end), expected, `span [${start}, ${end}]`);
    }
  });
});

test('a span read touches only the frames it overlaps', async () => {
  await withVault(async (v) => {
    const stats = await v.seal(BIG, { frameSize: 4096 });
    const area = await v.surfaceArea(stats.sha256, 4210, 4655);
    assert.ok(area.of > 8, 'test needs a multi-frame pod');
    assert.equal(area.frames, 1, 'a 445-byte span inside one frame must touch exactly one frame');
    assert.ok(area.bytes < 4096, 'should read well under the full pod');
  });
});

test('spans past the end clamp instead of throwing', async () => {
  await withVault(async (v) => {
    const stats = await v.seal('short text');
    assert.equal(await v.readSpan(stats.sha256, 6, 9999), 'text');
    assert.equal(await v.readSpan(stats.sha256, 500, 600), '');
  });
});

test('encrypted pods round-trip, and refuse to open without the passphrase', async () => {
  await withVault(async (v) => {
    const pass = 'sphere-passphrase';
    const stats = await v.seal(BIG, { passphrase: pass, frameSize: 8192 });
    assert.equal(stats.encrypted, true);

    assert.equal(await v.restore(stats.sha256, pass), BIG);
    assert.equal(await v.readSpan(stats.sha256, 100, 160, pass), BIG.slice(100, 160));

    await assert.rejects(() => v.restore(stats.sha256), /passphrase is required/);
    await assert.rejects(() => v.restore(stats.sha256, 'wrong'), /failed to decrypt/);
  });
});

test('content addressing is over plaintext, so encryption does not change the digest', async () => {
  await withVault(async (v) => {
    const plain = await v.seal(BIG);
    const sealed = await v.seal(BIG, { passphrase: 'pw' });
    assert.equal(plain.sha256, sealed.sha256);
  });
});

test('an encrypted pod does not contain its plaintext on disk', async () => {
  await withVault(async (v) => {
    const marker = 'CANARY-STRING-7741';
    const stats = await v.seal(`${PARA}${marker}${PARA}`, { passphrase: 'pw' });
    const { readFile } = await import('node:fs/promises');
    const { podPath } = await import('../packages/vault/vault.ts');
    const onDisk = await readFile(podPath(v.root, stats.sha256));
    assert.equal(onDisk.includes(marker), false, 'plaintext marker must not appear in the sealed pod');
  });
});

// Every byte value, including ones no UTF-8 text can contain, across several frames.
const BINARY = new Uint8Array(70_000).map((_, i) => (i * 37 + (i >> 8)) & 0xff);

test('seals raw bytes and restores them exactly, including bytes that are not UTF-8', async () => {
  await withVault(async (v) => {
    const stats = await v.seal(BINARY, { frameSize: 16 * 1024 });
    assert.ok(stats.frames > 1, 'needs a multi-frame pod');
    assert.equal(stats.bytes, BINARY.length);
    assert.equal(stats.sha256, createHash('sha256').update(BINARY).digest('hex'), 'address is the hash of the bytes given');
    assert.deepEqual(await v.restoreBytes(stats.sha256), BINARY);
  });
});

test('a byte span read across a frame boundary returns exactly those bytes', async () => {
  await withVault(async (v) => {
    const stats = await v.seal(BINARY, { frameSize: 16 * 1024 });
    const [start, end] = [16 * 1024 - 100, 16 * 1024 + 100];
    assert.deepEqual(await v.readBytes(stats.sha256, start, end), BINARY.subarray(start, end));
  });
});

test('encrypted raw bytes come back with the passphrase, and not without it', async () => {
  await withVault(async (v) => {
    const stats = await v.seal(BINARY, { passphrase: 'pod-pass' });
    assert.deepEqual(await v.restoreBytes(stats.sha256, 'pod-pass'), BINARY);
    await assert.rejects(v.restoreBytes(stats.sha256, 'wrong'));
    await assert.rejects(v.restoreBytes(stats.sha256), /passphrase is required/);
  });
});

test('a pod of non-UTF-8 bytes refuses to be read as text instead of mangling it', async () => {
  await withVault(async (v) => {
    const stats = await v.seal(Uint8Array.from([0x68, 0x69, 0xff, 0xfe, 0x00, 0x80, 0x41]));
    await assert.rejects(v.restore(stats.sha256), /not UTF-8 text; read it with restoreBytes/);
  });
});

test('the same content sealed as text or as bytes lands at the same address', async () => {
  await withVault(async (v) => {
    const asText = await v.seal(BIG);
    const asBytes = await v.seal(new TextEncoder().encode(BIG));
    assert.equal(asBytes.sha256, asText.sha256);
    assert.equal(await v.restore(asBytes.sha256), BIG);
  });
});
