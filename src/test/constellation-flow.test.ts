import { describe, expect, it } from "vitest";
import { resolveFlow, statusesOf } from "@/lib/constellation/flow";
import type { Station, StationId, StationStatus } from "@/lib/constellation/types";
import { buildStations } from "@/lib/constellation/stations";

/**
 * The flow's whole job is to refuse to advance when a required station did not
 * answer. A test that only ever feeds it live stations proves nothing about
 * that — it exercises the one branch that was never in doubt.
 *
 * So each case here pins a specific verdict and asserts the consequence: which
 * stage is current, whether the walk is complete, and where the single next
 * action points. The stations are the real table, built over stub boundaries,
 * so a station that changes stage or loses its `required` flag shows up here.
 */
const STATIONS = buildStations({
  fetch: async () => new Response("", { status: 200 }),
  jackyStatus: async () => "stub",
  storageBudgetMB: async () => 100_000,
  shellWorker: async () => "shell worker controlling · 1283 files held locally",
});

function statuses(overrides: Partial<Record<StationId, StationStatus["state"]>>) {
  const map = new Map<StationId, StationStatus>();
  for (const station of STATIONS) {
    const state = overrides[station.id] ?? (station.probe.method === "declared" ? "declared" : "live");
    map.set(station.id, { id: station.id, state, detail: `stub ${state}`, checkedAt: 1 });
  }
  return map;
}

const required = (stations: Station[]) => stations.filter((s) => s.required).map((s) => s.id);

describe("resolveFlow", () => {
  it("completes the walk when every required station is live", () => {
    const flow = resolveFlow(STATIONS, statuses({}));

    expect(flow.complete).toBe(true);
    expect(flow.current).toBe("field");
    expect(flow.stages.every((s) => s.state === "ready")).toBe(true);
    expect(flow.next.href).toBe("/pc");
  });

  it("holds at ignition when the device cannot grant partition room", () => {
    const flow = resolveFlow(STATIONS, statuses({ partitions: "absent" }));

    expect(flow.complete).toBe(false);
    expect(flow.current).toBe("ignition");
    expect(flow.stages[0].state).toBe("blocked");
    expect(flow.stages[0].blockers).toContain("partitions");
    // The next step is the blocker, not the desk — advancing past a device that
    // cannot hold the system offline is the exact failure this prevents.
    expect(flow.next.label).toMatch(/Fix/);
    expect(flow.next.why).toMatch(/Ignition is held/);
  });

  it("holds at workstation when the PC build was never shipped", () => {
    const flow = resolveFlow(STATIONS, statuses({ "workstation-pc": "absent" }));

    expect(flow.current).toBe("workstation");
    expect(flow.next.href).toBe("/pc");
    expect(flow.next.label).toBe("Fix The PC");
  });

  it("clears the earliest blocker first when several stages are held", () => {
    const flow = resolveFlow(
      STATIONS,
      statuses({ partitions: "absent", "workstation-pc": "absent", vault: "absent" }),
    );

    expect(flow.current).toBe("ignition");
    expect(flow.next.label).toBe("Fix Offline Partitions");
  });

  it("does not let an optional station block its stage", () => {
    // The Jacky engine is a real station that is often simply not running.
    const flow = resolveFlow(STATIONS, statuses({ "jacky-engine": "absent" }));

    expect(flow.stages.find((s) => s.stage === "core")!.state).toBe("ready");
    expect(flow.complete).toBe(true);
  });

  it("treats a required station that has never been checked as blocking", () => {
    const partial = new Map<StationId, StationStatus>();
    const flow = resolveFlow(STATIONS, partial);

    expect(flow.complete).toBe(false);
    expect(flow.current).toBe("ignition");
    for (const id of required(STATIONS)) {
      const stage = flow.stages.find((s) => s.blockers.includes(id));
      expect(stage, `${id} should block its stage while unchecked`).toBeTruthy();
    }
  });

  it("counts only stations that can actually be checked as live", () => {
    const flow = resolveFlow(STATIONS, statuses({}));
    const declared = STATIONS.filter((s) => s.probe.method === "declared");

    expect(declared.length).toBeGreaterThan(0);
    expect(flow.checkableCount).toBe(STATIONS.length - declared.length);
    expect(flow.liveCount).toBe(flow.checkableCount);
  });

  it("hands back the same statuses it resolved from, so nothing derives from a second source", () => {
    const input = statuses({ "jacky-engine": "absent" });
    const derived = statusesOf(resolveFlow(STATIONS, input));

    expect(derived.size).toBe(STATIONS.length);
    for (const station of STATIONS) {
      expect(derived.get(station.id)?.state, station.id).toBe(input.get(station.id)?.state);
    }
  });

  it("fills in an unchecked station rather than leaving a hole in the lookup", () => {
    const derived = statusesOf(resolveFlow(STATIONS, new Map()));

    expect(derived.size).toBe(STATIONS.length);
    expect([...derived.values()].every((s) => s.state === "unknown")).toBe(true);
  });

  it("never reports a declared station as live just because it exists", () => {
    const flow = resolveFlow(STATIONS, statuses({}));
    const field = flow.stages.find((s) => s.stage === "field")!;
    const phone = field.stations.find((s) => s.station.id === "off-grid-mobile")!;

    expect(phone.status.state).toBe("declared");
    expect(field.blockers).toHaveLength(0);
  });
});
