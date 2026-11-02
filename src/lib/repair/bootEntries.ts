// UEFI boot entry status — reads the firmware boot list as it actually is.
//
// Nothing here guesses. Every field comes from real output of
// `bcdedit /enum firmware` (Windows) or `efibootmgr -v` (Linux), pasted in or
// pulled through the local bridge. If the output does not name an entry, this
// module reports "not found" rather than inventing one.
//
// Rollback is symmetric with creation: before any change the operator takes a
// snapshot of the current boot order, and rollback replays that snapshot and
// removes the entry Jackie added. No firmware image is ever touched.

import { BOOT_ENTRY_LABEL, type Platform } from "./autorun";

export type BootEntry = {
  /** {GUID} on Windows, Boot#### id on Linux. */
  id: string;
  label: string;
  /** Loader path / device string when the output includes it. */
  target?: string;
  /** True when this is the entry Jackie created. */
  isJackie: boolean;
  /** Marked active by the firmware (efibootmgr '*'). Undefined on Windows. */
  active?: boolean;
};

export type BootStatus = {
  platform: Platform;
  /** Entries in firmware boot order, first = booted first. */
  order: BootEntry[];
  /** Entries present but not in the display order. */
  unordered: BootEntry[];
  jackie: BootEntry | null;
  /** 1-based position in boot order, null when absent from the order. */
  jackiePosition: number | null;
  /** Total entries in the order. */
  orderCount: number;
  /** Raw order ids exactly as the firmware listed them — this is what rollback restores. */
  rawOrder: string[];
  parsedFrom: "bcdedit" | "efibootmgr";
};

const JACKIE_RE = new RegExp(BOOT_ENTRY_LABEL.replace(/\s+/g, "\\s*"), "i");

const isJackieLabel = (label: string) => JACKIE_RE.test(label.trim());

/* ------------------------------------------------------------------ */
/* Windows — bcdedit /enum firmware                                    */
/* ------------------------------------------------------------------ */

function parseBcdedit(raw: string): BootStatus | null {
  const text = raw.replace(/\r/g, "");
  if (!/identifier\s+\{/i.test(text)) return null;

  // Split on blank-line separated blocks.
  const blocks = text.split(/\n\s*\n/).filter((b) => /identifier/i.test(b));
  const byId = new Map<string, BootEntry>();
  let rawOrder: string[] = [];

  for (const block of blocks) {
    const id = block.match(/identifier\s+(\{[^}]+\})/i)?.[1];
    if (!id) continue;
    const description = block.match(/description\s+(.+)/i)?.[1]?.trim();
    const device = block.match(/device\s+(.+)/i)?.[1]?.trim();
    const path = block.match(/^\s*path\s+(.+)$/im)?.[1]?.trim();

    if (/\{fwbootmgr\}/i.test(id)) {
      const orderLine = block.match(/displayorder([\s\S]*?)(?:\n\s*[a-z]+\s{2,}|$)/i)?.[1] ?? "";
      rawOrder = [...orderLine.matchAll(/\{[^}]+\}/g)].map((m) => m[0]);
      continue;
    }

    const label = description || id;
    byId.set(id.toLowerCase(), {
      id,
      label,
      target: [device, path].filter(Boolean).join(" · ") || undefined,
      isJackie: isJackieLabel(label),
    });
  }

  const order: BootEntry[] = [];
  for (const id of rawOrder) {
    const found = byId.get(id.toLowerCase());
    order.push(found ?? { id, label: `(unnamed ${id})`, isJackie: false });
  }
  const orderedIds = new Set(rawOrder.map((i) => i.toLowerCase()));
  const unordered = [...byId.values()].filter((e) => !orderedIds.has(e.id.toLowerCase()));

  const jackie = order.find((e) => e.isJackie) || unordered.find((e) => e.isJackie) || null;
  const idx = order.findIndex((e) => e.isJackie);

  return {
    platform: "windows",
    order,
    unordered,
    jackie,
    jackiePosition: idx >= 0 ? idx + 1 : null,
    orderCount: order.length,
    rawOrder,
    parsedFrom: "bcdedit",
  };
}

/* ------------------------------------------------------------------ */
/* Linux — efibootmgr -v                                               */
/* ------------------------------------------------------------------ */

