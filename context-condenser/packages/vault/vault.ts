/**
 * @cce/vault — content-addressed, frame-chunked, optionally encrypted archive.
 *
 * A pod is NOT one compressed blob. The plaintext is cut into fixed-size
 * frames, each compressed (and sealed) independently, with an index recording
 * which original byte range each frame covers.
 *
 * That is what makes span rehydration cheap: pulling claim bytes [4210, 4655]
 * out of a 200 MB pod reads and inflates one 64 KB frame, not 200 MB. This is
 * the "reduce surface area" property — a reader only ever materialises the
 * region it asked for, and an encrypted pod only ever exposes that region's
 * plaintext to memory.
 *
 * Container layout:
 *   magic "EYEPOD01" (8B) | headerLen uint32BE (4B) | header JSON | frames…
 */
import { open, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { gzipEncode, gzipDecode } from './codecs.ts';
import { deriveKey, newKdfParams, openFrame, sealFrame, sha256Hex, type KdfParams } from './crypto.ts';

const MAGIC = Buffer.from('EYEPOD01', 'ascii');
const HEADER_LEN_BYTES = 4;
export const DEFAULT_FRAME_SIZE = 64 * 1024;

interface FrameIndex {
  /** Byte range of the ORIGINAL plaintext this frame covers: [start, end). */
  start: number;
  end: number;
  /** Stored (compressed, possibly sealed) length in the container. */
  clen: number;
  /** Base64 IV, present only when the pod is encrypted. */
  iv?: string;
}

interface PodHeader {
  v: 1;
  sha256: string;
  bytes: number;
  codec: 'gzip' | 'raw';
  encrypted: boolean;
  kdf?: KdfParams;
  frameSize: number;
  frames: FrameIndex[];
}

export interface SealOptions {
  frameSize?: number;
  /** Supplying a passphrase encrypts every frame with AES-256-GCM. */
  passphrase?: string;
  codec?: 'gzip' | 'raw';
}

export interface PodStats {
  sha256: string;
  bytes: number;
  storedBytes: number;
  ratio: number;
  frames: number;
  encrypted: boolean;
}

/** Where a digest lives inside the vault root — sharded to keep dirs small. */
export function podPath(root: string, sha256: string): string {
  return join(root, sha256.slice(0, 2), `${sha256}.pod`);
}

export function podRef(sha256: string): string {
  return `pod://vault/${sha256}`;
}

export class Vault {
  readonly root: string;

  constructor(root: string) {
    this.root = root;
  }

  /**
   * Seal plaintext into a pod. Returns the digest of the ORIGINAL bytes —
   * content addressing is over plaintext, so the same source always lands at
   * the same address whether or not it was encrypted.
   */
  async seal(text: string, opts: SealOptions = {}): Promise<PodStats> {
    const frameSize = opts.frameSize ?? DEFAULT_FRAME_SIZE;
    const codec = opts.codec ?? 'gzip';
    if (frameSize <= 0) throw new Error('frameSize must be positive');

    const plain = new TextEncoder().encode(text);
    const sha256 = await sha256Hex(plain);

    const encrypted = Boolean(opts.passphrase);
    const kdf = encrypted ? newKdfParams() : undefined;
    const key = encrypted ? await deriveKey(opts.passphrase!, kdf!) : null;

    const frames: FrameIndex[] = [];
    const chunks: Uint8Array[] = [];

    for (let start = 0; start < plain.length; start += frameSize) {
      const end = Math.min(start + frameSize, plain.length);
      const packed = codec === 'gzip' ? gzipEncode(plain.subarray(start, end)) : plain.subarray(start, end);
      if (key) {
        const { data, iv } = await sealFrame(key, packed);
        frames.push({ start, end, clen: data.length, iv });
        chunks.push(data);
      } else {
        frames.push({ start, end, clen: packed.length });
        chunks.push(packed);
      }
    }

    // An empty source still gets a pod, so an empty condensate stays valid.
    if (frames.length === 0) frames.push({ start: 0, end: 0, clen: 0 });

    const header: PodHeader = {
      v: 1, sha256, bytes: plain.length, codec, encrypted, kdf, frameSize, frames,
    };
    const headerJson = Buffer.from(JSON.stringify(header), 'utf8');
    const headerLen = Buffer.alloc(HEADER_LEN_BYTES);
    headerLen.writeUInt32BE(headerJson.length, 0);

    const body = Buffer.concat([MAGIC, headerLen, headerJson, ...chunks.map((c) => Buffer.from(c))]);
    const path = podPath(this.root, sha256);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, body);

    return {
      sha256,
      bytes: plain.length,
      storedBytes: body.length,
      ratio: plain.length === 0 ? 1 : body.length / plain.length,
      frames: frames.length,
      encrypted,
    };
  }

  private async readHeader(sha256: string): Promise<{ header: PodHeader; dataStart: number; path: string }> {
    const path = podPath(this.root, sha256);
    const fh = await open(path, 'r');
    try {
      const prefix = Buffer.alloc(MAGIC.length + HEADER_LEN_BYTES);
      await fh.read(prefix, 0, prefix.length, 0);
      if (!prefix.subarray(0, MAGIC.length).equals(MAGIC)) {
        throw new Error(`${path} is not an eYe pod (bad magic)`);
      }
      const headerLen = prefix.readUInt32BE(MAGIC.length);
      const headerBuf = Buffer.alloc(headerLen);
      await fh.read(headerBuf, 0, headerLen, prefix.length);
      const header = JSON.parse(headerBuf.toString('utf8')) as PodHeader;
      if (header.v !== 1) throw new Error(`unsupported pod version ${header.v}`);
      return { header, dataStart: prefix.length + headerLen, path };
    } finally {
      await fh.close();
    }
  }

  async stat(sha256: string): Promise<PodStats> {
    const { header, path } = await this.readHeader(sha256);
    const stored = (await readFile(path)).length;
    return {
      sha256: header.sha256,
      bytes: header.bytes,
      storedBytes: stored,
      ratio: header.bytes === 0 ? 1 : stored / header.bytes,
      frames: header.frames.length,
      encrypted: header.encrypted,
    };
  }

  /**
   * Read one byte span of the original plaintext.
   *
   * Only the frames overlapping [start, end) are read off disk, decrypted and
   * inflated. Everything else in the pod stays sealed and untouched.
   */
  async readSpan(sha256: string, start: number, end: number, passphrase?: string): Promise<string> {
    const { header, dataStart, path } = await this.readHeader(sha256);

    if (start < 0 || end < start) throw new Error(`invalid span [${start}, ${end}]`);
    const clampedEnd = Math.min(end, header.bytes);
    if (start >= header.bytes) return '';

    const key = header.encrypted ? await deriveKey(requirePass(passphrase), header.kdf!) : null;

    // Frame offsets are cumulative; walk the index rather than storing them.
    let offset = dataStart;
    const pieces: Uint8Array[] = [];
    const fh = await open(path, 'r');
    try {
      for (const frame of header.frames) {
        const frameOffset = offset;
        offset += frame.clen;

        if (frame.end <= start || frame.start >= clampedEnd) continue; // untouched

        const raw = Buffer.alloc(frame.clen);
        await fh.read(raw, 0, frame.clen, frameOffset);

        const unsealed = key ? await openFrame(key, new Uint8Array(raw), frame.iv!) : new Uint8Array(raw);
        const plain = header.codec === 'gzip' ? gzipDecode(unsealed) : unsealed;

        const from = Math.max(start, frame.start) - frame.start;
        const to = Math.min(clampedEnd, frame.end) - frame.start;
        pieces.push(plain.subarray(from, to));
      }
    } finally {
      await fh.close();
    }

    return new TextDecoder().decode(Buffer.concat(pieces.map((p) => Buffer.from(p))));
  }

  /** Full restore, with an integrity check against the stored digest. */
  async restore(sha256: string, passphrase?: string): Promise<string> {
    const { header } = await this.readHeader(sha256);
    const text = await this.readSpan(sha256, 0, header.bytes, passphrase);
    const actual = await sha256Hex(new TextEncoder().encode(text));
    if (actual !== header.sha256) {
      throw new Error(`integrity check failed for ${sha256}: restored bytes hash to ${actual}`);
    }
    return text;
  }

  /** How many frames a span would touch — the surface area of a read. */
  async surfaceArea(sha256: string, start: number, end: number): Promise<{ frames: number; of: number; bytes: number }> {
    const { header } = await this.readHeader(sha256);
    const touched = header.frames.filter((f) => !(f.end <= start || f.start >= end));
    return {
      frames: touched.length,
      of: header.frames.length,
      bytes: touched.reduce((n, f) => n + f.clen, 0),
    };
  }
}

function requirePass(p: string | undefined): string {
  if (!p) throw new Error('this pod is encrypted — a passphrase is required to read it');
  return p;
}
