/**
 * The station table — every part of the system, declared once.
 *
 * Before this, the constellation existed only as knowledge: which repo held the
 * engine, which build was framed by which route, what still had to be run by
 * hand on a rig. Nothing in the product could answer "what is this system made
 * of, and what of it is running", so nothing could hand a person a next step.
 *
 * The table is checked against the route manifest by a test, so an in-app
 * station cannot point at a path the router does not serve.
 */
import { jacky } from "@/lib/jackyClient";
import { checkGuideWeights, GUIDE_WEIGHTS_PATH } from "@/lib/guide/weights";
import { OLLAMA_HOST } from "@/lib/localAI";
import { LM_STUDIO_HOST } from "@/lib/lmStudio";
import { estimateStorageBudgetMB } from "@/lib/partitions/budget";
import { MINIMUM_BUDGET_MB, planBudget } from "@/lib/partitions/registry";
import {
  assetProbe,
  declaredProbe,
  inAppProbe,
  serviceProbe,
  withTimeout,
  type FetchLike,
} from "./probes";
import type { Station, StationProbe, StationProbeResult } from "./types";

export interface StationBoundaries {
  /** Used for asset and host probes. */
  fetch: FetchLike;
  /** Resolves with a line describing the Jacky engine, or throws. */
  jackyStatus: () => Promise<string>;
  /** Storage this device will actually grant, in MB. */
  storageBudgetMB: () => Promise<number>;
  /**
   * Resolves with a line describing the shell worker holding the app offline,
   * or throws saying why the app is online-only right now. Injected like the
   * rest: service workers and the cache API do not exist under test, and a
   * station that could only be checked in a browser could not be checked at all.
   */
  shellWorker: () => Promise<string>;
}

/**
 * The partition table is only "there" if the device will grant enough room to
 * satisfy every critical floor. A device that grants less can still run the
 * app — it cannot run it offline, which is the thing being claimed, so the
 * probe reports absent and names the shortfall instead of letting the flow
 * advance on a promise it cannot keep.
 */
function budgetProbe(estimate: () => Promise<number>): StationProbe {
  return {
    method: "navigator.storage.estimate()",
    async check(): Promise<StationProbeResult> {
      try {
        const budgetMB = await estimate();
        const plan = planBudget(budgetMB);
        if (!plan.viable) {
          const short = plan.partitions.filter((p) => !p.satisfied).map((p) => p.id);
          return {
            state: "absent",
            detail: `${Math.round(budgetMB)} MB granted, ${MINIMUM_BUDGET_MB} MB needed — short: ${short.join(", ")}`,
          };
        }
        return {
          state: "live",
          detail: `${Math.round(budgetMB)} MB granted, ${plan.headroomMB} MB spare over every floor`,
        };
      } catch (error) {
        return {
          state: "absent",
          detail: error instanceof Error ? error.message : String(error),
        };
      }
    },
  };
}

/**
 * The real boundaries, wired to the clients this repo already ships. Kept in
 * one factory so a test can build the same table over stubs and exercise the
 * real probe logic rather than a stand-in for it.
 */
export function defaultBoundaries(): StationBoundaries {
  return {
    fetch: (input, init) => fetch(input, init),
    storageBudgetMB: estimateStorageBudgetMB,
    jackyStatus: async () => {
      const status = await jacky.getStatus();
      const gpu = status.gpu?.temp_c;
      return gpu === undefined
        ? `engine ${status.status}, cpu ${status.cpu}%`
        : `engine ${status.status}, cpu ${status.cpu}%, gpu ${gpu}°C`;
    },
    shellWorker: async () => {
      const nav = typeof navigator === "undefined" ? undefined : navigator;
      if (!nav || !("serviceWorker" in nav)) {
        throw new Error("this browser has no service worker, so the app cannot be held offline");
      }
      const registrations = await nav.serviceWorker.getRegistrations();
      const shell = registrations.find((r) =>
        (r.active ?? r.installing ?? r.waiting)?.scriptURL.endsWith("/sw.js"),
      );
      if (!shell) throw new Error("no shell worker registered — the app is online-only until one is");
      // Registered is not the same as ready. A worker still precaching, or one
      // that has finished but not claimed this page, leaves the next navigation
      // going to the network — where, offline, it dies on a browser error page.
      if (!nav.serviceWorker.controller) {
        const state = shell.installing
          ? "still installing"
          : shell.waiting
            ? "waiting to activate"
            : "not yet controlling this page";
        throw new Error(`shell worker is ${state} — reload once it settles before relying on offline`);
      }
      const names = typeof caches === "undefined" ? [] : await caches.keys();
      const counts = await Promise.all(
        names.map(async (name) => (await (await caches.open(name)).keys()).length),
      );
      const held = counts.reduce((sum, n) => sum + n, 0);
      return `shell worker controlling · ${held} files held locally`;
    },
  };
}