function parseEfibootmgr(raw: string): BootStatus | null {
  const text = raw.replace(/\r/g, "");
  if (!/Boot[0-9A-Fa-f]{4}/.test(text)) return null;

  const rawOrder = (text.match(/^BootOrder:\s*(.+)$/im)?.[1] || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  const byId = new Map<string, BootEntry>();
  for (const line of text.split("\n")) {
    const m = line.match(/^Boot([0-9A-Fa-f]{4})(\*?)\s+(.*)$/);
    if (!m) continue;
    const rest = m[3];
    // Label is everything up to the first tab or the first device descriptor.
    const label = rest.split(/\t|\s{2,}|(?=HD\()|(?=PciRoot)|(?=VenHw)/)[0].trim();
    const target = rest.slice(label.length).trim() || undefined;
    byId.set(m[1].toUpperCase(), {
      id: m[1].toUpperCase(),
      label: label || `Boot${m[1]}`,
      target,
      isJackie: isJackieLabel(label),
      active: m[2] === "*",
    });
  }

  const order: BootEntry[] = rawOrder.map(
    (id) => byId.get(id.toUpperCase()) ?? { id: id.toUpperCase(), label: `(unknown Boot${id})`, isJackie: false },
  );
  const orderedIds = new Set(rawOrder.map((i) => i.toUpperCase()));
  const unordered = [...byId.values()].filter((e) => !orderedIds.has(e.id));

  const jackie = order.find((e) => e.isJackie) || unordered.find((e) => e.isJackie) || null;
  const idx = order.findIndex((e) => e.isJackie);

  return {
    platform: "linux",
    order,
    unordered,
    jackie,
    jackiePosition: idx >= 0 ? idx + 1 : null,
    orderCount: order.length,
    rawOrder,
    parsedFrom: "efibootmgr",
  };
}

/** Parse either firmware listing. Returns null when the text is not a boot listing. */
export function parseBootStatus(raw: string): BootStatus | null {
  if (!raw.trim()) return null;
  return parseEfibootmgr(raw) || parseBcdedit(raw);
}

/* ------------------------------------------------------------------ */
/* Verdict + commands                                                  */
/* ------------------------------------------------------------------ */

export type BootVerdict = { tone: "ok" | "info" | "medium" | "high"; headline: string; detail: string };

export function bootVerdict(s: BootStatus | null): BootVerdict {
  if (!s) {
    return {
      tone: "info",
      headline: "No firmware listing read yet",
      detail: `Run the status command below (elevated) and paste its output, or send it through the bridge. Until then Jackie says nothing about whether "${BOOT_ENTRY_LABEL}" exists.`,
    };
  }
  if (!s.jackie) {
    return {
      tone: "medium",
      headline: `"${BOOT_ENTRY_LABEL}" is not in this firmware list`,
      detail: `${s.orderCount} entries are in the boot order and none of them is named "${BOOT_ENTRY_LABEL}". Create it from Jackie Boot → boot menu presence, then re-read this screen.`,
    };
  }
  if (s.jackiePosition === null) {
    return {
      tone: "medium",
      headline: `"${BOOT_ENTRY_LABEL}" exists but is outside the boot order`,
      detail: "The entry is defined in NVRAM yet not listed in the display order, so the firmware will not show it in the normal boot sequence. Add it last with the order command below.",
    };
  }
  if (s.jackiePosition === 1 && s.orderCount > 1) {
    return {
      tone: "high",
      headline: `"${BOOT_ENTRY_LABEL}" is first in boot order`,
      detail: "That means the rescue path boots before Windows on every restart — not what you want day to day. Move it last, or roll back.",
    };
  }
  if (s.jackiePosition === s.orderCount) {
    return {
      tone: "ok",
      headline: `"${BOOT_ENTRY_LABEL}" present, last in boot order (${s.jackiePosition} of ${s.orderCount})`,
      detail: "Correct posture: reachable by name from the F11 / boot-override menu, never stealing a normal boot.",
    };
  }
  return {
    tone: "medium",
    headline: `"${BOOT_ENTRY_LABEL}" is position ${s.jackiePosition} of ${s.orderCount}`,
    detail: "It sits ahead of at least one normal boot target. Unless that is deliberate, move it last.",
  };
}

export type BootCommand = { title: string; command: string; note?: string; readOnly?: boolean };

/** The read-only command that produces the listing this screen parses. */
export function statusCommand(platform: Platform): BootCommand {
  return platform === "windows"
    ? {
        title: "Read the firmware boot list",
        command: "bcdedit /enum firmware",
        note: "Administrator terminal required. Read-only: it prints NVRAM entries and the display order, changes nothing.",
        readOnly: true,
      }
    : {
        title: "Read the firmware boot list",
        command: "sudo efibootmgr -v",
        note: "Read-only. -v includes the loader path so you can confirm which volume the entry points at.",
        readOnly: true,
      };
}

/** Snapshot of the boot order, taken before any change so rollback is exact. */
export type BootSnapshot = {
  id: string;
  takenAt: string;
  platform: Platform;
  rawOrder: string[];
  labels: string[];
  jackiePresent: boolean;
};

export function makeSnapshot(s: BootStatus): BootSnapshot {
  return {
    id: `snap_${Date.now().toString(36)}`,
    takenAt: new Date().toISOString(),
    platform: s.platform,
    rawOrder: s.rawOrder,
    labels: s.order.map((e) => e.label),
    jackiePresent: Boolean(s.jackie),
  };
}

/** Move the Jackie entry to the end of the boot order — the safe posture. */
export function moveLastCommands(s: BootStatus): BootCommand[] {
  if (!s.jackie) return [];
  if (s.platform === "windows") {
    return [
      {
        title: `Move "${BOOT_ENTRY_LABEL}" last`,
        command: `bcdedit /set {fwbootmgr} displayorder ${s.jackie.id} /addlast`,
        note: "Keeps every other entry where it is; only the Jackie entry is repositioned.",
      },
      statusCommand("windows"),
    ];
  }
  const others = s.rawOrder.filter((id) => id.toUpperCase() !== s.jackie!.id.toUpperCase());
  return [
    {
      title: `Move "${BOOT_ENTRY_LABEL}" last`,
      command: `sudo efibootmgr -o ${[...others, s.jackie.id].join(",")}`,
      note: "Explicit full order, derived from the listing you just read — nothing else moves.",
    },
    statusCommand("linux"),
  ];
}

/**
 * One-click rollback: restore the recorded boot order, then delete the entry
 * Jackie created. Order matters — restore first, so a failed delete still
 * leaves a bootable machine.
 */
export function rollbackCommands(s: BootStatus, snap: BootSnapshot | null): BootCommand[] {
  const out: BootCommand[] = [];
  if (s.platform === "windows") {
    if (snap && snap.rawOrder.length) {
      out.push({
        title: "1 · Restore the recorded boot order",
        command: `bcdedit /set {fwbootmgr} displayorder ${snap.rawOrder.join(" ")}`,
        note: `Snapshot from ${new Date(snap.takenAt).toLocaleString()}: ${snap.labels.join(" → ") || "order ids only"}.`,
      });
    }
    if (s.jackie) {
      out.push({
        title: `2 · Delete the "${BOOT_ENTRY_LABEL}" entry`,
        command: `bcdedit /delete ${s.jackie.id} /f`,
        note: "Removes only this NVRAM entry. Windows Boot Manager and every other entry are untouched.",
      });
    }
    out.push(statusCommand("windows"));
    return out;
  }
  if (snap && snap.rawOrder.length) {
    out.push({
      title: "1 · Restore the recorded boot order",
      command: `sudo efibootmgr -o ${snap.rawOrder.join(",")}`,
      note: `Snapshot from ${new Date(snap.takenAt).toLocaleString()}.`,
    });
  }
  if (s.jackie) {
    out.push({
      title: `2 · Delete the "${BOOT_ENTRY_LABEL}" entry`,
      command: `sudo efibootmgr -b ${s.jackie.id} -B`,
      note: "-b selects the entry, -B deletes it. Nothing else in NVRAM changes.",
    });
  }
  out.push(statusCommand("linux"));
  return out;
}

/** Factual one-paragraph brief for the repair consultant's grounding. */
export function bootStatusBrief(s: BootStatus | null): string {
  if (!s) return `UEFI boot entry status: not read. No claim can be made about "${BOOT_ENTRY_LABEL}".`;
  const v = bootVerdict(s);
  const list = s.order.map((e, i) => `${i + 1}. ${e.label}${e.isJackie ? " (Jackie)" : ""}`).join("; ");
  return [
    `UEFI boot entry status (from ${s.parsedFrom}): ${v.headline}.`,
    `Boot order as read: ${list || "empty"}.`,
    s.unordered.length ? `Defined but outside the order: ${s.unordered.map((e) => e.label).join(", ")}.` : "",
  ]
    .filter(Boolean)
    .join(" ");
}
