/**
 * What has to arrive before the offline rungs can answer, and whether the
 * owner's ceiling still has room for it.
 *
 * The ceiling is the owner's number, not this module's invention: 750 MB total,
 * 300 reserved for the language model, 400 for everything else that makes the
 * system work without a network. It was declared in `budget.ts` and checked
 * there — by its own test, and by nothing else. Nothing in a download path read
 * it, so the rule was true on paper and a phone could still be filled anyway.
 * Wiring it here, at the one place a download is chosen, is what turns it from a
 * comment into a limit.
 *
 * Two shapes matter. A block already on the device counts against its slot
 * whether or not anyone asks to download it again — the bytes are there. And a
 * block that would break the ceiling is refused on its own, without taking the
 * smaller ones down with it: a photo reader that does not fit should not be
 * allowed to hide the fact that a routing model still would.
 */
import { DEVICE_BUDGET_MB, checkBudget, type BudgetItem } from "./budget";

export interface WeightBlock {
  id: string;
  name: string;
  slot: BudgetItem["slot"];
  /** What it will weigh here, in MB. */
  mb: number;
  /** Whether this device already holds it. */
  present: boolean;
  /** The honest one-line answer from the device: what is there, or what is missing. */
  detail: string;
}

export interface ActivationPlan {
  missing: WeightBlock[];
  /** Missing blocks the ceiling will not allow, each with the reason in `reason`. */
  refused: WeightBlock[];
  reason?: string;
  /** MB the accounted blocks occupy or would occupy if everything allowed ran. */
  usedMB: number;
  headroomMB: number;
}

/**
 * Which missing blocks the ceiling still has room for, in the order given.
 *
 * Each candidate is tested against the ceiling together with what is already
 * here and what has already been let through, so a plan never quietly agrees to
 * a set of downloads that adds up to more than the device was promised.
 */
export function planActivation(blocks: WeightBlock[]): ActivationPlan {
  const held = blocks.filter((b) => b.present);
  const missing = blocks.filter((b) => !b.present);
  const allowed: WeightBlock[] = [];
  const refused: WeightBlock[] = [];
  let reason: string | undefined;

  for (const block of missing) {
    const verdict = checkBudget(
      [...held, ...allowed, block].map<BudgetItem>((b) => ({ id: b.id, mb: b.mb, slot: b.slot })),
    );
    if (verdict.ok) allowed.push(block);
    else {
      refused.push(block);
      reason ??= `${block.name}: ${verdict.reason}`;
    }
  }

  const used = checkBudget([...held, ...allowed].map<BudgetItem>((b) => ({ id: b.id, mb: b.mb, slot: b.slot })));
  return {
    missing: allowed,
    refused,
    reason,
    usedMB: used.usedMB,
    headroomMB: Math.max(0, DEVICE_BUDGET_MB.total - used.usedMB),
  };
}

/**
 * The live answer for the two blocks this system downloads: the language model
 * in the browser's own model store, the photo reader in its cache.
 *
 * Both reads are lazy on purpose — the first pulls in the inference runtime and
 * the second the ONNX library, and a status check that downloaded a runtime to
 * ask a question would be the exact mistake the station table was built to
 * catch.
 */
export async function readWeightBlocks(): Promise<WeightBlock[]> {
  const [{ BONSAI_ID, deviceModelOrDefault }, device, vision] = await Promise.all([
    import("./deviceModels"),
    import("./bonsaiDevice"),
    import("./chain/vision"),
  ]);
  const spec = deviceModelOrDefault(BONSAI_ID);
  const stored = await device.storedModel(BONSAI_ID);
  const status = await vision.visionWeightsStatus();
  return [
    {
      id: "bonsai",
      name: spec.name,
      slot: "bonsai",
      mb: device.BONSAI_MB,
      present: stored.downloaded,
      detail: !stored.supported
        ? device.UNSUPPORTED_BROWSER
        : stored.downloaded
          ? `${device.BONSAI_MB} MB on this device`
          : stored.partial
            ? "a part of it is here, but the download never finished — run it again while you are online"
            : device.notDownloaded(spec),
    },
    {
      id: "vision",
      name: vision.VISION_MODEL_NAME,
      slot: "micro",
      mb: vision.VISION_MODEL_MB,
      present: status.present,
      detail: status.detail,
    },
  ];
}

export interface ActivateReport {
  ok: boolean;
  activated: string[];
  refused: string[];
  reason?: string;
  errors: string[];
}

/**
 * Bring the missing blocks onto this device, one at a time, without ever
 * starting one the ceiling has refused.
 *
 * A block that fails says so by name and stops nothing that can still succeed —
 * a half-built offline rung that reports which half is missing is worth more
 * than a silent give-up, and more than a green tick.
 */
export async function activateWeights(opts: {
  onProgress?: (block: WeightBlock, fraction: number | null) => void;
  signal?: AbortSignal;
} = {}): Promise<ActivateReport> {
  const blocks = await readWeightBlocks();
  const plan = planActivation(blocks);
  const report: ActivateReport = {
    ok: true,
    activated: [],
    refused: plan.refused.map((b) => b.name),
    reason: plan.reason,
    errors: [],
  };
  if (!plan.missing.length) return { ...report, ok: !plan.refused.length };

  for (const block of plan.missing) {
    if (opts.signal?.aborted) {
      report.ok = false;
      report.errors.push(`${block.name}: stopped before it started.`);
      continue;
    }
    try {
      if (block.id === "bonsai") {
        const device = await import("./bonsaiDevice");
        const { BONSAI_ID } = await import("./deviceModels");
        const verdict = await device.downloadDeviceModel(BONSAI_ID, {
          onProgress: (p) => opts.onProgress?.(block, p.total ? p.loaded / p.total : null),
          signal: opts.signal,
        });
        if (!verdict.ok) throw new Error(verdict.error);
      } else if (block.id === "vision") {
        const { prepareVisionWeights } = await import("./chain/vision");
        await prepareVisionWeights({
          onProgress: (p) => opts.onProgress?.(block, p.fraction),
        });
      } else {
        throw new Error(`no download path is wired for ${block.name}`);
      }
      report.activated.push(block.name);
    } catch (error) {
      report.ok = false;
      report.errors.push(`${block.name}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return report;
}
