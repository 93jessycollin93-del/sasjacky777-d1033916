import { describe, expect, it } from "vitest";
import { buildStations } from "@/lib/constellation/stations";
import { resolveRoute } from "@/lib/routeManifest";
import { PARTITIONS } from "@/lib/partitions/registry";
import { CONTEXT_ROUTERS } from "@/lib/microai/contextRouter";

/**
 * The table is a map of the system, and a map that points at a road which is
 * not there is worse than no map. Every in-app station href is checked against
 * the router's own manifest, so a renamed route breaks this test rather than
 * dropping a person on a 404 from the one screen that is meant to orient them.
 */
const STATIONS = buildStations({
  fetch: async () => new Response("", { status: 200 }),
  jackyStatus: async () => "stub",
  storageBudgetMB: async () => 100_000,
  shellWorker: async () => "shell worker controlling · 1283 files held locally",
});

describe("station table", () => {
  it("points every in-app station at a route the app actually serves", () => {
    const internal = STATIONS.filter((s) => !s.external);
    const dead = internal.filter((s) => resolveRoute(s.href) === null).map((s) => `${s.id} → ${s.href}`);

    expect(internal.length).toBeGreaterThan(5);
    expect(dead, `stations pointing at unserved routes: ${dead.join(", ")}`).toEqual([]);
  });

  it("sends every external station to a full URL, never a bare path", () => {
    for (const station of STATIONS.filter((s) => s.external)) {
      expect(station.href, station.id).toMatch(/^https:\/\//);
    }
  });

  it("declares each station exactly once", () => {
    const ids = STATIONS.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("names the repo and offline behaviour of every station", () => {
    for (const station of STATIONS) {
      expect(station.repo, station.id).toMatch(/^[\w-]+\/[\w.-]+$/);
      expect(["full", "sync", "online-only"]).toContain(station.offline);
      expect(station.purpose.length, station.id).toBeGreaterThan(20);
    }
  });

  it("keeps every required station offline-capable", () => {
    // A required station that needed a network would make the flow itself
    // online-only, which is the thing this system is built not to be.
    for (const station of STATIONS.filter((s) => s.required)) {
      expect(station.offline, station.id).toBe("full");
    }
  });

  it("gives every stage at least one station", () => {
    for (const stage of ["ignition", "core", "workstation", "field"] as const) {
      expect(STATIONS.filter((s) => s.stage === stage).length, stage).toBeGreaterThan(0);
    }
  });

  it("checks the stations it claims to check and declares the rest", () => {
    const checkable = STATIONS.filter((s) => s.probe.method !== "declared");
    // Everything reachable from a browser is probed; only off-device runtimes
    // are declared, and all of those leave the app.
    expect(checkable.every((s) => !s.external)).toBe(true);
    expect(STATIONS.filter((s) => s.probe.method === "declared").every((s) => s.external)).toBe(true);
  });
});

describe("partitions and routers stay in step", () => {
  it("routes every partition to a router that exists", () => {
    const routerIds = new Set(CONTEXT_ROUTERS.map((r) => r.id));
    for (const partition of PARTITIONS) {
      expect(routerIds.has(partition.router), partition.id).toBe(true);
    }
  });

  it("gives every router at least one partition to read", () => {
    for (const router of CONTEXT_ROUTERS) {
      expect(router.reads.length, router.id).toBeGreaterThan(0);
      // `reads` is derived from the partition table, so the two cannot drift.
      const declared = PARTITIONS.filter((p) => p.router === router.id).map((p) => p.id);
      expect(router.reads).toEqual(declared);
    }
  });
});