export function buildStations(boundaries: StationBoundaries): Station[] {
  const { fetch: fetchImpl, jackyStatus, storageBudgetMB, shellWorker } = boundaries;

  return [
    {
      id: "jackie-shell",
      name: "Jackie",
      repo: "yyb84ycgt6-oss/sasjacky777-d1033916",
      purpose: "The shell every other station is entered through. This app.",
      stage: "ignition",
      href: "/",
      offline: "full",
      required: true,
      probe: inAppProbe("The Jackie shell"),
    },
    {
      id: "partitions",
      name: "Offline Partitions",
      repo: "yyb84ycgt6-oss/sasjacky777-d1033916",
      purpose: "Reserved local storage with rotating backups. What makes offline the default.",
      stage: "ignition",
      href: "/workstation",
      offline: "full",
      required: true,
      probe: withTimeout(budgetProbe(storageBudgetMB)),
    },
    {
      id: "guide",
      name: "Guide Model",
      repo: "yyb84ycgt6-oss/sasjacky777-d1033916",
      purpose:
        "Bonsai 1.7B, shipped with the app. The model that answers how to use this system, on every screen, with the radio off.",
      stage: "core",
      href: "/guide",
      offline: "full",
      probe: withTimeout(
        serviceProbe(`HEAD ${GUIDE_WEIGHTS_PATH}`, async (signal) => {
          const found = await checkGuideWeights(
            (input, init) => fetchImpl(String(input), { ...init, signal }),
          );
          if (!found.present) throw new Error(found.detail);
          return found.detail;
        }),
      ),
    },
    {
      id: "self-host",
      name: "Self Host",
      repo: "yyb84ycgt6-oss/sasjacky777-d1033916",
      purpose:
        "The host attachment: a folder dropped beside a build that serves the whole system with no dependencies and no network.",
      stage: "ignition",
      href: "/workstation",
      offline: "full",
      probe: withTimeout(
        serviceProbe("GET /__host/health", async (signal) => {
          const res = await fetchImpl("/__host/health", { signal });
          if (!res.ok) throw new Error(`host → HTTP ${res.status}`);
          const body = (await res.json()) as { root?: string };
          return `serving from ${body.root ?? "an unnamed root"}`;
        }),
      ),
    },
    {
      id: "offline-shell",
      name: "Offline Shell",
      repo: "yyb84ycgt6-oss/sasjacky777-d1033916",
      purpose:
        "The service worker holding the app itself. Until it is installed and controlling this page, closing the network closes the app.",
      stage: "ignition",
      required: true,
      offline: "full",
      href: "/workstation",
      probe: withTimeout(serviceProbe("navigator.serviceWorker.controller", shellWorker)),
    },
    {
      id: "vault",
      name: "Vault",
      repo: "yyb84ycgt6-oss/core-light-vault",
      purpose: "Identity and the records that must survive everything else being wiped.",
      stage: "core",
      href: "/vault",
      offline: "full",
      required: true,
      probe: inAppProbe("The vault surface"),
    },
    {
      id: "core-keeper",
      name: "Core Keeper",
      repo: "yyb84ycgt6-oss/jackie-core-keeper",
      purpose: "Core identity, doctrine and the setup that has to hold across rebuilds.",
      stage: "core",
      href: "/core",
      offline: "full",
      probe: inAppProbe("Jackie Core"),
    },
    {
      id: "jacky-engine",
      name: "Jacky Engine",
      repo: "yyb84ycgt6-oss/jacky",
      purpose:
        "The Python orchestrator: reads GPU thermals and memory, then decides local, free cloud or paid.",
      stage: "core",
      href: "/jacky-live",
      offline: "sync",
      probe: withTimeout(serviceProbe("jacky-proxy → /api/status", jackyStatus)),
    },
    {
      id: "jacky-console",
      name: "Jacky Console",
      repo: "yyb84ycgt6-oss/Jacky-Console-",
      purpose: "Direct controls for the engine — thinking mode, squads, live task routing.",
      stage: "core",
      href: "/control",
      offline: "sync",
      probe: inAppProbe("Jackie Control"),
    },
    {
      id: "workstation-pc",
      name: "The PC",
      repo: "yyb84ycgt6-oss/my-pc-companion",
      purpose: "The desktop shell: windows, dock, terminal and the whole app roster.",
      stage: "workstation",
      href: "/pc",
      offline: "full",
      required: true,
      probe: withTimeout(assetProbe("/pc-os/index.html", fetchImpl)),
    },
    {
      id: "bot-foundry",
      name: "Bot Foundry",
      repo: "yyb84ycgt6-oss/sasjacky777-d1033916",
      purpose: "Where bots are built, given instructions and sent to the swarm.",
      stage: "workstation",
      href: "/bots",
      offline: "sync",
      probe: inAppProbe("The Bot Foundry"),
    },
    {
      id: "router-mesh",
      name: "Router Mesh",
      repo: "yyb84ycgt6-oss/sasjacky777-d1033916",
      purpose: "How a request finds an engine — the routing surface over every provider.",
      stage: "workstation",
      href: "/mesh",
      offline: "full",
      probe: inAppProbe("The Router Mesh"),
    },
    {
      id: "pod-station",
      name: "Pod Station",
      repo: "yyb84ycgt6-oss/sasjacky777-d1033916",
      purpose: "Pod seeds and fold surfaces — the compression side of the system.",
      stage: "workstation",
      href: "/pods",
      offline: "full",
      probe: inAppProbe("The Pod Station"),
    },
    {
      id: "ollama",
      name: "Ollama Host",
      repo: "yyb84ycgt6-oss/jacky",
      purpose: "Models already on the machine. The first rung of every offline ladder.",
      stage: "field",
      href: "/local-ai",
      offline: "full",
      probe: withTimeout(
        serviceProbe(`GET ${OLLAMA_HOST}/api/tags`, async (signal) => {
          const res = await fetchImpl(`${OLLAMA_HOST}/api/tags`, { signal });
          if (!res.ok) throw new Error(`ollama → HTTP ${res.status}`);
          const body = (await res.json()) as { models?: unknown[] };
          return `${body.models?.length ?? 0} models loaded locally`;
        }),
      ),
    },
    {
      id: "lm-studio",
      name: "LM Studio Hub",
      repo: "yyb84ycgt6-oss/jacky",
      purpose:
        "The operator's weights, served where they already live. One file, one server, every client — no second copy on disk.",
      stage: "field",
      href: "/bridge",
      offline: "full",
      probe: withTimeout(
        serviceProbe(`GET ${LM_STUDIO_HOST}/v1/models`, async (signal) => {
          const res = await fetchImpl(`${LM_STUDIO_HOST}/v1/models`, { signal });
          if (!res.ok) throw new Error(`lm studio → HTTP ${res.status}`);
          const body = (await res.json()) as { data?: unknown[] };
          const count = body.data?.length ?? 0;
          if (!count) throw new Error("server is up but no model is loaded");
          return `${count} model${count === 1 ? "" : "s"} loaded in the hub`;
        }),
      ),
    },
    {
      id: "off-grid-mobile",
      name: "Off Grid Mobile",
      repo: "yyb84ycgt6-oss/off-grid-ai-mobile",
      purpose: "The phone client. Runs a model in the phone's own RAM, no network path at all.",
      stage: "field",
      href: "https://github.com/yyb84ycgt6-oss/off-grid-ai-mobile",
      external: true,
      offline: "full",
      probe: declaredProbe("iOS and Android devices"),
    },
    {
      id: "llmfarm",
      name: "LLMFarm",
      repo: "yyb84ycgt6-oss/llmfarm",
      purpose: "On-device inference on Apple hardware, built on llama.cpp.",
      stage: "field",
      href: "https://github.com/yyb84ycgt6-oss/llmfarm",
      external: true,
      offline: "full",
      probe: declaredProbe("iOS and macOS devices"),
    },
    {
      id: "mobile-llm",
      name: "MobileLLM",
      repo: "yyb84ycgt6-oss/MobileLLM",
      purpose: "Sub-billion-parameter models sized for phones — what the Model Bay is stocked with.",
      stage: "field",
      href: "https://github.com/yyb84ycgt6-oss/MobileLLM",
      external: true,
      offline: "full",
      probe: declaredProbe("training and export machines"),
    },
    {
      id: "llama-cpp",
      name: "llama.cpp",
      repo: "yyb84ycgt6-oss/llama.cpp",
      purpose: "The inference library every on-device runtime here is built on.",
      stage: "field",
      href: "https://github.com/yyb84ycgt6-oss/llama.cpp",
      external: true,
      offline: "full",
      probe: declaredProbe("any machine that compiles it"),
    },
    {
      id: "mobilerun",
      name: "MobileRun",
      repo: "yyb84ycgt6-oss/mobilerun",
      purpose: "Drives an Android device from an agent — the hands at the far end.",
      stage: "field",
      href: "https://github.com/yyb84ycgt6-oss/mobilerun",
      external: true,
      offline: "sync",
      probe: declaredProbe("a connected Android device"),
    },
    {
      id: "xagent",
      name: "Xagent",
      repo: "yyb84ycgt6-oss/xagent",
      purpose: "Agent runtime with ReAct and DAG patterns, for work too long for one call.",
      stage: "field",
      href: "https://github.com/yyb84ycgt6-oss/xagent",
      external: true,
      offline: "sync",
      probe: declaredProbe("a server or workstation"),
    },
  ];
}

/** The table as the app uses it. */
export const STATIONS: Station[] = buildStations(defaultBoundaries());
