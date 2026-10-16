/**
 * Tests for Mode B OAuth helpers.
 *
 * Verifies:
 * 1. buildAuthorizationUrl produces correct Shopify authorize endpoint with parameters.
 * 2. saveTokenToEnv writes and replaces keys cleanly in .env format.
 * 3. exchangeAuthCode exchanges code for access token via fetch.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import {
  buildAuthorizationUrl,
  saveTokenToEnv,
  exchangeAuthCode,
  SOURCE_READ_SCOPES,
} from "../oauth.js";

const TEST_ENV = "test-oauth.env";

describe("OAuth helpers", () => {
  beforeEach(() => {
    if (fs.existsSync(TEST_ENV)) fs.unlinkSync(TEST_ENV);
  });

  afterEach(() => {
    if (fs.existsSync(TEST_ENV)) fs.unlinkSync(TEST_ENV);
  });

  it("buildAuthorizationUrl constructs the proper query params and shop domain", () => {
    const url = buildAuthorizationUrl(
      "tibbeshifa.myshopify.com",
      "client_123",
      SOURCE_READ_SCOPES,
      "http://localhost:3456/callback",
      "state_abc"
    );

    const parsed = new URL(url);
    expect(parsed.origin).toBe("https://tibbeshifa.myshopify.com");
    expect(parsed.pathname).toBe("/admin/oauth/authorize");
    expect(parsed.searchParams.get("client_id")).toBe("client_123");
    expect(parsed.searchParams.get("redirect_uri")).toBe("http://localhost:3456/callback");
    expect(parsed.searchParams.get("state")).toBe("state_abc");
    expect(parsed.searchParams.get("scope")).toContain("read_products");
  });

  it("saveTokenToEnv appends or updates keys safely", () => {
    saveTokenToEnv(TEST_ENV, "KEY_ONE", "val1");
    let content = fs.readFileSync(TEST_ENV, "utf8");
    expect(content).toContain("KEY_ONE=val1");

    // Update existing key
    saveTokenToEnv(TEST_ENV, "KEY_ONE", "val2");
    content = fs.readFileSync(TEST_ENV, "utf8");
    expect(content).toContain("KEY_ONE=val2");
    expect(content).not.toContain("val1");

    // Add second key
    saveTokenToEnv(TEST_ENV, "KEY_TWO", "val3");
    content = fs.readFileSync(TEST_ENV, "utf8");
    expect(content).toContain("KEY_ONE=val2");
    expect(content).toContain("KEY_TWO=val3");
  });

  it("exchangeAuthCode sends code and returns access_token", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ access_token: "shpat_offline_token_xyz" }),
      text: async () => "",
    });
    global.fetch = mockFetch as unknown as typeof fetch;

    const token = await exchangeAuthCode(
      "tibbeshifa.myshopify.com",
      "cid",
      "csec",
      "auth_code_123"
    );

    expect(token).toBe("shpat_offline_token_xyz");
    expect(mockFetch).toHaveBeenCalledWith(
      "https://tibbeshifa.myshopify.com/admin/oauth/access_token",
      expect.objectContaining({
        method: "POST",
      })
    );
  });
});
