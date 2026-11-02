import { describe, expect, it, vi } from "vitest";
import { ConstellationService } from "@/lib/constellation/service";
import { assetProbe, serviceProbe, withTimeout } from "@/lib/constellation/probes";
import { buildStations } from "@/lib/constellation/stations";
import type { Station } from "@/lib/constellation/types";

/**
 * The service is driven for real here. Only the boundaries are stubbed — a
 * fetch that returns a status code, an engine call that resolves or throws —
 * and everything the probes and the service do with those answers runs as
 * shipped.
 *
 * This is deliberately not a test that a probe "was called". A caller can call
 * a probe, ignore the verdict and advance anyway; asserting the call passes
 * straight over that defect. Every case below asserts the state that came out
 * the other side.
 */
function stationsWith(overrides: {
  asset?: number | Error;
  jacky?: string | Error;
  budgetMB?: number | Error;
  shell?: string | Error;
}): Station[] {
  return buildStations({
    fetch: async (url) => {
      if (overrides.asset instanceof Error) throw overrides.asset;
      if (url.includes("/api/tags")) {
        return new Response(JSON.stringify({ models: [{ name: "llama3.2" }] }), { status: 200 });
      }
      return new Response("", { status: overrides.asset ?? 200 });
    },
    jackyStatus: async () => {
      if (overrides.jacky instanceof Error) throw overrides.jacky;
      return overrides.jacky ?? "engine ok";
    },
    storageBudgetMB: async () => {
      if (overrides.budgetMB instanceof Error) throw overrides.budgetMB;
      return overrides.budgetMB ?? 100_000;
    },
    shellWorker: async () => {
      if (overrides.shell instanceof Error) throw overrides.shell;
      return overrides.shell ?? "shell worker controlling · 1283 files held locally";
    },
  });
}

describe("ConstellationService", () => {
  it("turns a healthy sweep into a complete flow", async () => {
    const service = new ConstellationService(stationsWith({}), () => true, () => 42);
    const snapshot = await service.refresh();

    expect(snapshot.flow.complete).toBe(true);
    expect(snapshot.lastCheckedAt).toBe(42);
    expect(service.getStatus("workstation-pc")?.state).toBe("live");
    expect(service.getStatus("ollama")?.detail).toMatch(/1 models loaded locally/);
  });

  it("blocks the flow when the PC build is missing, rather than advancing past it", async () => {
    const service = new ConstellationService(stationsWith({ asset: 404 }), () => true);
    const snapshot = await service.refresh();

    expect(service.getStatus("workstation-pc")?.state).toBe("absent");
    expect(service.getStatus("workstation-pc")?.detail).toMatch(/HTTP 404/);
    expect(snapshot.flow.complete).toBe(false);
    expect(snapshot.flow.current).toBe("workstation");
  });

  it("reports the self-host station absent when nothing is serving its health endpoint", async () => {
    // The ordinary case: the app is behind some other server, so /__host/health
    // is not there. That is not a failure — the station is optional — but it
    // must read as absent rather than as a host that answered.
    const service = new ConstellationService(stationsWith({ asset: 404 }), () => true);
    await service.refresh();

    expect(service.getStatus("self-host")?.state).toBe("absent");
  });

  it("holds ignition while the shell worker is still installing, rather than promising offline", async () => {
    // The failure this exists for was measured, not imagined: a worker that had
    // precached most of the app but had not claimed the page left every offline
    // navigation on the browser's own "No internet" screen. Registered is not
    // ready, and the flow must not advance as though it were.
    const service = new ConstellationService(
      stationsWith({ shell: new Error("shell worker is still installing — reload once it settles before relying on offline") }),
      () => true,
      () => 42,
    );
    const snapshot = await service.refresh();

    const shell = service.getStatus("offline-shell");
    expect(shell?.state).toBe("absent");
    expect(shell?.detail).toMatch(/still installing/);
    expect(snapshot.flow.current).toBe("ignition");
    expect(snapshot.flow.complete).toBe(false);
  });

  it("reports the shell worker holding the app once it controls the page", async () => {
    const service = new ConstellationService(stationsWith({}), () => true, () => 42);
    await service.refresh();

    const shell = service.getStatus("offline-shell");
    expect(shell?.state).toBe("live");
    expect(shell?.detail).toMatch(/controlling/);
  });

  it("holds ignition when the device grants too little storage to be offline", async () => {
    const service = new ConstellationService(stationsWith({ budgetMB: 300 }), () => true);
    const snapshot = await service.refresh();

    const status = service.getStatus("partitions");
    expect(status?.state).toBe("absent");
    expect(status?.detail).toMatch(/short: /);
    expect(snapshot.flow.current).toBe("ignition");
  });

  it("records a station that throws as absent instead of failing the whole sweep", async () => {
    const service = new ConstellationService(
      stationsWith({ jacky: new Error("jacky-proxy unreachable") }),
      () => true,
    );
    const snapshot = await service.refresh();

    expect(service.getStatus("jacky-engine")?.state).toBe("absent");
    expect(service.getStatus("jacky-engine")?.detail).toBe("jacky-proxy unreachable");
    // Every other station still got its answer.
    expect(service.getStatus("jackie-shell")?.state).toBe("live");
    expect(snapshot.flow.liveCount).toBeGreaterThan(3);
  });

  it("stays fully walkable with no network at all", async () => {
    // Offline: the engine and its proxy are gone, and nothing else should care.
    const service = new ConstellationService(
      stationsWith({ jacky: new Error("offline") }),
      () => false,
    );
    const snapshot = await service.refresh();

    expect(snapshot.online).toBe(false);
    expect(snapshot.flow.complete).toBe(true);
    expect(snapshot.flow.next.href).toBe("/pc");
  });

  it("notifies subscribers and swaps the snapshot identity only on change", async () => {
    const service = new ConstellationService(stationsWith({}), () => true);
    const seen = vi.fn();
    const unsubscribe = service.subscribe(seen);

    const before = service.getSnapshot();
    await service.refresh();
    const after = service.getSnapshot();

    expect(seen).toHaveBeenCalled();
    expect(after).not.toBe(before);
    expect(service.getSnapshot()).toBe(after);

    unsubscribe();
    service.setOnline(false);
    const callsAfterUnsubscribe = seen.mock.calls.length;
    service.setOnline(true);
    expect(seen.mock.calls.length).toBe(callsAfterUnsubscribe);
  });

  it("shares one sweep between concurrent callers", async () => {
    const probed = vi.fn(async () => "engine ok");
    const service = new ConstellationService(
      buildStations({
        fetch: async () => new Response("", { status: 200 }),
        jackyStatus: probed,
        storageBudgetMB: async () => 100_000,
        shellWorker: async () => "shell worker controlling · 1283 files held locally",
      }),
      () => true,
    );

    const [a, b] = await Promise.all([service.refresh(), service.refresh()]);

    expect(a).toBe(b);
    expect(probed).toHaveBeenCalledTimes(1);
  });
});

describe("probes", () => {
  it("reports an asset absent when the request itself fails", async () => {
    const probe = assetProbe("/pc-os/index.html", async () => {
      throw new Error("network down");
    });
    expect(await probe.check()).toEqual({
      state: "absent",
      detail: "/pc-os/index.html → network down",
    });
  });

  it("gives up on a hung boundary instead of leaving the sweep pending", async () => {
    const hang = serviceProbe("hangs", (signal) =>
      new Promise<string>((_resolve, reject) => {
        signal?.addEventListener("abort", () => reject(new Error("aborted")));
      }),
    );

    const result = await withTimeout(hang, 5).check();
    expect(result.state).toBe("absent");
  });
});
