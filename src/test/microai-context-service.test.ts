import { describe, expect, it, vi } from "vitest";
import { ContextRouterService, CONTEXT_DEPTH } from "@/lib/microai/contextRouterService";
import type { InferenceEngine } from "@/lib/microai/contextRouter";
import { PartitionService } from "@/lib/partitions/service";
import { MemoryPartitionStore } from "@/lib/partitions/store";

/**
 * The real service, the real partition service, a real in-memory store. The
 * only stand-ins are the engines, and they are dumb — they echo the prompt they
 * were handed, which is what lets the assertions be about the context that
 * actually reached the model rather than about which functions ran.
 */
function engineStub(
  id: string,
  locality: InferenceEngine["locality"],
  available = true,
): InferenceEngine & { prompts: string[] } {
  const prompts: string[] = [];
  return {
    id,
    name: id,
    locality,
    prompts,
    available: async () => available,
    run: async (prompt, model) => {
      prompts.push(prompt);
      return { text: `answered by ${id} as ${model}`, model: model ?? id };
    },
  };
}

function build(engines: InferenceEngine[], clock = { t: 1_000 }) {
  const store = new MemoryPartitionStore();
  const partitions = new PartitionService(store, () => clock.t);
  const service = new ContextRouterService(partitions, engines, () => clock.t);
  return { store, partitions, service, clock };
}

describe("ContextRouterService", () => {
  it("answers from the partitions its router is expert in", async () => {
    const device = engineStub("micro", "device");
    const { partitions, service } = build([device]);

    await partitions.put("context", "rig-notes", "the 3090 throttles at 75C");
    await partitions.put("media", "unrelated", "a picture of a cat");

    const answer = await service.ask("what did we learn about the rig", false);

    expect(answer.router.id).toBe("recall");
    expect(answer.engine).toBe(device);
    // Recall reads context and conversations — never the Maker's media.
    expect(answer.context.map((c) => c.key)).toContain("rig-notes");
    expect(answer.context.map((c) => c.key)).not.toContain("unrelated");
    expect(device.prompts[0]).toContain("the 3090 throttles at 75C");
    expect(device.prompts[0]).not.toContain("a picture of a cat");
  });

  it("works with no network at all", async () => {
    const device = engineStub("micro", "device");
    const { service } = build([device]);

    const answer = await service.ask("hello", false);

    expect(answer.text).toMatch(/answered by micro/);
  });

  it("returns no engine, and writes nothing, when only a network engine is ready offline", async () => {
    const cloud = engineStub("claude", "network");
    const { partitions, service } = build([cloud]);

    const answer = await service.ask("what did we decide", false);

    expect(answer.engine).toBeNull();
    expect(answer.text).toBe("");
    expect(answer.reason).toMatch(/no engine ready/);
    expect(cloud.prompts).toHaveLength(0);
    // Nothing was answered, so nothing is written back as if it had been.
    expect(await partitions.list("conversations")).toHaveLength(0);
  });

  it("uses that same network engine once there is a network", async () => {
    const cloud = engineStub("claude", "network");
    const { service } = build([cloud]);

    const answer = await service.ask("what did we decide", true);

    expect(answer.engine).toBe(cloud);
    expect(answer.text).toMatch(/answered by claude/);
  });

  it("writes the exchange back where Recall will find it next time", async () => {
    const device = engineStub("micro", "device");
    const { partitions, service, clock } = build([device]);

    await service.ask("remember the port is 11434", false);

    const stored = await partitions.list("conversations");
    expect(stored).toHaveLength(1);
    expect(stored[0].key).toBe(`recall-${clock.t}`);
    expect(JSON.parse(stored[0].body)).toMatchObject({ router: "recall", engine: "micro" });

    // And it comes back as context on the next question.
    const answer = await service.ask("what was the port", false);
    expect(device.prompts[1]).toContain("11434");
    expect(answer.context.some((c) => c.partition === "conversations")).toBe(true);
  });

  it("keeps vault context out of a network engine even when online", async () => {
    const cloud = engineStub("claude", "network");
    const { partitions, service } = build([cloud]);

    await partitions.put("vault", "api-key", "sk-do-not-send-this");

    const answer = await service.ask("what api key is stored in the vault", true);

    expect(answer.router.id).toBe("keeper");
    expect(answer.engine).toBeNull();
    expect(cloud.prompts).toHaveLength(0);
  });

  it("caps the context it sends to the newest records", async () => {
    const device = engineStub("micro", "device");
    const { partitions, service, clock } = build([device]);

    for (let i = 0; i < CONTEXT_DEPTH + 4; i++) {
      clock.t += 10;
      await partitions.put("context", `note-${i}`, `note body ${i}`);
    }

    const answer = await service.ask("what do you know", false);

    expect(answer.context).toHaveLength(CONTEXT_DEPTH);
    expect(device.prompts[0]).toContain(`note body ${CONTEXT_DEPTH + 3}`);
    expect(device.prompts[0]).not.toContain("note body 0");
  });

  it("asks the engines once across repeated questions, then holds the route", async () => {
    const available = vi.fn(async () => true);
    const device: InferenceEngine = {
      id: "micro",
      name: "micro",
      locality: "device",
      available,
      run: async (prompt, model) => ({ text: "ok", model: model ?? "micro" }),
    };
    const { service } = build([device]);

    await service.ask("first question", false);
    await service.ask("second question", false);
    await service.ask("third question", false);

    // One probe and one route derivation for three answers. Deleting the plan
    // cache makes this three and three.
    expect(available).toHaveBeenCalledTimes(1);
    expect(service.getStats()).toMatchObject({ asks: 3, held: 2, replanned: 1, looks: 1 });
  });

  it("re-derives the route when the engine it was holding goes away", async () => {
    let up = true;
    const device: InferenceEngine = {
      id: "micro",
      name: "micro",
      locality: "device",
      available: async () => up,
      run: async () => ({ text: "ok", model: "micro" }),
    };
    const clock = { t: 1_000 };
    const { service } = build([device], clock);

    const first = await service.ask("question one", false);
    expect(first.engine).toBe(device);
    expect(first.replanned).toBe(true);

    // Move past the observation window so the next ask genuinely looks again.
    up = false;
    clock.t += 60_000;

    const second = await service.ask("question two", false);

    expect(second.replanned).toBe(true);
    expect(second.engine).toBeNull();
    expect(service.getStats().lastReplanReason).toMatch(/expired|stopped answering/);
  });

  it("exposes the standing plan and what it is watching", async () => {
    const device = engineStub("micro", "device");
    const lan = engineStub("ollama", "lan");
    const { service } = build([lan, device]);

    await service.ask("what did we decide", false);
    const plan = service.getPlan("recall");

    expect(plan?.engineId).toBe("micro");
    expect(plan?.invariants).toContainEqual({ kind: "engine-ready", engineId: "micro" });
    expect(service.getPlan("keeper")).toBeNull();
  });

  it("treats an engine that throws while reporting availability as not ready", async () => {
    const flaky: InferenceEngine = {
      id: "flaky",
      name: "flaky",
      locality: "device",
      available: async () => {
        throw new Error("probe blew up");
      },
      run: async () => ({ text: "should not happen", model: "flaky" }),
    };
    const run = vi.spyOn(flaky, "run");
    const { service } = build([flaky]);

    const answer = await service.ask("anything", false);

    expect(answer.engine).toBeNull();
    expect(run).not.toHaveBeenCalled();
  });
});
