import { describe, expect, it } from "vitest";
import {
  planRotation,
  isUsable,
  rotationStatus,
  DEFAULT_GRACE_HOURS,
  MAX_GRACE_HOURS,
  ROTATION_DUE_DAYS,
} from "../../supabase/functions/_shared/keyRotation";

/**
 * Issue #2 called for key rotation and the vault had none: keys were minted and
 * revoked, and a key issued on day one was as trusted on day nine hundred.
 *
 * The dangerous half of rotation is not minting the replacement, it is retiring
 * the old secret. Retire it instantly and every bot still holding it dies
 * without explanation; never retire it and there was no rotation, only a second
 * key. So the window between those two is the thing under test here, on a clock
 * that is passed in rather than read.
 */
const HOUR = 3600_000;
const DAY = 86_400_000;
const NOW = Date.parse("2026-09-12T12:00:00.000Z");

describe("planning a rotation", () => {
  it("gives a day of overlap by default — long enough to redeploy a bot", () => {
    const plan = planRotation({ now: NOW });
    expect(plan.graceHours).toBe(DEFAULT_GRACE_HOURS);
    expect(plan.immediate).toBe(false);
    expect(Date.parse(plan.expiresAt) - NOW).toBe(DEFAULT_GRACE_HOURS * HOUR);
  });

  it("retires the old key on the spot when asked for no grace at all", () => {
    const plan = planRotation({ graceHours: 0, now: NOW });
    expect(plan.immediate).toBe(true);
    expect(Date.parse(plan.expiresAt)).toBe(NOW);
  });

  it("refuses to leave two live keys for a year", () => {
    // A grace period this long is not a rotation, it is a second key. Clamped
    // rather than honoured.
    const plan = planRotation({ graceHours: 24 * 365, now: NOW });
    expect(plan.graceHours).toBe(MAX_GRACE_HOURS);
  });

  it("treats a negative or unreadable grace as immediate, never as infinite", () => {
    expect(planRotation({ graceHours: -5, now: NOW }).graceHours).toBe(0);
    expect(planRotation({ graceHours: Number.NaN, now: NOW }).graceHours).toBe(DEFAULT_GRACE_HOURS);
  });
});

describe("whether a key may still authenticate", () => {
  const created = new Date(NOW - 10 * DAY).toISOString();

  it("lets an ordinary key through", () => {
    expect(isUsable({ is_active: true, created_at: created }, NOW)).toBe(true);
  });

  it("lets a retiring key through until its deadline, and not after", () => {
    const expires = new Date(NOW + HOUR).toISOString();
    expect(isUsable({ is_active: true, expires_at: expires, created_at: created }, NOW)).toBe(true);
    // One hour and a millisecond later, the same key is refused.
    expect(isUsable({ is_active: true, expires_at: expires, created_at: created }, NOW + HOUR + 1)).toBe(false);
  });

  it("still refuses a revoked key that has not reached its deadline", () => {
    const expires = new Date(NOW + HOUR).toISOString();
    expect(isUsable({ is_active: false, expires_at: expires, created_at: created }, NOW)).toBe(false);
  });

  it("does not lock anyone out over an unreadable expiry", () => {
    expect(isUsable({ is_active: true, expires_at: "not a date", created_at: created }, NOW)).toBe(true);
  });
});

describe("what the panel tells you about a key", () => {
  const age = (days: number) => new Date(NOW - days * DAY).toISOString();

  it("calls a young key fresh and counts its days", () => {
    const status = rotationStatus({ is_active: true, created_at: age(3) }, NOW);
    expect(status.state).toBe("fresh");
    expect(status.ageDays).toBe(3);
  });

  it("calls a key due the day it reaches the rotation mark", () => {
    expect(rotationStatus({ is_active: true, created_at: age(ROTATION_DUE_DAYS) }, NOW).state).toBe("due");
    expect(rotationStatus({ is_active: true, created_at: age(ROTATION_DUE_DAYS - 1) }, NOW).state).toBe("fresh");
  });

  it("gets louder about a key twice past due", () => {
    const status = rotationStatus({ is_active: true, created_at: age(400) }, NOW);
    expect(status.state).toBe("stale");
    expect(status.detail).toMatch(/rotate it/i);
  });

  it("counts down the grace hours left on a retiring key", () => {
    const status = rotationStatus(
      { is_active: true, expires_at: new Date(NOW + 5 * HOUR).toISOString(), created_at: age(30) },
      NOW,
    );
    expect(status.state).toBe("retiring");
    expect(status.graceHoursLeft).toBe(5);
    expect(status.detail).toMatch(/5h/);
  });

  it("says a key whose grace ran out is done, not merely old", () => {
    const status = rotationStatus(
      { is_active: true, expires_at: new Date(NOW - HOUR).toISOString(), created_at: age(30) },
      NOW,
    );
    expect(status.state).toBe("retired");
    expect(status.detail).toMatch(/no longer authenticates/i);
  });
});
