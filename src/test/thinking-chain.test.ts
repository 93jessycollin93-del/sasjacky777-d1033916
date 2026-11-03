import { describe, expect, it } from "vitest";
import { compress, distribute, STEP_NOTES_CHARS } from "@/lib/microai/chain/compress";
import { parsePlan, runChain, type Ask } from "@/lib/microai/chain/chain";
import { archive, recall } from "@/lib/microai/chain/archive";

const long = Array.from({ length: 200 }, (_, i) => `Filler sentence number ${i} about nothing much.`).join(" ") +
  " The NVMe drive shows error 0xC0000185 in storport.sys.";

describe("thinking chain", () => {
  it("never hands a step more notes than its budget, however long the sources", () => {
    const notes = [
      { label: "a", text: long },
      { label: "b", text: long },
      { label: "c", text: long },
    ];
    expect(distribute(notes, "nvme error").length).toBeLessThanOrEqual(STEP_NOTES_CHARS);
  });

  it("keeps the sentence carrying the error code when compressing", () => {
    expect(compress(long, "why is the nvme drive failing", 300)).toContain("0xC0000185");
  });

  it("keeps the full original in the archive after compression drops it", async () => {
    const { entry } = await archive({ label: "log", kind: "text", text: long });
    expect((await recall(entry.id))?.text).toBe(long);
  });

  it("caps the plan at three sub-questions", () => {
    expect(parsePlan("1. a one\n2. b two\n3. c three\n4. d four")).toHaveLength(3);
  });

  it("reports a failed step as a failure, not an answer", async () => {
    const ask: Ask = async () => ({ ok: false, error: "Bonsai is not downloaded" });
    const r = await runChain({ question: "why?", sources: [], ask });
    expect(r.ok).toBe(false);
    expect(r.steps.find((s) => s.id === "plan")?.status).toBe("failed");
  });

  it("names the sources it could not read in the final answer", async () => {
    const ask: Ask = async () => ({ ok: true, text: "1. what failed" });
    const r = await runChain({
      question: "what failed?",
      sources: [{ label: "photo", kind: "image", fetch: async () => { throw new Error("no model"); } }],
      ask,
    });
    expect(r.ok).toBe(true);
    expect(r.answer).toContain("1 source could not be read");
  });
});
