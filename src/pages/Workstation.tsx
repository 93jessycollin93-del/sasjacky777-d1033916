import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  Activity,
  ArrowRight,
  CheckCircle2,
  CloudOff,
  Database,
  HardDrive,
  Loader2,
  RefreshCw,
  ShieldCheck,
  Wifi,
  XCircle,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { useConstellation } from "@/hooks/useConstellation";
import { useTranslation } from "@/hooks/useTranslation";
import { LocalePicker } from "@/components/LocalePicker";
import { useSquads } from "@/hooks/useSquads";
import { SquadBoard } from "@/components/squad/SquadBoard";
import { constellation } from "@/lib/constellation/service";
import {
  buildCompatibilityReport,
  capabilitiesFrom,
  getPriorityStack,
  isRunnable,
} from "@/lib/constellation/integrations";
import { defaultSyncSteps } from "@/lib/constellation/steps";
import { statusesOf } from "@/lib/constellation/flow";
import { runSync, type SyncReport } from "@/lib/constellation/sync";
import type { StationState } from "@/lib/constellation/types";
import { CONTEXT_ROUTERS, routerModel } from "@/lib/microai/contextRouter";
import {
  ContextRouterService,
  defaultEngines,
  type RoutedAnswer,
} from "@/lib/microai/contextRouterService";
import {
  estimateStorageBudgetMB,
  findPartition,
  MINIMUM_BUDGET_MB,
  partitions,
  planBudget,
  requestDurableStorage,
  type BudgetPlan,
  type PartitionUsage,
} from "@/lib/partitions";

/**
 * /workstation — the one place the whole system is entered from.
 *
 * Every screen before this one showed a piece: a route list, a bot foundry, a
 * desktop in a frame. None of them could say what the system was made of or
 * what of it was actually running, so knowing that stayed in someone's head.
 * This is the walk instead — ignition, core, workstation, field — with the
 * offline ground it stands on underneath it, and exactly one next step.
 *
 * A View and nothing more: the flow, the statuses and the next action all come
 * from the constellation service, storage from the partition service.
 */

const STATE_STYLE: Record<StationState, { label: string; className: string }> = {
  live: { label: "live", className: "border-emerald-500/40 text-emerald-500" },
  declared: { label: "declared", className: "border-sky-500/40 text-sky-500" },
  absent: { label: "absent", className: "border-destructive/40 text-destructive" },
  unknown: { label: "checking", className: "border-muted-foreground/30 text-muted-foreground" },
};

