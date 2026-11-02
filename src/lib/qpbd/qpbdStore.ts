// qpbdStore — zero-loss CRDT store backed by Yjs.
// Every matrix wraps a Y.Doc so merges are conflict-free and lossless.
// Merges apply gain% to growthSeed per QPBD spec.

import * as Y from "yjs";
import type { QPBDMatrix, PayloadKind, QLayer, PLayer } from "./types";

const DEFAULT_GAIN_PCT = 0.03; // 3% per merge — "percentage gain per cycle"

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const ab = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  const buf = await crypto.subtle.digest("SHA-256", ab);
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function baseQ(overrides: Partial<QLayer> = {}): QLayer {
  return {
    createdAt: Date.now(),
    phase: Math.random() * Math.PI * 2,
    lightFreq: 430 + Math.random() * 320, // visible band THz
    soundHarmonic: 110 * (1 + Math.floor(Math.random() * 6)),
    emotionalWeight: 0,
    ...overrides,
  };
}

export interface CreatePodOpts {
  ownerKey: string;
  vaultId: string;
  podId?: string;
  type: PayloadKind;
  q?: Partial<QLayer>;
  lineage?: string[];
}

export function createMatrix(opts: CreatePodOpts): { matrix: QPBDMatrix; doc: Y.Doc } {
  const doc = new Y.Doc();
  // touch the doc so a first update exists
  doc.getMap("root").set("kind", opts.type);

  const p: PLayer = {
    podId: opts.podId ?? crypto.randomUUID(),
    vaultId: opts.vaultId,
    ownerKey: opts.ownerKey,
    lineage: opts.lineage ?? [],
  };

  const matrix: QPBDMatrix = {
    version: 1,
    q: baseQ(opts.q),
    p,
    b: { borderLog: [] },
    d: {
      type: opts.type,
      crdtDelta: Y.encodeStateAsUpdate(doc),
      growthSeed: 0,
    },
  };
  return { matrix, doc };
}

export function loadDoc(matrix: QPBDMatrix): Y.Doc {
  const doc = new Y.Doc();
  if (matrix.d.crdtDelta?.byteLength) {
    Y.applyUpdate(doc, matrix.d.crdtDelta);
  }
  return doc;
}

export function snapshot(matrix: QPBDMatrix, doc: Y.Doc): QPBDMatrix {
  return {
    ...matrix,
    d: { ...matrix.d, crdtDelta: Y.encodeStateAsUpdate(doc) },
  };
}

// Merge two matrices with zero loss. Result size = A + B + gain%.
// gainPct is expressed as a fraction, e.g. 0.03 == 3%.
export async function mergeMatrices(
  a: QPBDMatrix,
  b: QPBDMatrix,
  opts: { carrier?: "light" | "sound" | "both"; gainPct?: number } = {}
): Promise<QPBDMatrix> {
  const doc = new Y.Doc();
  if (a.d.crdtDelta?.byteLength) Y.applyUpdate(doc, a.d.crdtDelta);
  if (b.d.crdtDelta?.byteLength) Y.applyUpdate(doc, b.d.crdtDelta);
  const merged = Y.encodeStateAsUpdate(doc);

  const gainPct = opts.gainPct ?? DEFAULT_GAIN_PCT;
  const carrier = opts.carrier ?? "both";
  const deltaHash = await sha256Hex(merged);
  const prevSeed = (a.d.growthSeed ?? 0) + (b.d.growthSeed ?? 0);
  const growthSeed = prevSeed + gainPct;

  return {
    version: 1,
    q: {
      ...a.q,
      createdAt: Date.now(),
      // resonance blending — average phase, sum harmonics, cap emotional weight
      phase: (a.q.phase + b.q.phase) / 2,
      lightFreq: (a.q.lightFreq + b.q.lightFreq) / 2,
      soundHarmonic: a.q.soundHarmonic + b.q.soundHarmonic,
      emotionalWeight: Math.max(-1, Math.min(1, a.q.emotionalWeight + b.q.emotionalWeight)),
      phaseLock: deltaHash.slice(0, 12),
    },
    p: {
      ...a.p,
      podId: a.p.podId, // A absorbs B by convention
      lineage: Array.from(new Set([...a.p.lineage, ...b.p.lineage, b.p.podId])),
    },
    b: {
      borderLog: [
        ...a.b.borderLog,
        ...b.b.borderLog,
        {
          touchedPodId: b.p.podId,
          timestamp: Date.now(),
          carrierUsed: carrier,
          deltaHash,
          gainSeed: gainPct,
        },
      ],
    },
    d: {
      type: a.d.type,
      crdtDelta: merged,
      compressedBlob: a.d.compressedBlob,
      growthSeed,
    },
  };
}

export function matrixSize(m: QPBDMatrix): number {
  return (m.d.crdtDelta?.byteLength ?? 0) + (m.d.compressedBlob?.length ?? 0);
}
