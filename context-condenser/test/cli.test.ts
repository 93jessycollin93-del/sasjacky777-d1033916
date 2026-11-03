import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

const run = promisify(execFile);
const CCE = new URL('../packages/cli/cce.ts', import.meta.url).pathname;

async function cce(dir: string, ...args: string[]) {
  return run(process.execPath, ['--experimental-strip-types', CCE, ...args], {
    env: { ...process.env, CCE_VAULT: join(dir, 'vault'), CCE_PASSPHRASE: '' },
    encoding: 'buffer',
  });
}

test('cce seal then cce restore gives back a binary file byte for byte', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'cce-cli-'));
  try {
    const original = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0xff, 0xfe, 0x00, 0x80]);
    await writeFile(join(dir, 'in.bin'), original);
    const sealed = await cce(dir, 'seal', join(dir, 'in.bin'));
    const sha = sealed.stdout.toString().split('\n')[0].trim();
    assert.match(sha, /^[0-9a-f]{64}$/);

    await cce(dir, 'restore', sha, '--out', join(dir, 'out.bin'));
    assert.deepEqual(await readFile(join(dir, 'out.bin')), original);

    const piped = await cce(dir, 'restore', sha);
    assert.deepEqual(piped.stdout, original, 'restore without --out writes the raw bytes to stdout');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('cce dehydrate refuses a file that is not UTF-8 text rather than condensing replaced bytes', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'cce-cli-'));
  try {
    await writeFile(join(dir, 'in.bin'), Buffer.from([0x68, 0x69, 0xff, 0xfe]));
    await assert.rejects(cce(dir, 'dehydrate', join(dir, 'in.bin')), (e: { stderr: Buffer }) => {
      assert.match(e.stderr.toString(), /is not UTF-8 text, so it cannot be condensed; `cce seal/);
      return true;
    });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
