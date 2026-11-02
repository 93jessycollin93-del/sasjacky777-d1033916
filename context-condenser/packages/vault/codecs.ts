/**
 * Reversible codecs. Every codec here round-trips exactly — that is the
 * entire point of this layer, and every one of them is tested both ways.
 *
 * LZW and RLE are carried over from logbook-curator's lib/compression.ts,
 * which held the only genuinely reversible code in the old fleet.
 */
import { gzipSync, gunzipSync } from 'node:zlib';

export type CodecName = 'gzip' | 'raw';

export function gzipEncode(data: Uint8Array): Uint8Array {
  return new Uint8Array(gzipSync(data, { level: 9 }));
}

export function gzipDecode(data: Uint8Array): Uint8Array {
  return new Uint8Array(gunzipSync(data));
}

export function encode(codec: CodecName, data: Uint8Array): Uint8Array {
  return codec === 'gzip' ? gzipEncode(data) : data;
}

export function decode(codec: CodecName, data: Uint8Array): Uint8Array {
  return codec === 'gzip' ? gzipDecode(data) : data;
}

/**
 * LZW over UTF-8 BYTES, base64-wrapped.
 *
 * Operating on bytes rather than UTF-16 code units is load-bearing: the
 * dictionary is seeded with 0..255, so running it over characters silently
 * maps anything above U+00FF to code 0 and destroys it. (The original fleet
 * code had exactly this bug — "✓" came back as a null byte.) Encoding to
 * UTF-8 first makes every input symbol a real dictionary entry.
 */
const MAX_CODE = 0xffffff; // codes are packed into 3 bytes

function bytesToBinaryString(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return s;
}

export function lzwCompress(input: string): string {
  const binary = bytesToBinaryString(new TextEncoder().encode(input));
  const dict = new Map<string, number>();
  for (let i = 0; i < 256; i++) dict.set(String.fromCharCode(i), i);

  let phrase = '';
  const out: number[] = [];
  let code = 256;

  for (const ch of binary) {
    const next = phrase + ch;
    if (dict.has(next)) { phrase = next; continue; }
    out.push(dict.get(phrase)!);
    if (code <= MAX_CODE) dict.set(next, code++);
    phrase = ch;
  }
  if (phrase !== '') out.push(dict.get(phrase)!);

  const buf = new Uint8Array(out.length * 3);
  out.forEach((c, i) => {
    buf[i * 3] = c >> 16;
    buf[i * 3 + 1] = (c >> 8) & 255;
    buf[i * 3 + 2] = c & 255;
  });
  return Buffer.from(buf).toString('base64');
}

export function lzwDecompress(b64: string): string {
  const buf = Buffer.from(b64, 'base64');
  const codes: number[] = [];
  for (let i = 0; i + 2 < buf.length; i += 3) {
    codes.push((buf[i] << 16) | (buf[i + 1] << 8) | buf[i + 2]);
  }
  if (codes.length === 0) return '';

  const dict = new Map<number, string>();
  for (let i = 0; i < 256; i++) dict.set(i, String.fromCharCode(i));
  let next = 256;

  let prev = dict.get(codes[0]);
  if (prev === undefined) throw new Error('corrupt LZW stream: unknown initial code');
  let out = prev;

  for (let i = 1; i < codes.length; i++) {
    const code = codes[i];
    let entry: string;
    if (dict.has(code)) entry = dict.get(code)!;
    else if (code === next) entry = prev + prev[0];
    else throw new Error(`corrupt LZW stream: code ${code} out of range`);
    out += entry;
    if (next <= MAX_CODE) dict.set(next++, prev + entry[0]);
    prev = entry;
  }

  const bytes = new Uint8Array(out.length);
  for (let i = 0; i < out.length; i++) bytes[i] = out.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}
