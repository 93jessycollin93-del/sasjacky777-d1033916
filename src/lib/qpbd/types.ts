// QPBD — Quantum Pod Border Database
// Zero-loss matrix format. Every pod in Jackie is a QPBD Matrix with
// four layers: Q (resonant metadata), P (sovereign identity),
// B (border/handshake log), D (CRDT payload).

export type Carrier = "light" | "sound" | "both";

export interface QLayer {
  createdAt: number;
  phase: number;          // 0..2π
  lightFreq: number;      // THz
  soundHarmonic: number;  // Hz
  emotionalWeight: number; // -1..1
  intent?: string;
  phaseLock?: string;
}

export interface PLayer {
  podId: string;
  vaultId: string;
  ownerKey: string;
  lineage: string[];      // ancestor podIds
}

export interface BorderTouch {
  touchedPodId: string;
  timestamp: number;
  carrierUsed: Carrier;
  deltaHash: string;
  gainSeed: number;       // % gained on this merge
}

export interface BLayer {
  borderLog: BorderTouch[];
}

export type PayloadKind = "note" | "theme" | "file" | "state";

export interface DLayer {
  type: PayloadKind;
  crdtDelta: Uint8Array;   // Yjs update bytes (zero-loss)
  compressedBlob?: string; // optional LZ-compressed snapshot
  growthSeed?: number;     // accumulated gain%
}

export interface QPBDMatrix {
  version: 1;
  q: QLayer;
  p: PLayer;
  b: BLayer;
  d: DLayer;
}
