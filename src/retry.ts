/**
 * Retry with exponential backoff and jitter.
 *
 * Only retries TRANSIENT errors (network, 5xx, THROTTLED).
 * Never retries permanent validation errors (4xx other than 429/430).
 *
 * Goal file rule §4: "Retry only transient errors … Never retry permanent
 * validation errors."
 */

import { logger } from "./logger.js";

export interface RetryOptions {
  /** Maximum number of retry attempts (not counting the initial try). Default 5. */
  maxAttempts?: number;
  /** Base delay in ms for backoff. Default 1000. */
  baseDelayMs?: number;
  /** Maximum delay cap in ms. Default 30_000. */
  maxDelayMs?: number;
}

/** HTTP status codes considered transient (worth retrying). */
const TRANSIENT_STATUSES = new Set([429, 430, 500, 502, 503, 504]);

/** Node network error codes considered transient. */
const TRANSIENT_CODES = new Set(["ECONNRESET", "ETIMEDOUT", "ECONNREFUSED"]);

export interface TransientError extends Error {
  status?: number;
  code?: string;
  /** Shopify Retry-After header value in seconds, if present. */
  retryAfterSeconds?: number;
}

/** Returns true if this error is safe to retry. */
export function isTransient(err: unknown): err is TransientError {
  if (!(err instanceof Error)) return false;
  const e = err as TransientError;
  if (e.status !== undefined && TRANSIENT_STATUSES.has(e.status)) return true;
  if (e.code !== undefined && TRANSIENT_CODES.has(e.code)) return true;
  // Shopify GraphQL throttling comes back as a THROTTLED extensions code
  if (e.message.includes("THROTTLED")) return true;
  return false;
}

/** Sleep for `ms` milliseconds. */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Jitter: add up to 20% random noise to a delay. */
function jitter(ms: number): number {
  return ms + Math.floor(Math.random() * ms * 0.2);
}

/**
 * Execute `fn`, retrying on transient errors with exponential backoff + jitter.
 * Throws immediately on non-transient errors.
 */
export async function withRetry<T>(
  label: string,
  fn: () => Promise<T>,
  opts: RetryOptions = {}
): Promise<T> {
  const maxAttempts = opts.maxAttempts ?? 5;
  const baseDelayMs = opts.baseDelayMs ?? 1000;
  const maxDelayMs = opts.maxDelayMs ?? 30_000;

  let lastErr: unknown;
  for (let attempt = 0; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err: unknown) {
      lastErr = err;

      if (!isTransient(err)) {
        // Permanent error — rethrow immediately, no retry.
        throw err;
      }

      if (attempt === maxAttempts) break;

      const transient = err as TransientError;
      let delay: number;
      if (transient.retryAfterSeconds !== undefined) {
        delay = transient.retryAfterSeconds * 1000 + 500;
      } else {
        delay = jitter(Math.min(baseDelayMs * Math.pow(2, attempt), maxDelayMs));
      }

      logger.warn(`[retry] ${label}: attempt ${attempt + 1}/${maxAttempts}, waiting ${delay}ms`, {
        status: transient.status,
        code: transient.code,
        message: transient.message,
      });

      await sleep(delay);
    }
  }

  throw lastErr;
}
