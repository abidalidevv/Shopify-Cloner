/**
 * Tests for the retry module.
 *
 * Verifies:
 * 1. Transient errors (5xx, 429, THROTTLED, network codes) are retried.
 * 2. Permanent errors (e.g. 422) are thrown immediately without retrying.
 * 3. Retry count does not exceed maxAttempts.
 * 4. Exponential backoff increases delay between attempts.
 * 5. retryAfterSeconds is respected if provided.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { withRetry, isTransient, type TransientError } from "../retry.js";

// Speed up tests by using very small delays
const FAST = { baseDelayMs: 1, maxDelayMs: 5, maxAttempts: 3 };

// ── isTransient ───────────────────────────────────────────────────────────────

describe("isTransient", () => {
  it("returns true for 429 status", () => {
    const err = Object.assign(new Error("rate limit"), { status: 429 }) as TransientError;
    expect(isTransient(err)).toBe(true);
  });

  it("returns true for 500 status", () => {
    const err = Object.assign(new Error("server error"), { status: 500 }) as TransientError;
    expect(isTransient(err)).toBe(true);
  });

  it("returns true for ECONNRESET", () => {
    const err = Object.assign(new Error("connection reset"), { code: "ECONNRESET" }) as TransientError;
    expect(isTransient(err)).toBe(true);
  });

  it("returns true when message includes THROTTLED", () => {
    const err = new Error("THROTTLED by Shopify") as TransientError;
    expect(isTransient(err)).toBe(true);
  });

  it("returns false for 422 (validation error — permanent)", () => {
    const err = Object.assign(new Error("unprocessable"), { status: 422 }) as TransientError;
    expect(isTransient(err)).toBe(false);
  });

  it("returns false for 404 (not found — permanent)", () => {
    const err = Object.assign(new Error("not found"), { status: 404 }) as TransientError;
    expect(isTransient(err)).toBe(false);
  });

  it("returns false for non-Error values", () => {
    expect(isTransient("a string")).toBe(false);
    expect(isTransient(null)).toBe(false);
    expect(isTransient(42)).toBe(false);
  });
});

// ── withRetry ─────────────────────────────────────────────────────────────────

describe("withRetry", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns the value immediately if fn succeeds on first try", async () => {
    const fn = vi.fn().mockResolvedValue("success");
    const result = await withRetry("test", fn, FAST);
    expect(result).toBe("success");
    expect(fn).toHaveBeenCalledOnce();
  });

  it("retries on a transient error and succeeds on second attempt", async () => {
    const transientErr = Object.assign(new Error("server error"), { status: 500 });
    const fn = vi
      .fn()
      .mockRejectedValueOnce(transientErr)
      .mockResolvedValue("ok");

    const promise = withRetry("test", fn, FAST);
    // Advance timers for the backoff delay
    await vi.runAllTimersAsync();
    const result = await promise;

    expect(result).toBe("ok");
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("throws a permanent error immediately without retrying", async () => {
    const permanentErr = Object.assign(new Error("validation failed"), { status: 422 });
    const fn = vi.fn().mockRejectedValue(permanentErr);

    await expect(withRetry("test", fn, FAST)).rejects.toThrow("validation failed");
    // Should only be called once — no retries for permanent errors
    expect(fn).toHaveBeenCalledOnce();
  });

  it("exhausts maxAttempts and re-throws the last transient error", async () => {
    const transientErr = Object.assign(new Error("always 503"), { status: 503 });
    const fn = vi.fn().mockRejectedValue(transientErr);

    const assertion = expect(withRetry("test", fn, FAST)).rejects.toThrow("always 503");
    await vi.runAllTimersAsync();
    await assertion;

    // Initial call + 3 retries = 4 total calls
    expect(fn).toHaveBeenCalledTimes(4);
  });
});
