import { MICRO_MODELS } from "@/lib/microai/models";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Cpu, Lock } from "lucide-react";

interface Props {
  activeModel: string;
  locked: boolean;
  onSelect: (id: string) => void;
}

const TYPE_COLOR: Record<string, string> = {
  reasoning: "text-primary",
  chat: "text-emerald-500",
  code: "text-amber-500",
  story: "text-pink-500",
  general: "text-muted-foreground",
};

export function ModelSelector({ activeModel, locked, onSelect }: Props) {
  return (
    <Card className="bg-card/80 border-border/40">
      <CardHeader className="p-3 pb-2">
        <CardTitle className="text-xs font-mono uppercase tracking-wider flex items-center gap-2">
          <Cpu className="h-3.5 w-3.5 text-primary" /> Micro Models
          {locked && <Lock className="h-3 w-3 text-destructive" />}
        </CardTitle>
      </CardHeader>
      <CardContent className="p-3 pt-0 space-y-1 max-h-72 overflow-y-auto">
        {MICRO_MODELS.map(m => {
          const active = m.id === activeModel;
          return (
            <button
              key={m.id}
              type="button"
              disabled={locked}
              onClick={() => onSelect(m.id)}
              className={`w-full text-left rounded-md border px-2 py-1.5 transition-colors ${
                active ? "border-primary/60 bg-primary/10" : "border-border/40 hover:bg-muted/40"
              } ${locked ? "opacity-50 cursor-not-allowed" : ""}`}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-semibold text-foreground truncate">{m.name}</span>
                <span className="text-[10px] font-mono text-muted-foreground shrink-0">{m.sizeLabel}</span>
              </div>
              <div className="flex items-center justify-between gap-2 mt-0.5">
                <span className="text-[10px] text-muted-foreground truncate">{m.family}</span>
                <Badge variant="outline" className={`text-[9px] px-1 py-0 ${TYPE_COLOR[m.type] ?? ""}`}>{m.type}</Badge>
              </div>
              {active && <div className="text-[9px] text-primary font-mono mt-0.5">● ACTIVE</div>}
            </button>
          );
        })}
      </CardContent>
    </Card>
  );
}
