import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Vault } from '../packages/vault/vault.ts';
import { dehydrate, rehydrate } from '../packages/local/condense.ts';
import { checkCondensate } from '../packages/core/condensate.ts';

const DOC = `
Distributed systems reduce single points of failure. Consensus mechanisms trade latency for reliability, which is a real tradeoff.
By definition, an invariant must hold across every replica. We will adopt eventual consistency for the read path.
Research found that eventual consistency is sufficient for most workloads. However, the risk is that stale reads break the audit trail.
It is unclear whether the audit trail requires linearizability. Should we migrate the ledger first?
The plan is to implement the cache layer before the migration. Ünïcödé ✓ survives the round trip.
`.trim();

async function withVault<T>(fn: (v: Vault) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), 'cce-cnd-'));
  try { return await fn(new Vault(dir)); } finally { await rm(dir, { recursive: true, force: true }); }
}

test('dehydrate produces a valid, anchored condensate', async () => {
  await withVault(async (v) => {
    const cnd = await dehydrate(v, DOC);
    assert.deepEqual(checkCondensate(cnd), []);
    assert.ok(cnd.claims.length > 0, 'should keep some claims');
    assert.ok(cnd.density < 1, `density ${cnd.density} should be below 1`);
    assert.equal(cnd.tier, 'local');
  });
});

test('every anchor rehydrates to the exact source text of its claim', async () => {
  await withVault(async (v) => {
    const cnd = await dehydrate(v, DOC);
    for (let i = 0; i < cnd.claims.length; i++) {
      const { text } = await rehydrate(v, cnd, { claims: [i] });
      assert.equal(text, cnd.claims[i].text, `claim ${i} must rehydrate verbatim`);
    }
  });
});

test('full rehydration returns the original byte-for-byte', async () => {
  await withVault(async (v) => {
    const cnd = await dehydrate(v, DOC);
    const { text, fraction } = await rehydrate(v, cnd, { full: true });
    assert.equal(text, DOC);
    assert.equal(fraction, 1);
  });
});

test('partial rehydration reads a fraction of the archive', async () => {
  await withVault(async (v) => {
    const cnd = await dehydrate(v, DOC, { density: 0.2 });
    const one = await rehydrate(v, cnd, { claims: [0] });
    assert.ok(one.fraction < 0.5, `single-claim read took ${one.fraction} of the archive`);
  });
});

test('denser pipelines keep strictly less', async () => {
  await withVault(async (v) => {
    const loose = await dehydrate(v, DOC, { density: 0.9 });
    const tight = await dehydrate(v, DOC, { density: 0.15 });
    assert.ok(tight.density < loose.density, `${tight.density} should be < ${loose.density}`);
  });
});

test('tensions, questions and entities are extracted', async () => {
  await withVault(async (v) => {
    const cnd = await dehydrate(v, DOC);
    assert.ok(cnd.tensions.some((t) => t.a === 'latency' || t.b === 'reliability'), 'latency/reliability tension');
    assert.ok(cnd.openQuestions.length > 0, 'should find open questions');
    assert.ok(cnd.entities.length > 0, 'should find entities');
  });
});

test('encrypted dehydration still rehydrates with the passphrase, and not without', async () => {
  await withVault(async (v) => {
    const cnd = await dehydrate(v, DOC, { passphrase: 'sphere' });
    assert.equal(cnd.archive.encrypted, true);
    const { text } = await rehydrate(v, cnd, { full: true, passphrase: 'sphere' });
    assert.equal(text, DOC);
    await assert.rejects(() => rehydrate(v, cnd, { full: true }), /passphrase is required/);
  });
});

test('an unknown condenser id fails fast', async () => {
  await withVault(async (v) => {
    await assert.rejects(() => dehydrate(v, DOC, { pipeline: ['not_a_condenser'] }), /unknown condenser/);
  });
});

test('an empty document produces a valid condensate', async () => {
  await withVault(async (v) => {
    const cnd = await dehydrate(v, '');
    assert.deepEqual(checkCondensate(cnd), []);
    assert.equal((await rehydrate(v, cnd, { full: true })).text, '');
  });
});
