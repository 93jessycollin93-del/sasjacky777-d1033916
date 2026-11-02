// Boot walk-through — ties "we created the Jackie Boot NVRAM entry" to "the
// machine has actually restarted since then, and the entry is still there".
//
// Honest rules:
//   · The creation time is only recorded when the operator says the create
//     command ran. Nothing here creates anything.
//   · "Survived a restart" is only claimed when the machine's own last boot
//     time is later than the creation time AND a real firmware listing shows
//     the entry. One without the other is explicitly "not proven yet".

import type { Platform } from "./autorun";

export type BootWalk = {
  /** ISO time the operator confirmed the create command ran. */
  createdAt: string | null;
  /** Raw output of the last-boot-time command, kept verbatim. */
  lastBootRaw: string;
  /** Parsed last boot time, ISO, or null when the output was unreadable. */
  lastBootAt: string | null;
};

export const EMPTY_WALK: BootWalk = { createdAt: null, lastBootRaw: "", lastBootAt: null };

export function lastBootCommand(platform: Platform): { command: string; note: string } {
  return platform === "windows"
    ? {
        command:
          "(Get-CimInstance Win32_OperatingSystem).LastBootUpTime.ToString('yyyy-MM-dd HH:mm:ss')",
        note: "Read-only. If Fast Startup is on, Windows may report an older time than your last shutdown — a full restart is what this check wants.",
      }
    : {
        command: "uptime -s",
        note: "Read-only. Prints the time the kernel came up, in local time.",
      };
}

/** Pull a usable timestamp out of the command's raw output. */
export function parseLastBoot(raw: string): string | null {
  const text = (raw || "").trim();
  if (!text) return null;
  for (const line of text.split(/\r?\n/)) {
    const l = line.trim();
    if (!l) continue;
    const m = l.match(/\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2})?/);
    const candidate = m ? m[0].replace(" ", "T") : l;
    const d = new Date(candidate);
    if (!Number.isNaN(d.getTime())) return d.toISOString();
  }
  return null;
}

export type WalkStage =
  | "not-created"
  | "created-awaiting-restart"
  | "restarted-not-listed"
  | "confirmed"
  | "listing-missing";

export type WalkVerdict = {
  stage: WalkStage;
  tone: "ok" | "info" | "medium" | "high";
  headline: string;
  detail: string;
};

/**
 * `jackiePresent` comes from a parsed firmware listing; pass null when no
 * listing has been read yet, so the verdict can say so instead of guessing.
 */
export function walkVerdict(walk: BootWalk, jackiePresent: boolean | null): WalkVerdict {
  const { createdAt, lastBootAt } = walk;
  if (!createdAt) {
    return {
      stage: "not-created",
      tone: "info",
      headline: "No creation recorded yet",
      detail:
        "Run the create command from the Jackie Boot panel, then mark it here. Until that is recorded there is nothing for a restart to prove.",
    };
  }
  const created = new Date(createdAt).getTime();
  const booted = lastBootAt ? new Date(lastBootAt).getTime() : null;
  if (booted === null) {
    return {
      stage: "created-awaiting-restart",
      tone: "medium",
      headline: "Entry created — restart not verified",
      detail: `Recorded as created ${new Date(createdAt).toLocaleString()}. Read the machine's last boot time below; until then the entry only exists on paper.`,
    };
  }
  if (booted <= created) {
    return {
      stage: "created-awaiting-restart",
      tone: "medium",
      headline: "Not restarted since the entry was made",
      detail: `Last boot ${new Date(lastBootAt!).toLocaleString()} is earlier than the creation at ${new Date(createdAt).toLocaleString()}. Restart fully — not sleep, not Fast Startup — then read both again.`,
    };
  }
  if (jackiePresent === null) {
    return {
      stage: "listing-missing",
      tone: "medium",
      headline: "Restarted, but the firmware list has not been read",
      detail: `The machine booted ${new Date(lastBootAt!).toLocaleString()}, after the entry was created. Read the firmware listing above so presence can be checked against real output.`,
    };
  }
  if (!jackiePresent) {
    return {
      stage: "restarted-not-listed",
      tone: "high",
      headline: "Entry did not survive the restart",
      detail:
        "The machine has restarted since creation and the firmware listing no longer contains Jackie Boot. Some boards prune added entries on their own. Re-create it and check the board's boot-option filtering.",
    };
  }
  return {
    stage: "confirmed",
    tone: "ok",
    headline: "Confirmed — entry survived a real restart",
    detail: `Created ${new Date(createdAt).toLocaleString()}, machine last booted ${new Date(lastBootAt!).toLocaleString()}, and the firmware listing read after that boot still shows the entry.`,
  };
}
