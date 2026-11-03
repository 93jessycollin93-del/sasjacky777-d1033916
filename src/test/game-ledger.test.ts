import { describe, expect, it } from "vitest";
import {
  BATTLE_PASS_DIAMONDS, decideLedgerEntry, nextBalance,
} from "../../supabase/functions/_shared/gameLedger";

describe("the game ledger decides how much a transaction is worth", () => {
  it("pays a battle pass claim what the table says, not what the request says", () => {
    const d = decideLedgerEntry({
      transaction_type: "claim", currency_type: "diamonds", amount: 10_000_000,
      source: "battle_pass", source_id: "tier_30_free",
    });
    expect(d).toMatchObject({ ok: true, amount: 30, onceKey: "ledger:battle_pass:tier_30_free", needsPremium: false });
    expect(BATTLE_PASS_DIAMONDS.tier_30_premium).toBe(50);
  });

  it("asks for the premium upgrade before paying a premium tier", () => {
    expect(decideLedgerEntry({
      transaction_type: "claim", currency_type: "diamonds", source: "battle_pass", source_id: "tier_5_premium",
    })).toMatchObject({ ok: true, amount: 5, needsPremium: true });
  });

  it("refuses a claim for a reward the server does not know", () => {
    expect(decideLedgerEntry({
      transaction_type: "claim", currency_type: "diamonds", amount: 999, source: "battle_pass", source_id: "tier_99_free",
    })).toMatchObject({ ok: false, code: "CLAIM_UNKNOWN", status: 403 });
  });

  it("refuses purchases and free-form rewards, because nothing verifies a payment", () => {
    expect(decideLedgerEntry({ transaction_type: "purchase", currency_type: "diamonds", amount: 15_000_000, source: "diamond_exchange" }))
      .toMatchObject({ ok: false, code: "PAYMENT_UNVERIFIED" });
    expect(decideLedgerEntry({ transaction_type: "reward", currency_type: "diamonds", amount: 500, source: "anything" }))
      .toMatchObject({ ok: false, code: "REWARD_UNKNOWN" });
  });

  it("only ever lets a spend lower the balance, whatever sign it was sent with", () => {
    expect(decideLedgerEntry({ transaction_type: "spend", currency_type: "diamonds", amount: 500, source: "battle_pass", source_id: "premium_upgrade" }))
      .toMatchObject({ ok: true, amount: -500 });
    expect(decideLedgerEntry({ transaction_type: "spend", currency_type: "diamonds", amount: 1.5, source: "jade_store" }))
      .toMatchObject({ ok: false, code: "INVALID_AMOUNT" });
  });

  it("refuses a spend larger than the recorded balance instead of going negative", () => {
    expect(nextBalance(100, -500)).toMatchObject({ ok: false, code: "INSUFFICIENT_RECORDED_BALANCE" });
    expect(nextBalance(600, -500)).toEqual({ ok: true, after: 100 });
  });
});
