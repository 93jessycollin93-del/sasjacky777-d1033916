/**
 * What the game ledger will record, decided from the server's own tables.
 *
 * The game itself runs in the browser and keeps its balances in local storage,
 * so this ledger is the one record of the economy a player cannot edit. It
 * used to take `amount` straight from the request: any signed-in account could
 * log "+10,000,000 diamonds, reward" and the ledger's balance would agree. Now
 * the request names *what happened* and this module decides *how much*:
 *
 *   - spend   — the request says how much it spent; it can only lower the
 *               balance, and never below what the ledger already holds;
 *   - claim   — a battle pass reward, worth exactly what the table below says,
 *               once per tier per account; premium tiers need the premium
 *               upgrade to have been recorded first;
 *   - purchase / reward — refused. Nothing in this game verifies a payment yet,
 *               and a credit with no verified payment behind it is the exact
 *               record this ledger exists to keep out.
 *
 * Pure: no Deno, no network — `src/test/game-ledger.test.ts` imports it.
 */

export const LEDGER_CURRENCIES = ["diamonds", "stars", "usd", "ton", "gold"] as const;
export type LedgerCurrency = (typeof LEDGER_CURRENCIES)[number];

/** Diamonds each battle pass tier pays, keyed the way the client names it. */
export const BATTLE_PASS_DIAMONDS: Readonly<Record<string, number>> = {
  tier_5_free: 3,
  tier_10_free: 5,
  tier_15_free: 8,
  tier_20_free: 12,
  tier_25_free: 15,
  tier_30_free: 30,
  tier_5_premium: 5,
  tier_10_premium: 10,
  tier_15_premium: 15,
  tier_20_premium: 20,
  tier_25_premium: 25,
  tier_30_premium: 50,
};

/** The spend that unlocks premium claims. */
export const PREMIUM_UPGRADE = { source: "battle_pass", source_id: "premium_upgrade" } as const;

/** The largest single spend the ledger accepts. A typo, not a policy. */
export const MAX_SPEND = 10_000_000;
const MAX_METADATA_CHARS = 2_000;
const MAX_LABEL_CHARS = 120;

export type LedgerDecision =
  | {
      ok: true;
      transaction_type: "spend" | "claim";
      currency_type: LedgerCurrency;
      amount: number;
      source: string;
      source_id: string | null;
      metadata: Record<string, unknown>;
      /** A claim is recorded once per account; this key enforces it. */
      onceKey: string | null;
      /** The premium upgrade must already be on the ledger. */
      needsPremium: boolean;
    }
  | { ok: false; status: number; code: string; error: string };

function label(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const t = value.trim();
  if (!t || t.length > MAX_LABEL_CHARS || !/^[\w.:-]+$/.test(t)) return null;
  return t;
}

function refuse(status: number, code: string, error: string): LedgerDecision {
  return { ok: false, status, code, error };
}

export function decideLedgerEntry(record: unknown): LedgerDecision {
  if (!record || typeof record !== "object") return refuse(400, "INVALID_RECORD", "Invalid record");
  const r = record as Record<string, unknown>;

  const currency = r.currency_type;
  if (typeof currency !== "string" || !(LEDGER_CURRENCIES as readonly string[]).includes(currency)) {
    return refuse(400, "INVALID_CURRENCY", "Unknown currency");
  }
  const source = label(r.source);
  if (!source) return refuse(400, "INVALID_SOURCE", "A transaction must name its source");
  const sourceId = r.source_id == null ? null : label(r.source_id);
  if (r.source_id != null && !sourceId) return refuse(400, "INVALID_SOURCE_ID", "Invalid source id");

  let metadata: Record<string, unknown> = {};
  if (r.metadata != null) {
    if (typeof r.metadata !== "object" || Array.isArray(r.metadata)) {
      return refuse(400, "INVALID_METADATA", "Metadata must be an object");
    }
    const text = JSON.stringify(r.metadata);
    if (text.length > MAX_METADATA_CHARS) return refuse(413, "METADATA_TOO_LARGE", "Metadata too large");
    metadata = JSON.parse(text);
  }

  switch (r.transaction_type) {
    case "spend": {
      const raw = Number(r.amount);
      if (!Number.isInteger(raw) || raw === 0 || Math.abs(raw) > MAX_SPEND) {
        return refuse(400, "INVALID_AMOUNT", "A spend must be a whole, non-zero amount");
      }
      // A spend lowers the balance whatever sign the client used.
      return {
        ok: true, transaction_type: "spend", currency_type: currency as LedgerCurrency,
        amount: -Math.abs(raw), source, source_id: sourceId, metadata, onceKey: null, needsPremium: false,
      };
    }
    case "claim": {
      if (source !== "battle_pass" || !sourceId || !(sourceId in BATTLE_PASS_DIAMONDS)) {
        return refuse(403, "CLAIM_UNKNOWN", "That reward is not one the server knows how to pay");
      }
      if (currency !== "diamonds") return refuse(400, "INVALID_CURRENCY", "Battle pass rewards are paid in diamonds");
      return {
        ok: true, transaction_type: "claim", currency_type: "diamonds",
        // The table's value, never the request's: the request does not get to say how much it won.
        amount: BATTLE_PASS_DIAMONDS[sourceId], source, source_id: sourceId, metadata,
        onceKey: `ledger:battle_pass:${sourceId}`,
        needsPremium: sourceId.endsWith("_premium"),
      };
    }
    case "purchase":
      return refuse(
        403, "PAYMENT_UNVERIFIED",
        "Purchases are recorded only from a verified payment, and this game has no payment verification yet",
      );
    case "reward":
      return refuse(403, "REWARD_UNKNOWN", "Rewards are recorded only for reward types the server defines");
    default:
      return refuse(400, "INVALID_TYPE", "Unknown transaction type");
  }
}

/** The balance after an entry, or a refusal when a spend exceeds what is held. */
export function nextBalance(
  before: number,
  amount: number,
): { ok: true; after: number } | { ok: false; status: number; code: string; error: string } {
  const after = before + amount;
  if (amount < 0 && after < 0) {
    return {
      ok: false, status: 409, code: "INSUFFICIENT_RECORDED_BALANCE",
      error: `The ledger holds ${before}; this spend needs ${-amount}`,
    };
  }
  return { ok: true, after };
}
