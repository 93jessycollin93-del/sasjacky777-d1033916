// Firmware update risk scoring.
//
// This compares the versions YOU logged against what the official changelog for
// that class of part actually contains, and returns a verdict: flash now,
// postpone, or never. It scores risk from three honest inputs only:
//   1. how recoverable that part is if a flash fails,
//   2. whether the vendor changelog for that part has a known must-have fix,
//   3. whether your own note names a problem the update claims to fix.
// It never invents a version number. If you logged nothing, the verdict is
// "unknown" and it tells you exactly what to read.

import type { FirmwareEntry } from "./repairStore";
import { RIG } from "./rigProfile";

export type Verdict = "flash-now" | "flash-when-calm" | "postpone" | "never" | "unknown";

export type ChangelogFact = {
  /** Version string as published by the vendor. Only real, documented entries. */
  version: string;
  /** What that release actually fixes. */
  fixes: string;
  /** True when skipping it risks data loss or hardware damage. */
  critical: boolean;
};

type ComponentRisk = {
  componentId: string;
  /** 1 = trivially recoverable, 5 = a failed flash can brick the part. */
  bricking: 1 | 2 | 3 | 4 | 5;
  recovery: string;
  /** Real, documented changelog facts for this part. Empty when there is nothing verified. */
  changelog: ChangelogFact[];
  /** What to look for on the vendor page before deciding. */
  readFirst: string;
  /** Hard rule that overrides scoring. */
  hardRule?: { verdict: Verdict; why: string };
};

export const COMPONENT_RISK: ComponentRisk[] = [
  {
    componentId: "nvme",
    bricking: 2,
    recovery:
      "Samsung Magician flashes in-place and the drive keeps its data; a failed flash is recoverable by re-running it. Still image the drive first.",
    changelog: [
      {
        version: "5B2QGXA7",
        fixes:
          "Fixes the 980 PRO health-degradation / rapidly-falling-percentage-used defect. Samsung published this as the fix for the widely reported wear bug.",
        critical: true,
      },
    ],
    readFirst:
      "In Samsung Magician, read the firmware version on EACH of the four drives. Anything older than 5B2QGXA7 on a 980 PRO is the known-defect firmware.",
  },
  {
    componentId: "mobo",
    bricking: 4,
    recovery:
      "MSI Flash BIOS Button recovers a bad flash with no CPU or RAM installed — that is your safety net, and it only works if you keep a known-good BIOS file on a FAT32 stick named MSI.ROM.",
    changelog: [],
    readFirst:
      "MSI publishes a per-version change list. Only three reasons justify a Z690 BIOS flash: a new CPU microcode you need, a DDR5 memory-training/stability fix that matches your symptom, or a security advisory. 'Improved performance' with no named fix is not a reason.",
  },
  {
    componentId: "gpu",
    bricking: 5,
    recovery:
      "There is no user recovery path for a bad RTX 3090 VBIOS. The card is dead and only ASUS RMA fixes it.",
    changelog: [],
    readFirst:
      "Driver updates (NVIDIA App / nvidia-driver package) are safe and reversible — take those. VBIOS is a different thing entirely.",
    hardRule: {
      verdict: "never",
      why:
        "Never flash the 3090 VBIOS unless ASUS support explicitly instructs you to for a named defect. Update the driver instead; it fixes what you're actually chasing 95% of the time.",
    },
  },
  {
    componentId: "ram",
    bricking: 1,
    recovery: "DDR5 has no user-flashable firmware. Nothing to brick.",
    changelog: [],
    readFirst:
      "Crucial DDR5 stability is a BIOS/memory-training question, not a RAM firmware question. Log the BIOS version instead and test at JEDEC with all four sticks.",
    hardRule: {
      verdict: "never",
      why: "There is no user firmware for these DIMMs. Any tool claiming to flash them is not legitimate.",
    },
  },
  {
    componentId: "ssd",
    bricking: 2,
    recovery: "Crucial Storage Executive flashes in-place; keep a copy of the data anyway.",
    changelog: [],
    readFirst:
      "Crucial only publishes SATA SSD firmware for named defects. If the release notes don't describe your symptom, there is nothing to gain.",
  },
  {
    componentId: "hdd",
    bricking: 3,
    recovery:
      "Seagate HDD firmware flashes are rare and mostly irreversible. A failed flash usually means a dead drive.",
    changelog: [],
    readFirst:
      "Run SeaTools SMART long test first. A failing HDD is a failing HDD — firmware will not fix bad sectors.",
    hardRule: {
      verdict: "postpone",
      why:
        "This drive is your cold copy. Don't touch its firmware; if SMART is degrading, replace it instead of flashing it.",
    },
  },
  {
    componentId: "cpu",
    bricking: 4,
    recovery:
      "Intel microcode ships inside the MSI BIOS and via OS updates — you never flash the CPU directly. So this is really the motherboard's risk profile.",
    changelog: [],
    readFirst:
      "Take microcode through Windows/Ubuntu updates. Only take it via BIOS when MSI's notes name a stability or security fix you have.",
  },
];

export type RiskScore = {
  componentId: string
  componentName: string;
  verdict: Verdict;
  /** 0-100. Higher = more risk in taking this update now. */
  risk: number;
  /** 0-100. Higher = more to gain. */
  benefit: number;
  headline: string;
  reasons: string[];
  readFirst: string;
  recovery: string;
  matchedChangelog?: ChangelogFact;
  sourceUrl?: string;
};

