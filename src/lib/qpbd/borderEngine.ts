// borderEngine — detects pod proximity/intersection and fires onBorderTouch.
// "Proximity" here is resonance distance in the Q layer, not physical.
// Consumers register pods; the engine emits a touch event whenever two
// pods fall within the configured resonance threshold.

import type { QPBDMatrix, Carrier } from "./types";

export interface BorderTouchEvent {
  a: QPBDMatrix;
  b: QPBDMatrix;
  distance: number;
  carrier: Carrier;
  at: number;
}

export type BorderListener = (e: BorderTouchEvent) => void;

// Normalize each Q dimension then compute euclidean distance.
export function resonanceDistance(a: QPBDMatrix, b: QPBDMatrix): number {
  const dPhase = Math.abs(a.q.phase - b.q.phase) / (Math.PI * 2);
  const dLight = Math.abs(a.q.lightFreq - b.q.lightFreq) / 800;
  const dSound = Math.abs(a.q.soundHarmonic - b.q.soundHarmonic) / 2000;
  const dEmo = Math.abs(a.q.emotionalWeight - b.q.emotionalWeight) / 2;
  return Math.sqrt(dPhase ** 2 + dLight ** 2 + dSound ** 2 + dEmo ** 2);
}

function pickCarrier(a: QPBDMatrix, b: QPBDMatrix): Carrier {
  const light = Math.abs(a.q.lightFreq - b.q.lightFreq) < 40;
  const sound = Math.abs(a.q.soundHarmonic - b.q.soundHarmonic) < 60;
  if (light && sound) return "both";
  if (sound) return "sound";
  return "light";
}

export class BorderEngine {
  private pods = new Map<string, QPBDMatrix>();
  private listeners = new Set<BorderListener>();
  private threshold: number;

  constructor(threshold = 0.15) {
    this.threshold = threshold;
  }

  on(fn: BorderListener) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  register(m: QPBDMatrix) {
    this.pods.set(m.p.podId, m);
    this.scan(m);
  }

  unregister(podId: string) {
    this.pods.delete(podId);
  }

  private scan(m: QPBDMatrix) {
    for (const other of this.pods.values()) {
      if (other.p.podId === m.p.podId) continue;
      const distance = resonanceDistance(m, other);
      if (distance <= this.threshold) {
        const event: BorderTouchEvent = {
          a: m,
          b: other,
          distance,
          carrier: pickCarrier(m, other),
          at: Date.now(),
        };
        for (const l of this.listeners) l(event);
      }
    }
  }
}

export const globalBorderEngine = new BorderEngine();
