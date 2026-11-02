import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Vault } from '../packages/vault/vault.ts';
import { runSphere, traceClaim, DEFAULT_RING, type Pod } from '../packages/eye/sphere.ts';
import { checkCondensate } from '../packages/core/condensate.ts';

const SOURCE = `
Distributed systems reduce single points of failure. Consensus mechanisms trade latency for reliability.
By definition, an invariant must hold across every replica in the cluster. We will adopt eventual consistency for the read path.
Research found that eventual consistency is sufficient for most workloads. However, the risk is that stale reads break the audit trail.
It is unclear whether the audit trail requires linearizability. The plan is to implement the cache layer before the migration.
`.trim().repeat(6);

async function withVault<T>(fn: (v: Vault) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), 'cce-sphere-'));
  try { return await fn(new Vault(dir)); } finally { await rm(dir, { recursive: true, force: true }); }
}

test('the chain runs every pod and compiles a valid condensate', async () => {
  await withVault(async (v) => {
    const r = await runSphere(v, DEFAULT_RING, SOURCE);
    assert.equal(r.steps.length, DEFAULT_RING.length);
    assert.deepEqual(checkCondensate(r.compiled), []);
    assert.equal(r.steps.at(-1)!.podId, 'compiler');
  });
});

test('surface area shrinks along the ring and peaks below the source', async () => {
  await withVault(async (v) => {
    const r = await runSphere(v, DEFAULT_RING, SOURCE);
    const resident = r.steps.map((s) => s.residentBytes);
    assert.equal(resident[0], r.sourceBytes, 'pod 1 reads the source');
    assert.ok(resident[1] < resident[0], 'pod 2 must read less than the source');
    assert.equal(r.peakResidentBytes, r.sourceBytes, 'peak is the first pod, never a sum of pods');
    assert.ok(
      resident.slice(1).every((b) => b < r.sourceBytes),
      'no later pod may hold as much as the source',
    );
  });
});

test('the ring is linked: each pod either condenses its predecessor or passes it through', async () => {
  await withVault(async (v) => {
    const r = await runSphere(v, DEFAULT_RING, SOURCE);

    assert.equal(r.steps[0].claimsIn, 0, 'the first pod has no predecessor');
    assert.ok(r.steps[1].claimsIn > 0, 'later pods receive claims from the one before');

    // A pod that contracted must be a NEW condensate naming its predecessor as
    // a child; a pod at the contraction floor passes the same condensate on.
    for (let i = 1; i < r.steps.length; i++) {
      const prev = r.steps[i - 1];
      const step = r.steps[i];
      if (step.contracted) {
        assert.notEqual(step.condensateId, prev.condensateId, `pod ${step.podId} should be new`);
      } else {
        assert.equal(step.condensateId, prev.condensateId, `pod ${step.podId} should pass through`);
      }
    }

    assert.equal(r.compiled.id, r.steps.at(-1)!.condensateId, 'the compiler holds the final condensate');
  });
});

test('the first pod always condenses, and its output names no predecessor', async () => {
  await withVault(async (v) => {
    const r = await runSphere(v, DEFAULT_RING, SOURCE);
    assert.equal(r.steps[0].contracted, true);
    assert.deepEqual(r.steps[0].claimsIn, 0);
  });
});

test('a compiled claim still traces back to real source bytes', async () => {
  await withVault(async (v) => {
    const r = await runSphere(v, DEFAULT_RING, SOURCE);
    const traced = await traceClaim(v, r.compiled, 0);
    assert.ok(traced.length > 0, 'trace must return text');
  });
});

test('a pod over its byte budget halts the chain instead of silently swelling', async () => {
  await withVault(async (v) => {
    const tight: Pod[] = [{ id: 'tiny', spec: 'baseline', pipeline: ['gist_core'], budgetBytes: 64 }];
    await assert.rejects(() => runSphere(v, tight, SOURCE), /over its 64-byte budget/);
  });
});

test('the chain works end to end with an encrypted vault', async () => {
  await withVault(async (v) => {
    const r = await runSphere(v, DEFAULT_RING, SOURCE, { passphrase: 'sphere-key' });
    assert.equal(r.compiled.archive.encrypted, true);
    const traced = await traceClaim(v, r.compiled, 0, 'sphere-key');
    assert.ok(traced.length > 0);
  });
});

test('an empty chain is refused', async () => {
  await withVault(async (v) => {
    await assert.rejects(() => runSphere(v, [], SOURCE), /at least one pod/);
  });
});
