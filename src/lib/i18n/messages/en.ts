/**
 * The source catalog.
 *
 * English is the key set every other locale is measured against: a key here
 * that is missing there is a gap the QA report names, and a key there that is
 * not here is dead weight left behind by a rename.
 *
 * Keys are namespaced by surface, not by page, so a string moving between
 * screens does not need retranslating.
 */
export const en = {
  "workstation.title": "Workstation",
  "workstation.subtitle":
    "{live, plural, =0 {No stations have answered yet} one {# of {total} checkable stations answered} other {# of {total} checkable stations answered}}",
  "workstation.next": "Next step",
  "workstation.check": "Check",
  "workstation.online": "online · sync available",
  "workstation.offline": "offline · fully operational",

  "stage.ignition": "Ignition",
  "stage.core": "Core",
  "stage.workstation": "Workstation",
  "stage.field": "Field",
  "stage.ready": "ready",
  "stage.blocked": "blocked",
  "stage.pending": "pending",

  "station.required": "required",
  "station.open": "Open",
  "station.offlineFull": "works offline",
  "station.offlineSync": "offline, syncs when it can",
  "station.offlineNone": "needs a network",
  "state.live": "live",
  "state.declared": "declared",
  "state.absent": "absent",
  "state.unknown": "checking",

  "partitions.title": "Offline partitions",
  "partitions.budget":
    "{granted} granted, {needed} needed for every floor, {spare} spare.",
  "partitions.noQuota": "Storage quota unavailable: {reason}",
  "partitions.reading": "Reading the device's storage quota…",
  "partitions.backupNote":
    "Backups are stored beside the records they copy, so a restore needs no network.",
  "partitions.durable": "eviction-protected",
  "partitions.evictable": "evictable",
  "partitions.sync": "Back up & sync",
  "partitions.belowFloor": "Below its floor — this partition cannot do its job on this device.",
  "partitions.records":
    "{count, plural, =0 {nothing stored} one {# record} other {# records}}",
  "partitions.backups":
    "{count, plural, =0 {no backups} one {# backup} other {# backups}} of {depth}",

  "squads.title": "Squads",
  "squads.intro":
    "Routers combined into units with a lead and support. Each unit plans once from one shared look at the world, then holds that route while a short list of conditions still holds.",
  "squads.operational": "operational",
  "squads.grounded": "grounded",
  "squads.lookAgain": "Look again",
  "squads.efficiency":
    "{units} of {total} units operational · {looks, plural, one {# look} other {# looks}} answered {questions, plural, one {# question} other {# questions}} ({held}% held)",
  "squads.replanned":
    "{count, plural, =0 {nothing re-planned} one {# router re-planned} other {# routers re-planned}} on this pass",
  "squads.held": "held",
  "squads.rePlanned": "re-planned",
  "squads.noPath": "no path",
  "squads.watching": "watching",

  "routers.title": "Micro-AI context routers",
  "routers.intro":
    "Each router pairs one small model with the partitions it is expert in, and answers from the nearest engine it can reach.",
  "routers.ask": "Ask a router — it picks itself from what you asked",
  "routers.askButton": "Ask",
  "routers.nothingReady":
    "Nothing local was ready to answer. Start Ollama, or bring a network up for the routers that are allowed to use one.",
  "routers.context": "context",

  "crew.title": "Crew",
  "crew.intro":
    "One specialist per area rather than one tool stretched across all of them. {ready} of {total} would start on this machine right now.",
  "crew.ready": "ready",
  "crew.blocked": "blocked",
  "crew.needs": "needs {capabilities}",

  "locale.title": "Language",
  "locale.change": "Change language",

  "common.retry": "Try again",
  "common.close": "Close",
  "common.copied": "Copied",
  "common.lastChecked": "last checked {when}",
} as const;

export type MessageKey = keyof typeof en;