/** Words in your own note that mean "this update targets a problem I actually have". */
const SYMPTOM_HINTS = [
  "crash", "reboot", "bsod", "whea", "freeze", "hang", "unstable", "throttle",
  "not detected", "missing", "drop", "disconnect", "error", "corrupt", "slow",
  "health", "wear", "degrad", "boot loop", "no post", "security", "cve",
];

function normalizeVersion(v: string) {
  return v.trim().toUpperCase().replace(/\s+/g, "");
}

export function scoreFirmware(entry: FirmwareEntry | undefined, componentId: string): RiskScore {
  const comp = RIG.find((c) => c.id === componentId);
  const cfg = COMPONENT_RISK.find((r) => r.componentId === componentId);
  const name = comp?.name ?? componentId;

  const base: RiskScore = {
    componentId,
    componentName: name,
    verdict: "unknown",
    risk: 0,
    benefit: 0,
    headline: "Nothing logged yet.",
    reasons: [],
    readFirst: cfg?.readFirst ?? "Open the vendor support page for this exact model and read the release notes.",
    recovery: cfg?.recovery ?? "Assume a failed flash is unrecoverable until the vendor says otherwise.",
    sourceUrl: comp?.firmwareSource?.url,
  };

  if (cfg?.hardRule) {
    return {
      ...base,
      verdict: cfg.hardRule.verdict,
      risk: cfg.hardRule.verdict === "never" ? 100 : 60,
      benefit: 0,
      headline:
        cfg.hardRule.verdict === "never" ? "Do not flash this part." : "Leave this one alone for now.",
      reasons: [cfg.hardRule.why],
    };
  }

  const installed = normalizeVersion(entry?.currentVersion ?? "");
  const latest = normalizeVersion(entry?.latestSeen ?? "");
  const note = (entry?.note ?? "").toLowerCase();

  if (!installed && !latest) {
    return {
      ...base,
      reasons: [
        "Log the installed version and what the vendor page shows today. Scoring runs on what you observed — never on a version I guessed.",
      ],
    };
  }

  const bricking = cfg?.bricking ?? 3;
  let risk = bricking * 12; // 12–60 baseline from how recoverable a bad flash is
  const reasons: string[] = [
    `Failure recoverability: ${bricking}/5 bricking risk. ${cfg?.recovery ?? ""}`.trim(),
  ];

  let benefit = 0;

  // Known-critical changelog match against the INSTALLED version.
  const criticalFix = cfg?.changelog.find((c) => c.critical);
  let matched: ChangelogFact | undefined;
  if (criticalFix && installed) {
    const onFix = installed === normalizeVersion(criticalFix.version);
    if (onFix) {
      reasons.push(`You are already on ${criticalFix.version} — the critical fix is in place.`);
    } else {
      matched = criticalFix;
      benefit += 70;
      reasons.push(
        `Documented critical release ${criticalFix.version}: ${criticalFix.fixes} Your logged version is ${entry?.currentVersion}, which is not that build.`,
      );
    }
  }

  if (installed && latest) {
    if (installed === latest) {
      reasons.push("Installed matches the latest you saw on the vendor page — there is no update to take.");
      return {
        ...base,
        verdict: "flash-when-calm",
        risk: 0,
        benefit,
        headline: matched ? "Up to date with the page, but verify the critical build." : "Already current.",
        reasons,
        matchedChangelog: matched,
      };
    }
    benefit += 20;
    reasons.push(`A newer version is published (${entry?.latestSeen} vs your ${entry?.currentVersion}).`);
  } else if (!latest) {
    risk += 10;
    reasons.push("You haven't logged what the vendor page currently shows, so 'newer' is unverified.");
  }

  const hit = SYMPTOM_HINTS.find((h) => note.includes(h));
  if (hit) {
    benefit += 35;
    reasons.push(`Your note names a real symptom ("${hit}"). An update that fixes it is worth the risk.`);
  } else if (note.trim()) {
    reasons.push("Your note doesn't name a symptom the update would fix — that's an update for its own sake.");
  } else {
    reasons.push("No note. Paste the changelog line or the problem you're chasing and re-score.");
  }

  if (entry?.status === "flashed") {
    reasons.push("You marked this as flashed. Verify the version reads back correctly before trusting it.");
  }

  benefit = Math.min(100, benefit);
  risk = Math.min(100, risk);

  let verdict: Verdict;
  let headline: string;
  if (matched) {
    verdict = "flash-now";
    headline = "Flash this one — documented critical fix.";
  } else if (benefit === 0) {
    verdict = "postpone";
    headline = "Postpone. Nothing to gain.";
  } else if (benefit >= 50 && benefit > risk) {
    verdict = "flash-now";
    headline = "Worth taking now.";
  } else if (benefit > risk) {
    verdict = "flash-when-calm";
    headline = "Take it, but not mid-project.";
  } else {
    verdict = "postpone";
    headline = "Postpone — risk outweighs the gain.";
  }

  return { ...base, verdict, risk, benefit, headline, reasons, matchedChangelog: matched };
}

export function scoreAll(entries: FirmwareEntry[]): RiskScore[] {
  const ids = RIG.filter((c) => c.firmwareSource).map((c) => c.id);
  const order: Record<Verdict, number> = {
    "flash-now": 0,
    "flash-when-calm": 1,
    postpone: 2,
    unknown: 3,
    never: 4,
  };
  return ids
    .map((id) => scoreFirmware(entries.find((e) => e.componentId === id), id))
    .sort((a, b) => order[a.verdict] - order[b.verdict] || b.benefit - a.benefit);
}

export const VERDICT_LABEL: Record<Verdict, string> = {
  "flash-now": "Flash now",
  "flash-when-calm": "Flash when calm",
  postpone: "Postpone",
  never: "Never",
  unknown: "Log a version",
};
