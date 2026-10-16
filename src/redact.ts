/**
 * Token and PII redaction utilities.
 *
 * Rules:
 * - Shopify tokens (shpat_, shpss_, shpca_, shpua_) → [REDACTED_TOKEN]
 * - Email addresses → [REDACTED_EMAIL]
 * - Phone numbers (digits with optional +/spaces/dashes, 7+ digits) → [REDACTED_PHONE]
 * - myshopify.com domains are NOT redacted (not a secret)
 */

const TOKEN_PATTERN = /shp(at|ss|ca|ua)_[A-Za-z0-9]+/g;
const EMAIL_PATTERN = /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g;
// Conservative phone: 7+ consecutive digits, possibly prefixed with + and spaced
const PHONE_PATTERN = /(?:\+?\d[\d\s\-]{6,}\d)/g;

/**
 * Redact secrets and PII from a string before writing to any log or report.
 * This is the single choke-point — every log call goes through here.
 */
export function redact(value: string): string {
  return value
    .replace(TOKEN_PATTERN, "[REDACTED_TOKEN]")
    .replace(EMAIL_PATTERN, "[REDACTED_EMAIL]")
    .replace(PHONE_PATTERN, "[REDACTED_PHONE]");
}

/**
 * Redact a value that may be a string, object, or primitive.
 * Objects are JSON-serialised then redacted.
 */
export function redactAny(value: unknown): string {
  if (typeof value === "string") return redact(value);
  try {
    return redact(JSON.stringify(value));
  } catch {
    return "[UNSERIALIZABLE]";
  }
}
