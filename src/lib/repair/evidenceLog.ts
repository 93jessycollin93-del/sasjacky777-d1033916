// Evidence log for the Repair Bay.
//
// Every command the operator actually runs is recorded here with its timestamp,
// verbatim output, and the conclusion that output supports. This is the record
// that keeps diagnosis honest: a conclusion with no linked evidence row stays
// an assumption, and Jackie is grounded in the rows, not in guesses.
//
// Device-local (localStorage) so it works offline and hardware output never
// leaves the machine unless the operator exports it.

export type EvidenceStatus = "supports" | "contradicts" | "inconclusive";

export type EvidenceEntry = {
  id: string;
  /** ISO timestamp of when the command was run / logged. */
  ts: string;
  /** Exact command as run. */
  command: string;
  /** Where it ran, e.g. "PowerShell (admin)", "BIOS setup", "Linux live USB". */
  context: string;
  /** Verbatim output, untouched. */
  output: string;
  /** The claim this output bears on. */
  conclusion: string;
  /** Whether the output supports, contradicts, or fails to settle the claim. */
  status: EvidenceStatus;
  /** Optional discrepancy id from detectedInventory.ts this evidence resolves. */
  linkedDiscrepancy?: string;
};

export const STATUS_LABEL: Record<EvidenceStatus, string> = {
  supports: "Supports",
  contradicts: "Contradicts",
  inconclusive: "Inconclusive",
};

const KEY = "jackie.repair.evidence.v1";

export function loadEvidence(): EvidenceEntry[] {
  try {
    const raw = localStorage.getItem(KEY);
    const rows = raw ? (JSON.parse(raw) as EvidenceEntry[]) : [];
    return rows.sort((a, b) => b.ts.localeCompare(a.ts));
  } catch {
    return [];
  }
}

export function saveEvidence(rows: EvidenceEntry[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(rows));
  } catch {
    /* storage full or blocked — keep the UI alive */
  }
}

export function newEvidenceId() {
  return `ev-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function csvCell(value: string) {
  return `"${String(value ?? "").replace(/"/g, '""')}"`;
}

export function evidenceToCsv(rows: EvidenceEntry[]) {
  const head = ["timestamp", "context", "command", "output", "conclusion", "status", "linked_discrepancy"];
  const body = rows.map((r) =>
    [r.ts, r.context, r.command, r.output, r.conclusion, r.status, r.linkedDiscrepancy ?? ""]
      .map(csvCell)
      .join(","),
  );
  return [head.join(","), ...body].join("\n");
}

export function downloadFile(filename: string, contents: string, type: string) {
  const blob = new Blob([contents], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/** Factual brief of logged evidence, for grounding the consultant. */
export function evidenceBrief(rows = loadEvidence()) {
  if (rows.length === 0) {
    return [
      "EVIDENCE LOG: empty.",
      "No command output has been logged yet. Do not assert any BIOS/firmware version, drive count, or hardware state as confirmed — ask for the command output first.",
    ].join("\n");
  }
  const lines = rows.map(
    (r) =>
      `- [${r.ts}] (${r.context}) $ ${r.command}\n  output: ${r.output.slice(0, 800)}\n  ${STATUS_LABEL[r.status]}: ${r.conclusion}`,
  );
  return [
    `EVIDENCE LOG (${rows.length} logged command run${rows.length === 1 ? "" : "s"}, newest first)`,
    ...lines,
    "Rule: only these outputs count as confirmed facts. Anything not present here is unverified — say so rather than filling the gap.",
  ].join("\n");
}
