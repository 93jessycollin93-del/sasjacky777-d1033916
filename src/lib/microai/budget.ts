/**
 * The owner's on-device ceiling: everything Jackie downloads to run offline
 * stays under 750 MB — 300 reserved for Bonsai, 400 for the vision model,
 * routers and other micro assets. A model added past this line is refused
 * here rather than discovered as a phone that ran out of storage.
 */
export const DEVICE_BUDGET_MB = { total: 750, bonsai: 300, micro: 400 } as const;

export interface BudgetItem { id: string; mb: number; slot: "bonsai" | "micro" }

export function checkBudget(items: BudgetItem[]): { ok: boolean; reason?: string; usedMB: number } {
  const sum = (s: BudgetItem["slot"]) => items.filter((i) => i.slot === s).reduce((a, i) => a + i.mb, 0);
  const bonsai = sum("bonsai"), micro = sum("micro"), used = bonsai + micro;
  if (bonsai > DEVICE_BUDGET_MB.bonsai) return { ok: false, usedMB: used, reason: `Bonsai slot ${bonsai} MB exceeds ${DEVICE_BUDGET_MB.bonsai} MB` };
  if (micro > DEVICE_BUDGET_MB.micro) return { ok: false, usedMB: used, reason: `Micro assets ${micro} MB exceed ${DEVICE_BUDGET_MB.micro} MB` };
  if (used > DEVICE_BUDGET_MB.total) return { ok: false, usedMB: used, reason: `Total ${used} MB exceeds ${DEVICE_BUDGET_MB.total} MB` };
  return { ok: true, usedMB: used };
}