export default function Workstation() {
  const { flow, online, checking, lastCheckedAt, refresh } = useConstellation();
  const { t, time, bytes } = useTranslation();
  const [plan, setPlan] = useState<BudgetPlan | null>(null);
  const [budgetError, setBudgetError] = useState<string | null>(null);
  const [usage, setUsage] = useState<PartitionUsage[]>([]);
  const [durable, setDurable] = useState<boolean | null>(null);
  const [report, setReport] = useState<SyncReport | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState<RoutedAnswer | null>(null);
  const [asking, setAsking] = useState(false);
  const { survey, refresh: resurvey } = useSquads(online);

  const loadStorage = useCallback(async () => {
    setUsage(await partitions.usageAll());
    try {
      setPlan(planBudget(await estimateStorageBudgetMB()));
      setBudgetError(null);
    } catch (error) {
      setPlan(null);
      setBudgetError(error instanceof Error ? error.message : String(error));
    }
  }, []);

  useEffect(() => {
    void loadStorage();
    void requestDurableStorage().then(setDurable);
  }, [loadStorage]);

  const steps = useMemo(() => defaultSyncSteps(partitions, constellation), []);

  // Derived from the same sweep the stages render, so the roster can never say
  // a tool is ready while the station it depends on shows absent.
  const crew = useMemo(() => {
    const env = capabilitiesFrom(statusesOf(flow));
    const stack = getPriorityStack();
    const gaps = new Map(
      buildCompatibilityReport(stack.map((t) => t.id), env).map((g) => [g.toolId, g.missing]),
    );
    return stack.map((tool) => ({
      tool,
      ready: isRunnable(tool, env),
      missing: gaps.get(tool.id) ?? [],
    }));
  }, [flow]);
  const router = useMemo(
    () => new ContextRouterService(partitions, defaultEngines()),
    [],
  );

  const ask = useCallback(async () => {
    const intent = question.trim();
    if (!intent) return;
    setAsking(true);
    try {
      const routed = await router.ask(intent, online);
      setAnswer(routed);
      if (!routed.engine) toast.error(routed.reason);
      await loadStorage();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    } finally {
      setAsking(false);
    }
  }, [question, router, online, loadStorage]);

  const sync = useCallback(async () => {
    setSyncing(true);
    try {
      const result = await runSync(steps, online);
      setReport(result);
      await loadStorage();
      toast[result.ok ? "success" : "error"](
        result.ok ? "Sync finished" : "Sync finished with failures",
      );
    } finally {
      setSyncing(false);
    }
  }, [steps, online, loadStorage]);

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="border-b border-border">
        <div className="mx-auto max-w-5xl px-4 py-6">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h1 className="text-xl font-semibold">{t("workstation.title")}</h1>
              <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
                {t("workstation.subtitle", { live: flow.liveCount, total: flow.checkableCount })}
                {lastCheckedAt ? ` · ${t("common.lastChecked", { when: time(lastCheckedAt) })}` : ""}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Badge variant="outline" className={online ? "border-emerald-500/40 text-emerald-500" : "border-amber-500/40 text-amber-500"}>
                {online ? <Wifi className="mr-1 h-3 w-3" /> : <CloudOff className="mr-1 h-3 w-3" />}
                {online ? t("workstation.online") : t("workstation.offline")}
              </Badge>
              <Button variant="outline" size="sm" className="min-h-11" onClick={refresh} disabled={checking}>
                {checking ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-1 h-4 w-4" />}
                {t("workstation.check")}
              </Button>
              <LocalePicker compact />
            </div>
          </div>

          <Card className="mt-4 flex flex-wrap items-center justify-between gap-3 border-primary/30 p-4">
            <div className="min-w-0">
              <p className="text-xs uppercase tracking-wide text-muted-foreground">{t("workstation.next")}</p>
              <p className="mt-1 text-sm font-medium">{flow.next.label}</p>
              <p className="mt-1 text-sm text-muted-foreground">{flow.next.why}</p>
            </div>
            {flow.next.external ? (
              <Button asChild className="min-h-11">
                <a href={flow.next.href} target="_blank" rel="noreferrer">
                  {flow.next.label} <ArrowRight className="ml-1 h-4 w-4" />
                </a>
              </Button>
            ) : (
              <Button asChild className="min-h-11">
                <Link to={flow.next.href}>
                  {flow.next.label} <ArrowRight className="ml-1 h-4 w-4" />
                </Link>
              </Button>
            )}
          </Card>
        </div>
      </header>

      <main className="mx-auto max-w-5xl space-y-8 px-4 py-6">
        <section className="space-y-4">
          {flow.stages.map((stage) => (
            <Card key={stage.stage} className="p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h2 className="text-base font-medium">{stage.title}</h2>
                  <p className="mt-0.5 text-sm text-muted-foreground">{stage.intent}</p>
                </div>
                <Badge
                  variant="outline"
                  className={
                    stage.state === "ready"
                      ? "border-emerald-500/40 text-emerald-500"
                      : stage.state === "blocked"
                        ? "border-destructive/40 text-destructive"
                        : "border-muted-foreground/30 text-muted-foreground"
                  }
                >
                  {stage.state === "ready" ? <CheckCircle2 className="mr-1 h-3 w-3" /> : stage.state === "blocked" ? <XCircle className="mr-1 h-3 w-3" /> : <Activity className="mr-1 h-3 w-3" />}
                  {stage.state}
                </Badge>
              </div>

              <ul className="mt-3 space-y-2">
                {stage.stations.map(({ station, status }) => (
                  <li
                    key={station.id}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border p-3"
                  >
                    <div className="min-w-0">
                      <p className="flex items-center gap-2 truncate text-sm font-medium">
                        {station.name}
                        {station.required && <Badge variant="secondary">required</Badge>}
                        <Badge variant="outline">offline: {station.offline}</Badge>
                      </p>
                      <p className="mt-0.5 text-sm text-muted-foreground">{station.purpose}</p>
                      <p className="mt-1 truncate font-mono text-xs text-muted-foreground">
                        {station.repo} · {station.probe.method} · {status.detail}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge variant="outline" className={STATE_STYLE[status.state].className}>
                        {STATE_STYLE[status.state].label}
                      </Badge>
                      {station.external ? (
                        <Button asChild variant="outline" size="sm" className="min-h-11">
                          <a href={station.href} target="_blank" rel="noreferrer">Open</a>
                        </Button>
                      ) : (
                        <Button asChild size="sm" className="min-h-11">
                          <Link to={station.href}>Open</Link>
                        </Button>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            </Card>
          ))}
        </section>

        <section>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="flex items-center gap-2 text-base font-medium">
              <HardDrive className="h-4 w-4" /> {t("partitions.title")}
            </h2>
            <div className="flex items-center gap-2">
              {durable !== null && (
                <Badge variant="outline" className={durable ? "border-emerald-500/40 text-emerald-500" : "border-amber-500/40 text-amber-500"}>
                  <ShieldCheck className="mr-1 h-3 w-3" />
                  {durable ? t("partitions.durable") : t("partitions.evictable")}
                </Badge>
              )}
              <Button variant="outline" size="sm" className="min-h-11" onClick={() => void sync()} disabled={syncing}>
                {syncing ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Database className="mr-1 h-4 w-4" />}
                {t("partitions.sync")}
              </Button>
            </div>
          </div>

          <p className="mt-2 text-sm text-muted-foreground">
            {plan
              ? t("partitions.budget", {
                  granted: `${plan.budgetMB} MB`,
                  needed: `${MINIMUM_BUDGET_MB} MB`,
                  spare: `${plan.headroomMB} MB`,
                })
              : budgetError
                ? `Storage quota unavailable: ${budgetError}`
                : "Reading the device's storage quota…"}
            {" Backups are stored beside the records they copy, so a restore needs no network."}
          </p>

          <ul className="mt-3 space-y-2">
            {usage.map((row) => {
              const spec = findPartition(row.id);
              const granted = plan?.partitions.find((p) => p.id === row.id);
              return (
                <li key={row.id} className="rounded-md border border-border p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-sm font-medium">
                      {spec.name}{" "}
                      <Badge variant="secondary">{spec.tier}</Badge>{" "}
                      <Badge variant="outline">router: {spec.router}</Badge>
                    </p>
                    <p className="font-mono text-xs text-muted-foreground">
                      {granted ? `${granted.grantedMB} MB granted · ` : ""}
                      floor {spec.floorMB} MB · {t("partitions.records", { count: row.records })} ·{" "}
                      {bytes(row.bytes)} ·{" "}
                      {t("partitions.backups", { count: row.backups, depth: spec.backupCopies })}
                    </p>
                  </div>
                  <p className="mt-1 text-sm text-muted-foreground">{spec.purpose}</p>
                  {granted && !granted.satisfied && (
                    <p className="mt-1 text-sm text-destructive">
                      {t("partitions.belowFloor")}
                    </p>
                  )}
                </li>
              );
            })}
          </ul>

          {report && (
            <Card className="mt-3 p-3">
              <p className="text-sm font-medium">
                Last sync · {report.online ? "online" : "offline"} · {report.ok ? "no failures" : "failures"}
              </p>
              <ul className="mt-2 space-y-1">
                {report.steps.map((step) => (
                  <li key={step.id} className="font-mono text-xs text-muted-foreground">
                    [{step.outcome}] {step.label} — {step.detail}
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </section>

        <section>
          <h2 className="text-base font-medium">{t("routers.title")}</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Each router pairs one small model with the partitions it is expert in, and answers from
            the nearest engine it can reach. Keeper has no network rung at any budget.
          </p>
          <ul className="mt-3 grid gap-2 sm:grid-cols-2">
            {CONTEXT_ROUTERS.map((spec) => (
              <li
                key={spec.id}
                className={`rounded-md border p-3 ${answer?.router.id === spec.id ? "border-primary" : "border-border"}`}
              >
                <p className="text-sm font-medium">{spec.name}</p>
                <p className="mt-0.5 text-sm text-muted-foreground">{spec.specialty}</p>
                <p className="mt-1 font-mono text-xs text-muted-foreground">
                  {routerModel(spec.id).name} · reads {spec.reads.join(", ") || "nothing yet"} ·
                  ladder {spec.ladder.join(" → ")}
                </p>
              </li>
            ))}
          </ul>

          <form
            className="mt-3 flex flex-wrap gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              void ask();
            }}
          >
            <Input
              value={question}
              onChange={(event) => setQuestion(event.target.value)}
              placeholder={t("routers.ask")}
              className="min-h-11 flex-1"
            />
            <Button type="submit" className="min-h-11" disabled={asking || !question.trim()}>
              {asking ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : null}
              {t("routers.askButton")}
            </Button>
          </form>

          {answer && (
            <Card className="mt-3 p-3">
              <p className="font-mono text-xs text-muted-foreground">{answer.reason}</p>
              {answer.context.length > 0 && (
                <p className="mt-1 font-mono text-xs text-muted-foreground">
                  {t("routers.context")}: {answer.context.map((c) => `${c.partition}/${c.key}`).join(", ")}
                </p>
              )}
              {answer.text ? (
                <p className="mt-2 whitespace-pre-wrap text-sm">{answer.text}</p>
              ) : (
                <p className="mt-2 text-sm text-muted-foreground">
                  {t("routers.nothingReady")}
                </p>
              )}
            </Card>
          )}
        </section>

        <section>
          <h2 className="text-base font-medium">{t("squads.title")}</h2>
          <p className="mb-3 mt-1 text-sm text-muted-foreground">
            Routers combined into units with a lead and support. Each unit plans once from one
            shared look at the world, then holds that route while a short list of conditions still
            holds — it re-derives when an engine drops, when a shorter path opens, or when
            connectivity flips, and not on every question.
          </p>
          <SquadBoard survey={survey} onRefresh={resurvey} />
        </section>

        <section>
          <h2 className="text-base font-medium">{t("crew.title")}</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            One specialist per area rather than one tool stretched across all of them.{" "}
            {crew.filter((c) => c.ready).length} of {crew.length} would start on this machine right
            now — derived from the station sweep above, not from a checklist.
          </p>
          <ul className="mt-3 grid gap-2 sm:grid-cols-2">
            {crew.map(({ tool, ready, missing }) => (
              <li key={tool.id} className="flex items-start justify-between gap-2 rounded-md border border-border p-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{tool.name}</p>
                  <p className="mt-0.5 font-mono text-xs text-muted-foreground">
                    {tool.category} · {tool.deployment.join("/")}
                  </p>
                  {!ready && (
                    <p className="mt-1 font-mono text-xs text-muted-foreground">
                      {t("crew.needs", { capabilities: missing.join(", ") })}
                    </p>
                  )}
                </div>
                <Badge
                  variant="outline"
                  className={ready ? "border-emerald-500/40 text-emerald-500" : "border-muted-foreground/30 text-muted-foreground"}
                >
                  {ready ? t("crew.ready") : t("crew.blocked")}
                </Badge>
              </li>
            ))}
          </ul>
        </section>
      </main>
    </div>
  );
}
