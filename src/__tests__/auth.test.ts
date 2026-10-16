/**
 * Tests for Shopify Authentication module.
 *
 * Verifies:
 * 1. resolveAccessToken uses adminToken directly if provided.
 * 2. resolveAccessToken performs client credentials grant if clientId/Secret provided.
 * 3. Cached token is reused without extra network calls while valid.
 * 4. Missing credentials throws an informative error without leaking secrets.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { resolveAccessToken, clearTokenCache } from "../auth.js";
import { type ProfileConfig } from "../config.js";

describe("auth module", () => {
  let originalFetch: typeof global.fetch;

  beforeEach(() => {
    originalFetch = global.fetch;
    clearTokenCache();
  });

  afterEach(() => {
    global.fetch = originalFetch;
    clearTokenCache();
  });

  it("returns adminToken directly when available", async () => {
    const profile: ProfileConfig = {
      role: "source",
      shop: "test.myshopify.com",
      authMode: "client_credentials",
      adminToken: "shpat_test_token_123",
    };

    const token = await resolveAccessToken(profile);
    expect(token).toBe("shpat_test_token_123");
  });

  it("exchanges client credentials and caches token in memory", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        access_token: "shpca_minted_access_token",
        expires_in: 86400,
      }),
      text: async () => "",
    });
    global.fetch = mockFetch as unknown as typeof fetch;

    const profile: ProfileConfig = {
      role: "source",
      shop: "test.myshopify.com",
      authMode: "client_credentials",
      clientId: "my_client_id",
      clientSecret: "my_client_secret",
    };

    const token1 = await resolveAccessToken(profile);
    expect(token1).toBe("shpca_minted_access_token");
    expect(mockFetch).toHaveBeenCalledOnce();

    // Second call should return cached token without calling fetch again
    const token2 = await resolveAccessToken(profile);
    expect(token2).toBe("shpca_minted_access_token");
    expect(mockFetch).toHaveBeenCalledOnce();
  });

  it("throws when credentials are completely missing", async () => {
    const profile: ProfileConfig = {
      role: "source",
      shop: "test.myshopify.com",
      authMode: "client_credentials",
    };

    await expect(resolveAccessToken(profile)).rejects.toThrow(
      /Missing credentials for source store/
    );
  });
});
