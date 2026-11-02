/**
 * What this device will actually grant, asked once.
 *
 * Both the ignition probe and the partitions panel need this number, and a
 * second copy of the call would be a second answer the day one of them starts
 * rounding differently. It throws rather than returning 0, because "no quota
 * reported" and "a quota of nothing" are different problems with different
 * fixes, and a caller that cannot tell them apart will report the wrong one.
 */
export async function estimateStorageBudgetMB(): Promise<number> {
  if (typeof navigator === "undefined" || !navigator.storage?.estimate) {
    throw new Error("this browser does not report a storage quota");
  }
  const { quota } = await navigator.storage.estimate();
  if (!quota) throw new Error("no storage quota granted");
  return quota / (1024 * 1024);
}

/**
 * Asks the browser to keep this origin's storage from being evicted under
 * pressure. Offline-first is a claim about what survives, and eviction is the
 * one thing that breaks it silently.
 */
export async function requestDurableStorage(): Promise<boolean> {
  if (typeof navigator === "undefined" || !navigator.storage?.persist) return false;
  try {
    if (await navigator.storage.persisted?.()) return true;
    return await navigator.storage.persist();
  } catch {
    return false;
  }
}
