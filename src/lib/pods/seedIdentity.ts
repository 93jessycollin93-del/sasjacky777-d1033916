// Seed identity: color + glyph per pod slot.
// A pod ID like "pod-01-conversations" maps to a stable color/glyph.

export const SEED_PALETTE = [
  { color: "#ef4444", glyph: "♦" }, // 1  red
  { color: "#f97316", glyph: "◆" }, // 2  orange
  { color: "#f59e0b", glyph: "❖" }, // 3  amber
  { color: "#eab308", glyph: "✦" }, // 4  yellow
  { color: "#84cc16", glyph: "✧" }, // 5  lime
  { color: "#22c55e", glyph: "✿" }, // 6  green
  { color: "#10b981", glyph: "❁" }, // 7  emerald
  { color: "#14b8a6", glyph: "❂" }, // 8  teal
  { color: "#06b6d4", glyph: "◉" }, // 9  cyan
  { color: "#0ea5e9", glyph: "◎" }, // 10 sky
  { color: "#3b82f6", glyph: "◈" }, // 11 blue
  { color: "#6366f1", glyph: "◊" }, // 12 indigo
  { color: "#8b5cf6", glyph: "☾" }, // 13 violet
  { color: "#a855f7", glyph: "☽" }, // 14 purple
  { color: "#d946ef", glyph: "✺" }, // 15 fuchsia
  { color: "#ec4899", glyph: "✹" }, // 16 pink
  { color: "#f43f5e", glyph: "✸" }, // 17 rose
  { color: "#78716c", glyph: "◐" }, // 18 stone
  { color: "#71717a", glyph: "◑" }, // 19 zinc
  { color: "#64748b", glyph: "◒" }, // 20 slate
  { color: "#0f766e", glyph: "◓" }, // 21 deep teal
  { color: "#1d4ed8", glyph: "◔" }, // 22 deep blue
  { color: "#7c3aed", glyph: "◕" }, // 23 deep violet
  { color: "#be123c", glyph: "●" }, // 24 deep rose
];

export function seedIdentity(slot: number) {
  const idx = Math.max(0, Math.min(SEED_PALETTE.length - 1, slot - 1));
  return SEED_PALETTE[idx];
}

export function capabilityFor(domain: string) {
  return `seed:${domain}`;
}
