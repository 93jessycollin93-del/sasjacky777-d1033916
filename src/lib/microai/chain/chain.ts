/**
 * The thinking chain: plan → fetch → archive → compress → reason → check.
 *
 * Built for Bonsai 1.7B on this device. A model that size answers well when it
 * is asked one narrow thing with a short, relevant set of notes, and drifts
 * when handed everything at once. So each step here gets its own small prompt,
 * a hard answer cap and low randomness, and reads only the slice of the notes
 * the distributor picked for it. Every step is recorded with what it read and
 * what it wrote, and a failed step is reported as failed — the chain never
 * carries on as if an empty answer were an answer (rule 8).
 */
import { archive } from "./archive";
import { distribute, STEP_NOTES_CHARS, type Note } from "./compress";

export interface Source {
  label: string;
  kind: "text" | "file" | "image";
  /** Produces the raw text. Images come back as the vision model's description. */
  fetch: (signal?: AbortSignal) => Promise<string>;
}

/** One question to the model. Returns its text or why it produced none. */
export type Ask = (
  step: { system: string; user: string; maxTokens: number },
  signal?: AbortSignal,
) => Promise<{ ok: boolean; text?: string; error?: string }>;

export type StepStatus = "running" | "ok" | "failed" | "skipped";

export interface StepRecord {
  id: string;
  title: string;
  status: StepStatus;
  /** What the step read, after compression — what the model actually saw. */
  input?: string;
  output?: string;
  error?: string;
  ms?: number;
}

export interface ChainResult {
  ok: boolean;
  answer?: string;
  error?: string;
  steps: StepRecord[];
}

const RULES =
  "You are Jackie, running offline on this device. Use only the notes given. If the notes do not contain the answer, say so plainly. Be brief.";

/** Parses a numbered or bulleted list into at most `max` short lines. */
export function parsePlan(text: string, max = 3): string[] {
  return text
    .split("\n")
    .map((l) => l.replace(/^\s*(\d+[.)]|[-*•])\s*/, "").trim())
    .filter((l) => l.length > 3)
    .slice(0, max);
}

export async function runChain(opts: {
  question: string;
  sources: Source[];
  ask: Ask;
  onStep?: (steps: StepRecord[]) => void;
  signal?: AbortSignal;
}): Promise<ChainResult> {
  const steps: StepRecord[] = [];
  const emit = () => opts.onStep?.(steps.map((s) => ({ ...s })));
  const begin = (id: string, title: string, input?: string) => {
    const rec: StepRecord = { id, title, status: "running", input };
    steps.push(rec);
    emit();
    return { rec, t0: Date.now() };
  };
  const end = (h: { rec: StepRecord; t0: number }, patch: Partial<StepRecord>) => {
    Object.assign(h.rec, patch, { ms: Date.now() - h.t0 });
    emit();
  };
  const fail = (error: string): ChainResult => ({ ok: false, error, steps });

  const question = opts.question.trim();
  if (!question) return fail("Type a question first.");

  // Fetch and archive. A source that fails is recorded and left out; the chain
  // goes on with the rest, and the final answer says which were missing.
  const notes: Note[] = [];
  for (const [i, src] of opts.sources.entries()) {
    const h = begin(`fetch-${i}`, `Fetch · ${src.label}`);
    try {
      const raw = (await src.fetch(opts.signal)).trim();
      if (!raw) {
        end(h, { status: "failed", error: "Came back empty." });
        continue;
      }
      const saved = await archive({ label: src.label, kind: src.kind, text: raw });
      notes.push({ label: src.label, text: raw });
      end(h, {
        status: "ok",
        output: `${raw.length.toLocaleString()} characters, archived ${saved.where === "device" ? "on this device" : "for this session only (device storage refused)"}.`,
      });
    } catch (e) {
      end(h, { status: "failed", error: e instanceof Error ? e.message : String(e) });
    }
    if (opts.signal?.aborted) return fail("Stopped.");
  }
  const missing = opts.sources.length - notes.length;

  // Plan: one short list of sub-questions, read against a compressed overview.
  const overview = distribute(notes, question, Math.floor(STEP_NOTES_CHARS / 2));
  const planUser = `Notes:\n${overview || "(none)"}\n\nQuestion: ${question}\n\nList at most 3 short sub-questions that answer it, one per line.`;
  const hp = begin("plan", "Plan", planUser);
  const plan = await opts.ask({ system: RULES, user: planUser, maxTokens: 96 }, opts.signal);
  let subs: string[];
  if (!plan.ok) {
    end(hp, { status: "failed", error: plan.error });
    return fail(`Planning failed: ${plan.error}`);
  }
  subs = parsePlan(plan.text ?? "");
  if (subs.length === 0) subs = [question];
  end(hp, { status: "ok", output: subs.map((s, i) => `${i + 1}. ${s}`).join("\n") });

  // Reason: each sub-question reads only its own slice of the notes.
  const findings: string[] = [];
  for (const [i, sub] of subs.entries()) {
    const slice = distribute(notes, `${question} ${sub}`);
    const user = `Notes:\n${slice || "(none)"}\n\nAnswer in two sentences or fewer: ${sub}`;
    const h = begin(`reason-${i}`, `Reason · ${sub}`, user);
    const r = await opts.ask({ system: RULES, user, maxTokens: 128 }, opts.signal);
    if (!r.ok) {
      end(h, { status: "failed", error: r.error });
      return fail(`Step "${sub}" failed: ${r.error}`);
    }
    findings.push(`${sub} — ${(r.text ?? "").trim()}`);
    end(h, { status: "ok", output: (r.text ?? "").trim() });
  }

  // Combine the findings, which are already short, into one answer.
  const combineUser = `Findings:\n${findings.join("\n").slice(0, STEP_NOTES_CHARS)}\n\nQuestion: ${question}\n\nWrite the answer in at most five sentences.`;
  const hc = begin("combine", "Combine", combineUser);
  const combined = await opts.ask({ system: RULES, user: combineUser, maxTokens: 256 }, opts.signal);
  if (!combined.ok) {
    end(hc, { status: "failed", error: combined.error });
    return fail(`Combining failed: ${combined.error}`);
  }
  const answer = (combined.text ?? "").trim();
  end(hc, { status: "ok", output: answer });

  // Check: the model reads its own answer against the notes. A doubt is shown,
  // not hidden, and does not replace the answer — the person decides.
  const checkUser = `Notes:\n${distribute(notes, answer, Math.floor(STEP_NOTES_CHARS / 2)) || "(none)"}\n\nAnswer:\n${answer.slice(0, 900)}\n\nDoes the answer follow from the notes? Reply OK, or name the claim that does not.`;
  const hk = begin("check", "Check", checkUser);
  const check = await opts.ask({ system: RULES, user: checkUser, maxTokens: 64 }, opts.signal);
  if (!check.ok) end(hk, { status: "failed", error: check.error });
  else end(hk, { status: "ok", output: (check.text ?? "").trim() });

  const note = missing > 0 ? `\n\n(${missing} source${missing === 1 ? "" : "s"} could not be read and were left out.)` : "";
  return { ok: true, answer: answer + note, steps };
}
