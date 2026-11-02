#!/usr/bin/env node --experimental-strip-types
/**
 * cce — context condenser CLI.
 *
 *   cce dehydrate <file>            seal + condense, print the condensate
 *   cce rehydrate <cnd.json> [--claim N | --full]
 *   cce chain <file>                run the eYe sphere ring
 *   cce condensers [category]       list the catalog
 *   cce stat <sha256>               pod statistics
 *
 * Vault root: $CCE_VAULT, default ./.cce-vault
 * Passphrase: $CCE_PASSPHRASE (never a flag — flags land in shell history)
 */
import { readFile, writeFile } from 'node:fs/promises';
import { CONDENSERS, byCategory, type Category } from '../condensers/index.ts';
import { Vault } from '../vault/vault.ts';
import { dehydrate, rehydrate, summarize } from '../local/condense.ts';
import { dehydrateLlm } from '../llm/condense-llm.ts';
import { runSphere, DEFAULT_RING } from '../eye/sphere.ts';
import type { Condensate } from '../core/condensate.ts';

const VAULT_ROOT = process.env.CCE_VAULT || './.cce-vault';
const PASSPHRASE = process.env.CCE_PASSPHRASE || undefined;

function flag(args: string[], name: string): string | undefined {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? undefined : args[i + 1];
}
function has(args: string[], name: string): boolean {
  return args.includes(`--${name}`);
}

const USAGE = `cce — context condenser

  cce dehydrate <file> [--pipeline id,id] [--density 0.2] [--llm] [--out cnd.json]
  cce rehydrate <cnd.json> [--claim N] [--full]
  cce chain <file> [--out cnd.json]
  cce condensers [semantic|logical|cybernetic|cognitive]
  cce stat <sha256>

env: CCE_VAULT (default ./.cce-vault), CCE_PASSPHRASE (encrypts archives)`;

async function main(argv: string[]) {
  const [cmd, ...args] = argv;
  const vault = new Vault(VAULT_ROOT);

  switch (cmd) {
    case 'dehydrate': {
      const file = args[0];
      if (!file) throw new Error('dehydrate needs a file');
      const text = await readFile(file, 'utf8');
      const pipeline = flag(args, 'pipeline')?.split(',').filter(Boolean);
      const densityRaw = flag(args, 'density');
      const density = densityRaw === undefined ? undefined : Number(densityRaw);
      if (density !== undefined && !Number.isFinite(density)) throw new Error('--density must be a number');

      const opts = { pipeline, density, passphrase: PASSPHRASE };
      let cnd: Condensate;
      if (has(args, 'llm')) {
        const r = await dehydrateLlm(vault, text, opts);
        cnd = r.condensate;
        if (r.fellBackBecause) console.error(`(local tier: ${r.fellBackBecause})`);
        if (r.droppedUnanchored) console.error(`(dropped ${r.droppedUnanchored} unanchored model line(s))`);
      } else {
        cnd = await dehydrate(vault, text, opts);
      }

      const out = flag(args, 'out');
      if (out) {
        await writeFile(out, JSON.stringify(cnd, null, 2) + '\n');
        console.log(`${cnd.id} -> ${out}`);
      }
      console.log(summarize(cnd));
      console.log(`\narchive ${cnd.archive.sha256.slice(0, 12)} (${cnd.archive.bytes} bytes)${cnd.archive.encrypted ? ' encrypted' : ''}`);
      break;
    }

    case 'rehydrate': {
      const file = args[0];
      if (!file) throw new Error('rehydrate needs a condensate json file');
      const cnd = JSON.parse(await readFile(file, 'utf8')) as Condensate;
      const claimRaw = flag(args, 'claim');
      const claims = claimRaw === undefined ? undefined : [Number(claimRaw)];
      const r = await rehydrate(vault, cnd, { claims, full: has(args, 'full'), passphrase: PASSPHRASE });
      console.log(r.text);
      console.error(`\n(${r.spans.length} span(s), ${(r.fraction * 100).toFixed(1)}% of the archive)`);
      break;
    }

    case 'chain': {
      const file = args[0];
      if (!file) throw new Error('chain needs a file');
      const text = await readFile(file, 'utf8');
      const r = await runSphere(vault, DEFAULT_RING, text, { passphrase: PASSPHRASE });
      for (const s of r.steps) {
        console.log(
          `${s.podId.padEnd(10)} ${s.spec.padEnd(14)} resident ${String(s.residentBytes).padStart(7)}B  ` +
          `claims ${s.claimsIn}->${s.claimsOut}  ${s.contracted ? 'condensed' : 'passthrough'}  ${s.durationMs}ms`,
        );
      }
      console.log(`\npeak resident ${r.peakResidentBytes}B of ${r.sourceBytes}B source ` +
                  `(${((r.peakResidentBytes / r.sourceBytes) * 100).toFixed(1)}%)`);
      console.log();
      console.log(summarize(r.compiled));
      const out = flag(args, 'out');
      if (out) await writeFile(out, JSON.stringify(r.compiled, null, 2) + '\n');
      break;
    }

    case 'condensers': {
      const cat = args[0] as Category | undefined;
      const list = cat ? byCategory(cat) : CONDENSERS;
      if (cat && list.length === 0) throw new Error(`no condensers in category "${cat}"`);
      for (const c of list) {
        console.log(`${c.id.padEnd(28)} ${c.category.padEnd(11)} ${c.efficiencyRating.padStart(7)}  ${c.name}`);
      }
      console.log(`\n${list.length} condenser(s)`);
      break;
    }

    case 'stat': {
      const sha = args[0];
      if (!sha) throw new Error('stat needs a sha256');
      const s = await vault.stat(sha);
      console.log(`${s.sha256}\n  original   ${s.bytes} bytes\n  stored     ${s.storedBytes} bytes` +
                  `\n  ratio      ${(s.ratio * 100).toFixed(1)}%\n  frames     ${s.frames}` +
                  `\n  encrypted  ${s.encrypted}`);
      break;
    }

    default:
      console.log(USAGE);
      process.exitCode = cmd ? 1 : 0;
  }
}

main(process.argv.slice(2)).catch((err) => {
  console.error(`cce: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
