import { describe, expect, it } from "vitest";
import {
  buildCompatibilityReport,
  capabilitiesFrom,
  getAllIntegrations,
  getIntegrationsByCategory,
  getPriorityStack,
  isRunnable,
  runnableTools,
  type EnvironmentCapabilities,
} from "@/lib/constellation/integrations";
import type { StationId, StationStatus } from "@/lib/constellation/types";

/**
 * The roster's only real job is telling the truth about what will start here.
 * A test that feeds it an environment where everything is true proves nothing —
 * every tool passes. So the cases below are the ones that matter: a capability
 * missing, an id that names nothing, and an environment derived from stations
 * that did not answer.
 */
const NOTHING: EnvironmentCapabilities = {
  docker: false,
  node: false,
  python: false,
  gpu: false,
  vscodeExtensionHost: false,
  localOllama: false,
  openWebUI: false,
  cloudProxy: false,
};

const EVERYTHING: EnvironmentCapabilities = {
  docker: true,
  node: true,
  python: true,
  gpu: true,
  vscodeExtensionHost: true,
  localOllama: true,
  openWebUI: true,
  cloudProxy: true,
};

function statuses(live: StationId[]): Map<StationId, StationStatus> {
  const map = new Map<StationId, StationStatus>();
  for (const id of live) {
    map.set(id, { id, state: "live", detail: "stub", checkedAt: 1 });
  }
  return map;
}

describe("the integration roster", () => {
  it("declares every tool once, with at least one requirement and deployment mode", () => {
    const tools = getAllIntegrations();
    const ids = tools.map((t) => t.id);

    expect(new Set(ids).size).toBe(ids.length);
    for (const tool of tools) {
      expect(tool.deployment.length, tool.id).toBeGreaterThan(0);
      expect(tool.requirements.length, tool.id).toBeGreaterThan(0);
    }
  });

  it("covers every area rather than stacking one category", () => {
    for (const category of [
      "coding-assistant",
      "agent-framework",
      "model-runner",
      "orchestration",
      "memory",
      "search",
      "browser-automation",
      "voice",
      "development-tool",
    ] as const) {
      expect(getIntegrationsByCategory(category).length, category).toBeGreaterThan(2);
    }
  });

  it("resolves every id in the priority stack", () => {
    const stack = getPriorityStack();
    expect(stack).toHaveLength(15);
    expect(stack.every((tool) => tool.id.length > 0)).toBe(true);
  });
});

describe("buildCompatibilityReport", () => {
  it("names the exact capability a tool is missing", () => {
    const gaps = buildCompatibilityReport(["openhands"], { ...NOTHING, python: true });
    expect(gaps).toEqual([{ toolId: "openhands", missing: ["docker"] }]);
  });

  it("lists every missing capability, not just the first", () => {
    const gaps = buildCompatibilityReport(["openhands"], NOTHING);
    expect(gaps[0].missing).toEqual(["docker", "python"]);
  });

  it("reports an unknown id as a missing definition instead of passing it", () => {
    expect(buildCompatibilityReport(["not-a-tool"], EVERYTHING)).toEqual([
      { toolId: "not-a-tool", missing: ["tool-definition"] },
    ]);
  });

  it("returns no gaps when the environment satisfies the tool", () => {
    expect(buildCompatibilityReport(["ollama"], { ...NOTHING, localOllama: true })).toEqual([]);
  });
});

describe("runnableTools", () => {
  it("returns nothing on a machine with no capabilities at all", () => {
    expect(runnableTools(NOTHING)).toEqual([]);
  });

  it("returns only what the one available capability supports", () => {
    const runnable = runnableTools({ ...NOTHING, localOllama: true });
    expect(runnable.map((t) => t.id)).toEqual(["ollama"]);
  });

  it("agrees with isRunnable for every tool", () => {
    const env = { ...NOTHING, python: true, gpu: true };
    const runnable = new Set(runnableTools(env).map((t) => t.id));
    for (const tool of getAllIntegrations()) {
      expect(runnable.has(tool.id), tool.id).toBe(isRunnable(tool, env));
    }
  });
});

describe("capabilitiesFrom", () => {
  it("claims nothing when no station answered", () => {
    expect(capabilitiesFrom(new Map())).toEqual(NOTHING);
    expect(runnableTools(capabilitiesFrom(new Map()))).toEqual([]);
  });

  it("claims a local Ollama only when its probe came back live", () => {
    expect(capabilitiesFrom(statuses(["ollama"])).localOllama).toBe(true);
    expect(capabilitiesFrom(statuses(["jacky-engine"])).localOllama).toBe(false);
  });

  it("does not claim a capability a browser cannot see", () => {
    const env = capabilitiesFrom(statuses(["ollama", "jacky-engine"]));
    expect(env.docker).toBe(false);
    expect(env.node).toBe(false);
    expect(env.vscodeExtensionHost).toBe(false);
  });

  it("lets the host supply what the browser cannot observe", () => {
    const env = capabilitiesFrom(statuses(["ollama"]), { docker: true, node: true });
    expect(env.docker).toBe(true);
    expect(env.node).toBe(true);
    // And the derived facts are still derived, not overwritten by the default.
    expect(env.localOllama).toBe(true);
  });

  it("turns a live engine into the python, gpu and proxy capabilities that depend on it", () => {
    const env = capabilitiesFrom(statuses(["jacky-engine"]));
    expect([env.python, env.gpu, env.cloudProxy]).toEqual([true, true, true]);

    const dead = capabilitiesFrom(statuses([]));
    expect([dead.python, dead.gpu, dead.cloudProxy]).toEqual([false, false, false]);
  });

  it("shrinks the runnable roster when a station goes down", () => {
    const withEngine = runnableTools(capabilitiesFrom(statuses(["ollama", "jacky-engine"])));
    const withoutEngine = runnableTools(capabilitiesFrom(statuses(["ollama"])));

    expect(withEngine.length).toBeGreaterThan(withoutEngine.length);
    expect(withoutEngine.map((t) => t.id)).toEqual(["ollama"]);
  });
});
