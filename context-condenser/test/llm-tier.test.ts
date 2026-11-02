import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Vault } from '../packages/vault/vault.ts';
import { dehydrateLlm } from '../packages/llm/condense-llm.ts';
import { ProviderChain } from '../packages/providers/provider.ts';
import { checkCondensate } from '../packages/core/condensate.ts';
import { rehydrate } from '../packages/local/condense.ts';

const DOC = 'Consensus mechanisms trade latency for reliability. Eventual consistency is sufficient for most workloads. The audit trail requires stronger guarantees than the read path.';

async function withVault<T>(fn: (v: Vault) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), 'cce-llm-'));
  try { return await fn(new Vault(dir)); } finally { await rm(dir, { recursive: true, force: true }); }
}

/** A provider chain that returns canned text without touching the network. */
function fakeChain(text: string | null): ProviderChain {
  const chain = new ProviderChain({});
  Object.defineProperty(chain, 'configured', { get: () => true });
  chain.complete = async () => (text === null ? null : { text, provider: 'fake' });
  return chain;
}

test('with no provider configured it falls back to local and says so', async () => {
  await withVault(async (v) => {
    const r = await dehydrateLlm(v, DOC, { chain: new ProviderChain({}) });
    assert.equal(r.condensate.tier, 'local');
    assert.equal(r.fellBackBecause, 'no provider configured');
    assert.deepEqual(checkCondensate(r.condensate), []);
  });
});

test('a provider failure falls back to local rather than throwing', async () => {
  await withVault(async (v) => {
    const r = await dehydrateLlm(v, DOC, { chain: fakeChain(null) });
    assert.equal(r.condensate.tier, 'local');
    assert.match(r.fellBackBecause!, /providers failed/);
  });
});

test('anchored model output produces an llm-tier condensate that still rehydrates', async () => {
  await withVault(async (v) => {
    const chain = fakeChain('Consensus trades latency for reliability.\nEventual consistency suffices for most workloads.');
    const r = await dehydrateLlm(v, DOC, { chain });
    assert.equal(r.condensate.tier, 'llm');
    assert.equal(r.condensate.claims.length, 2);
    assert.deepEqual(checkCondensate(r.condensate), []);

    const back = await rehydrate(v, r.condensate, { claims: [0] });
    assert.ok(DOC.includes(back.text.trim()), 'anchor must resolve to real source text');
  });
});

test('untraceable model lines are dropped, not kept unanchored', async () => {
  await withVault(async (v) => {
    const chain = fakeChain('Consensus trades latency for reliability.\nQuarterly revenue grew by forty percent in Brazil.');
    const r = await dehydrateLlm(v, DOC, { chain });
    assert.equal(r.droppedUnanchored, 1, 'the fabricated line must be dropped');
    assert.equal(r.condensate.claims.length, 1);
    assert.deepEqual(checkCondensate(r.condensate), []);
  });
});

test('if nothing anchors, the local condensate is returned instead of an empty one', async () => {
  await withVault(async (v) => {
    const chain = fakeChain('Entirely unrelated sentence about marine biology and coral reefs.');
    const r = await dehydrateLlm(v, DOC, { chain });
    assert.equal(r.condensate.tier, 'local');
    assert.match(r.fellBackBecause!, /could be anchored/);
    assert.ok(r.condensate.claims.length > 0);
  });
});

test('no provider is constructed from an empty environment', () => {
  const chain = new ProviderChain({});
  assert.equal(chain.configured, false);
  assert.equal(chain.providers.length, 0);
});
