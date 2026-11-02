import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

/**
 * A tool's or operation's parameters as typed values, or the first one that
 * is not. "yes" is not false and "12a" is not a number: guessing either would
 * run the tool with a value nobody typed.
 */
export function typedArgs(
  params: ReadonlyArray<{ name: string; type: string }>,
  values: Record<string, string>,
): { args: Record<string, unknown>; error?: undefined } | { error: string; args?: undefined } {
  const out: Record<string, unknown> = {};
  for (const p of params) {
    const raw = (values[p.name] ?? "").trim();
    if (raw === "") continue;
    if (p.type === "number") {
      const n = Number(raw);
      if (!Number.isFinite(n)) return { error: `"${p.name}" must be a number; "${raw}" is not one.` };
      out[p.name] = n;
    } else if (p.type === "boolean") {
      if (raw !== "true" && raw !== "false") return { error: `"${p.name}" must be true or false.` };
      out[p.name] = raw === "true";
    } else {
      out[p.name] = values[p.name];
    }
  }
  return { args: out };
}

/** One input per parameter, the right kind for its type. */
export function ParamInputs({ params, values, onChange, describe }: {
  params: ReadonlyArray<{ name: string; type: string; required?: boolean; in?: string }>;
  values: Record<string, string>;
  onChange: (v: Record<string, string>) => void;
  describe?: (p: { name: string; type: string; required?: boolean; in?: string }) => string;
}) {
  return (
    <>
      {params.map((p) => {
        const label = describe ? describe(p) : `${p.name} (${p.type}${p.required ? ", required" : ""})`;
        return p.type === "boolean" ? (
          <Select key={p.name} value={values[p.name] ?? ""} onValueChange={(v) => onChange({ ...values, [p.name]: v === "unset" ? "" : v })}>
            <SelectTrigger aria-label={p.name}><SelectValue placeholder={label} /></SelectTrigger>
            <SelectContent>
              {!p.required && <SelectItem value="unset">(leave out)</SelectItem>}
              <SelectItem value="true">true</SelectItem>
              <SelectItem value="false">false</SelectItem>
            </SelectContent>
          </Select>
        ) : (
          <Input key={p.name} aria-label={p.name} placeholder={label} inputMode={p.type === "number" ? "decimal" : undefined}
            value={values[p.name] ?? ""} onChange={(e) => onChange({ ...values, [p.name]: e.target.value })} />
        );
      })}
    </>
  );
}
