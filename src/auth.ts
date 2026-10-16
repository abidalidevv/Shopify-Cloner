/**
 * Shopify Authentication Module.
 *
 * Supports:
 * - Mode A: Client Credentials Grant (when stores are in the same organization).
 *   POSTs client_id + client_secret to https://{shop}/admin/oauth/access_token.
 *   Tokens last ~24 hours and are cached in memory ONLY (never written to disk or logs).
 * - Direct token: If SOURCE_ADMIN_TOKEN / DEST_ADMIN_TOKEN is provided in .env.
 * - Mode B: Authorization Code Grant local exchange helper if needed.
 */

import { type ProfileConfig } from "./config.js";
import { logger } from "./logger.js";
import { redact } from "./redact.js";

interface CachedToken {
  accessToken: string;
  expiresAt: number;
}

// In-memory token cache (keyed by shop domain). Never persisted to disk.
const inMemoryTokenCache = new Map<string, CachedToken>();

export interface TokenExchangeResponse {
  access_token: string;
  scope?: string;
  expires_in?: number;
}

/**
 * Exchanges client credentials for a short-lived access token,
 * or returns a cached valid token.
 */
export async function exchangeClientCredentials(
  shop: string,
  clientId: string,
  clientSecret: string
): Promise<string> {
  const cached = inMemoryTokenCache.get(shop);
  const now = Date.now();
  // Use cached token if it has more than 60 seconds of validity remaining
  if (cached && cached.expiresAt > now + 60_000) {
    return cached.accessToken;
  }

  const endpoint = `https://${shop}/admin/oauth/access_token`;
  const params = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    grant_type: "client_credentials",
  });

  logger.info(`Requesting access token for ${shop} via client credentials...`);

  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "Accept": "application/json",
    },
    body: params.toString(),
  });

  if (!response.ok) {
    const errorBody = await response.text().catch(() => "");
    throw new Error(
      `Failed to obtain access token from Shopify for ${shop} (HTTP ${response.status}): ${redact(errorBody)}`
    );
  }

  const json = (await response.json()) as TokenExchangeResponse;
  if (!json.access_token) {
    throw new Error(`Shopify returned HTTP 200 but response is missing access_token for ${shop}`);
  }

  // Default to 24h (86400s) if expires_in not specified by Shopify
  const ttlSeconds = json.expires_in ?? 86_400;
  inMemoryTokenCache.set(shop, {
    accessToken: json.access_token,
    expiresAt: now + ttlSeconds * 1000,
  });

  logger.info(`Successfully obtained access token for ${shop} (valid for ~${Math.round(ttlSeconds / 3600)}h).`);
  return json.access_token;
}

/**
 * Resolves an active access token for a given store profile.
 * Never writes or prints the token.
 */
export async function resolveAccessToken(profile: ProfileConfig): Promise<string> {
  if (profile.adminToken) {
    return profile.adminToken;
  }

  if (profile.clientId && profile.clientSecret) {
    return exchangeClientCredentials(profile.shop, profile.clientId, profile.clientSecret);
  }

  const prefix = profile.role === "source" ? "SOURCE" : "DEST";
  throw new Error(
    `Missing credentials for ${profile.role} store (${profile.shop}). ` +
    `Please set ${prefix}_CLIENT_ID and ${prefix}_CLIENT_SECRET (or ${prefix}_ADMIN_TOKEN) in your .env file.`
  );
}

/** Clear in-memory token cache (used in testing). */
export function clearTokenCache(): void {
  inMemoryTokenCache.clear();
}
