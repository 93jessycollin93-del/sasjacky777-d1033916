import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Crosshair, Loader2, RefreshCw } from "lucide-react";
import type { SquadSurvey } from "@/lib/squad/commander";
import { squadReach } from "@/lib/squad/squads";
import { routerModel } from "@/lib/microai/contextRouter";

/**
 * The squad board.
 *
 * Shows each unit as its formation actually runs: the lead first, then support,
 * each with the engine its standing plan points at and whether that plan held
 * or was re-derived. The counters at the top are the ones worth watching — a
 * high hold rate against a low look count is the system predicting correctly;
 * churn in the replanned column means the world is moving under it.
 *
 * A View. Every number here comes from the commander's survey.
 */
export function SquadBoard({
  survey,
  onRefresh,
}: {
  survey: SquadSurvey | null;
  onRefresh: () => void;
}) {
  if (!survey) {
    return (
      <Card className="flex items-center gap-2 p-4">
        <Loader2 className="h-4 w-4 animate-spin" />
        <p className="text-sm text-muted-foreground">Taking the first look…</p>
      </Card>
    );
  }

  const { stats } = survey;
  const total = stats.looks + stats.reuses;
  const heldPct = total > 0 ? Math.round((stats.reuses / total) * 100) : 0;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">
          {survey.operational} of {survey.squads.length} units operational ·{" "}
          {stats.looks} {stats.looks === 1 ? "look" : "looks"} answered {total} questions ({heldPct}%
          held) · {survey.replanned} {survey.replanned === 1 ? "router" : "routers"} re-planned on
          this pass
        </p>
        <Button variant="outline" size="sm" className="min-h-11" onClick={onRefresh}>
          <RefreshCw className="mr-1 h-4 w-4" />
          Look again
        </Button>
      </div>

      <ul className="space-y-2">
        {survey.squads.map((plan) => (
          <li key={plan.squad.id} className="rounded-md border border-border p-3">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="flex items-center gap-2 text-sm font-medium">
                  <Crosshair className="h-4 w-4" />
                  {plan.squad.name}
                  <Badge variant="outline">{plan.squad.formation}</Badge>
                </p>
                <p className="mt-0.5 text-sm text-muted-foreground">{plan.squad.doctrine}</p>
                <p className="mt-1 font-mono text-xs text-muted-foreground">
                  reads {squadReach(plan.squad).join(", ")}
                </p>
              </div>
              <Badge
                variant="outline"
                className={
                  plan.operational
                    ? "border-emerald-500/40 text-emerald-500"
                    : "border-destructive/40 text-destructive"
                }
              >
                {plan.operational ? "operational" : "grounded"}
              </Badge>
            </div>

            <p className="mt-2 font-mono text-xs text-muted-foreground">{plan.status}</p>

            <ul className="mt-2 space-y-1">
              {plan.members.map((member) => (
                <li
                  key={member.routerId}
                  className="flex flex-wrap items-center justify-between gap-2 rounded border border-border/60 px-2 py-1.5"
                >
                  <span className="font-mono text-xs">
                    <span className="text-muted-foreground">{member.role}</span> {member.routerId} ·{" "}
                    {routerModel(member.routerId).name}
                  </span>
                  <span className="flex items-center gap-2">
                    <span className="font-mono text-xs text-muted-foreground">
                      {member.plan.engineId ?? "no path"}
                    </span>
                    <Badge
                      variant="outline"
                      className={
                        member.replanned
                          ? "border-amber-500/40 text-amber-500"
                          : "border-muted-foreground/30 text-muted-foreground"
                      }
                    >
                      {member.replanned ? "re-planned" : "held"}
                    </Badge>
                  </span>
                </li>
              ))}
            </ul>

            <p className="mt-2 font-mono text-xs text-muted-foreground">
              watching:{" "}
              {plan.members[0].plan.invariants
                .map((i) =>
                  i.kind === "no-better-engine"
                    ? `no-better(${i.engineIds.join("|")})`
                    : i.kind === "online"
                      ? `online=${i.value}`
                      : `${i.kind}(${i.engineId})`,
                )
                .join(" · ")}
            </p>
          </li>
        ))}
      </ul>
    </div>
  );
}
