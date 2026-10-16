/**
 * Tests for redaction module.
 *
 * Verifies that tokens, emails, and phone numbers are scrubbed from strings
 * before they can appear in logs or reports.
 */

import { describe, it, expect } from "vitest";
import { redact, redactAny } from "../redact.js";

describe("redact — Shopify tokens", () => {
  it("redacts shpat_ tokens", () => {
    const result = redact("token=shpat_abc123XYZ");
    expect(result).toBe("token=[REDACTED_TOKEN]");
    expect(result).not.toContain("shpat_");
  });

  it("redacts shpss_ tokens", () => {
    expect(redact("secret=shpss_fooBAR999")).toBe("secret=[REDACTED_TOKEN]");
  });

  it("redacts shpca_ tokens", () => {
    expect(redact("shpca_AbCd1234")).toBe("[REDACTED_TOKEN]");
  });

  it("redacts shpua_ tokens", () => {
    expect(redact("Bearer shpua_ZZZ000")).toBe("Bearer [REDACTED_TOKEN]");
  });

  it("does NOT redact regular myshopify.com domain (not a secret)", () => {
    const domain = "tibbeshifa.myshopify.com";
    expect(redact(domain)).toBe(domain);
  });
});

describe("redact — emails", () => {
  it("redacts a plain email address", () => {
    expect(redact("Contact: ali@tibbeshifa.com")).toBe("Contact: [REDACTED_EMAIL]");
  });

  it("redacts email in JSON-like string", () => {
    const input = '{"email":"user@example.com","name":"Ali"}';
    expect(redact(input)).not.toContain("user@example.com");
    expect(redact(input)).toContain("[REDACTED_EMAIL]");
  });

  it("does NOT mangle strings without @", () => {
    expect(redact("no-email-here")).toBe("no-email-here");
  });
});

describe("redact — phone numbers", () => {
  it("redacts a 10-digit phone number", () => {
    const result = redact("phone: 03001234567");
    expect(result).not.toContain("03001234567");
  });

  it("does NOT redact short digit strings (less than 7 contiguous digits)", () => {
    // e.g. product IDs, order numbers — should not be redacted
    const result = redact("order: 12345");
    // 5 digits — should NOT match the phone pattern
    expect(result).toBe("order: 12345");
  });
});

describe("redactAny — non-string inputs", () => {
  it("serialises an object to JSON then redacts", () => {
    const obj = { token: "shpat_secret123", name: "Ali" };
    const result = redactAny(obj);
    expect(result).not.toContain("shpat_secret123");
    expect(result).toContain("[REDACTED_TOKEN]");
  });

  it("handles primitives", () => {
    expect(redactAny(42)).toBe("42");
    expect(redactAny(true)).toBe("true");
  });

  it("handles null", () => {
    expect(redactAny(null)).toBe("null");
  });
});
