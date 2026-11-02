#!/usr/bin/env node --experimental-strip-types
/**
 * MCP server over stdio — exposes the engine to any agent that speaks MCP.
 *
 * This is the surface that makes the whole thing useful day to day: an agent
 * running low on context can dehydrate its own transcript, keep working from
 * the condensate, and rehydrate individual claims on demand instead of
 * reloading the entire history.
 *
 * JSON-RPC 2.0, newline-delimited, no dependencies.
 */
import { CONDENSERS, byCategory, type Category } from '../condensers/index.ts';
import { Vault } from '../vault/vault.ts';
import { dehydrate, rehydrate, summarize } from '../local/condense.ts';
import { dehydrateLlm } from '../llm/condense-llm.ts';
import { runSphere, DEFAULT_RING } from '../eye/sphere.ts';
import type { Condensate } from '../core/condensate.ts';

const VAULT = new Vault(process.env.CCE_VAULT || './.cce-vault');
const PASSPHRASE = process.env.CCE_PASSPHRASE || undefined;
const PROTOCOL_VERSION = '2024-11-05';

const TOOLS = [
  {
    name: 'dehydrate',
    description:
      'Condense text into an anchored condensate and seal the original losslessly. ' +
      'Returns the condensate JSON; every claim carries a byte span that can be rehydrated later.',
    inputSchema: {
      type: 'object',
      properties: {
        text: { type: 'string', description: 'The text to condense.' },
        pipeline: { type: 'array', items: { type: 'string' }, description: 'Condenser ids to apply in order.' },
        density: { type: 'number', description: 'Target output/input byte ratio, 0..1.' },
        useLlm: { type: 'boolean', description: 'Use the LLM tier if a provider is configured.' },
      },
      required: ['text'],
    },
  },
  {
    name: 'rehydrate',
    description:
      'Recover original source text from a condensate. Give claim indices to restore only those ' +
      'claims (cheap), or full=true for the entire original.',
    inputSchema: {
      type: 'object',
      properties: {
        condensate: { type: 'object', description: 'A condensate previously returned by dehydrate.' },
        claims: { type: 'array', items: { type: 'number' }, description: 'Claim indices to restore.' },
        full: { type: 'boolean', description: 'Restore the complete original.' },
      },
      required: ['condensate'],
    },
  },
  {
    name: 'list_condensers',
    description: 'List the 30 condenser presets, optionally filtered by category.',
    inputSchema: {
      type: 'object',
      properties: {
        category: { type: 'string', enum: ['semantic', 'logical', 'cybernetic', 'cognitive'] },
      },
    },
  },
  {
    name: 'run_sphere',
    description:
      'Run the eYe pod ring over text: pods condense sequentially, one resident at a time, ' +
      'each handing an anchored condensate to the next. Returns the compiled condensate and surface-area stats.',
    inputSchema: {
      type: 'object',
      properties: { text: { type: 'string' } },
      required: ['text'],
    },
  },
];

function text(content: string) {
  return { content: [{ type: 'text', text: content }] };
}

async function callTool(name: string, args: Record<string, any>) {
  switch (name) {
    case 'dehydrate': {
      if (typeof args.text !== 'string') throw new Error('dehydrate requires "text"');
      const opts = { pipeline: args.pipeline, density: args.density, passphrase: PASSPHRASE };
      if (args.useLlm) {
        const r = await dehydrateLlm(VAULT, args.text, opts);
        return text(
          `${summarize(r.condensate)}\n\n` +
          (r.fellBackBecause ? `note: local tier used (${r.fellBackBecause})\n` : '') +
          JSON.stringify(r.condensate),
        );
      }
      const cnd = await dehydrate(VAULT, args.text, opts);
      return text(`${summarize(cnd)}\n\n${JSON.stringify(cnd)}`);
    }

    case 'rehydrate': {
      const cnd = args.condensate as Condensate;
      if (!cnd || typeof cnd !== 'object') throw new Error('rehydrate requires "condensate"');
      const r = await rehydrate(VAULT, cnd, {
        claims: args.claims, full: args.full, passphrase: PASSPHRASE,
      });
      return text(`${r.text}\n\n--- ${r.spans.length} span(s), ${(r.fraction * 100).toFixed(1)}% of archive`);
    }

    case 'list_condensers': {
      const list = args.category ? byCategory(args.category as Category) : CONDENSERS;
      return text(list.map((c) => `${c.id} [${c.category}] ${c.efficiencyRating} — ${c.name}: ${c.description}`).join('\n'));
    }

    case 'run_sphere': {
      if (typeof args.text !== 'string') throw new Error('run_sphere requires "text"');
      const r = await runSphere(VAULT, DEFAULT_RING, args.text, { passphrase: PASSPHRASE });
      const table = r.steps
        .map((s) => `${s.podId}\t${s.residentBytes}B\t${s.claimsIn}->${s.claimsOut}\t${s.contracted ? 'condensed' : 'passthrough'}`)
        .join('\n');
      return text(
        `${table}\n\npeak resident ${r.peakResidentBytes}B of ${r.sourceBytes}B\n\n` +
        `${summarize(r.compiled)}\n\n${JSON.stringify(r.compiled)}`,
      );
    }

    default:
      throw new Error(`unknown tool "${name}"`);
  }
}

async function handle(msg: any): Promise<any | null> {
  const { id, method, params } = msg;
  const reply = (result: any) => ({ jsonrpc: '2.0', id, result });

  try {
    switch (method) {
      case 'initialize':
        return reply({
          protocolVersion: PROTOCOL_VERSION,
          capabilities: { tools: {} },
          serverInfo: { name: 'context-condenser', version: '0.1.0' },
        });
      case 'notifications/initialized':
        return null; // notification, no response
      case 'tools/list':
        return reply({ tools: TOOLS });
      case 'tools/call':
        return reply(await callTool(params?.name, params?.arguments ?? {}));
      case 'ping':
        return reply({});
      default:
        if (id === undefined) return null;
        return { jsonrpc: '2.0', id, error: { code: -32601, message: `method not found: ${method}` } };
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // Tool errors are reported in-band so the agent can react, not as transport failures.
    if (method === 'tools/call') return reply({ content: [{ type: 'text', text: `error: ${message}` }], isError: true });
    return { jsonrpc: '2.0', id, error: { code: -32603, message } };
  }
}

let buffer = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', async (chunk) => {
  buffer += chunk;
  let nl: number;
  while ((nl = buffer.indexOf('\n')) !== -1) {
    const line = buffer.slice(0, nl).trim();
    buffer = buffer.slice(nl + 1);
    if (!line) continue;
    let msg: any;
    try {
      msg = JSON.parse(line);
    } catch {
      process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'parse error' } }) + '\n');
      continue;
    }
    const res = await handle(msg);
    if (res) process.stdout.write(JSON.stringify(res) + '\n');
  }
});
