// tokens.ts — expiring offline access tokens.
// Mandatory for new public apps created on or after 2026-04-01: the access token lives ~1 hour, the refresh
// token ~90 days, and EVERY refresh returns a NEW pair (the old refresh token stops working).
// SKETCH. Verify the refresh request and response field names on shopify.dev ("offline access tokens").
//
// Why this matters for the scheduler: a clone run lasts hours, so workers must fetch the token per task
// (getAccessToken), never cache it for a whole run. Many workers may need a refresh at the same instant, and
// because refresh tokens rotate, a second concurrent refresh with the old token FAILS. Hence the row lock.

import { prisma } from "./scheduler";
import { encrypt, decrypt } from "./crypto";   // envelope-encryption helpers, not shown

const MARGIN_MS = 5 * 60_000;                  // refresh when less than 5 minutes remain, not at 0

/** Map this to the scheduler's Systemic error: the run pauses and the UI shows "Reconnect". */
export class AuthLapsed extends Error {}

export async function getAccessToken(shopId: string): Promise<string> {
  const s = await prisma.shop.findUniqueOrThrow({
    where: { id: shopId }, select: { accessTokenEnc: true, tokenExpiresAt: true },
  });
  if (s.tokenExpiresAt && s.tokenExpiresAt.getTime() - Date.now() > MARGIN_MS) return decrypt(s.accessTokenEnc);
  return refreshLocked(shopId);
}

async function refreshLocked(shopId: string): Promise<string> {
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "Shop" WHERE id = ${shopId} FOR UPDATE`;      // one refresher per shop
    const s = await tx.shop.findUniqueOrThrow({ where: { id: shopId } });

    // Someone else refreshed while we waited for the lock: reuse their token.
    if (s.tokenExpiresAt && s.tokenExpiresAt.getTime() - Date.now() > MARGIN_MS) return decrypt(s.accessTokenEnc);

    if (s.status !== "ACTIVE") throw new AuthLapsed("shop is not active");
    if (!s.refreshTokenEnc || (s.refreshExpiresAt && s.refreshExpiresAt < new Date())) {
      throw new AuthLapsed("refresh token expired: the merchant must reopen the app");
    }

    const res = await fetch(`https://${s.domain}/admin/oauth/access_token`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      signal: AbortSignal.timeout(10_000),
      body: JSON.stringify({
        client_id: process.env.SHOPIFY_API_KEY,
        client_secret: process.env.SHOPIFY_API_SECRET,
        grant_type: "refresh_token",
        refresh_token: decrypt(s.refreshTokenEnc),
      }),
    });
    if (res.status === 400 || res.status === 401) throw new AuthLapsed(`refresh rejected (${res.status})`);
    if (!res.ok) throw new Error(`token refresh failed: ${res.status}`);               // transient: the task retries

    const j = (await res.json()) as {
      access_token: string; refresh_token: string; expires_in: number; refresh_token_expires_in: number;
    };
    const now = Date.now();
    // Save the new access token, refresh token and both expiries in ONE statement. Losing the new refresh token
    // after a successful refresh locks you out of the shop until the merchant reopens the app.
    await tx.shop.update({
      where: { id: shopId },
      data: {
        accessTokenEnc: encrypt(j.access_token),
        refreshTokenEnc: encrypt(j.refresh_token),
        tokenExpiresAt: new Date(now + j.expires_in * 1000),
        refreshExpiresAt: new Date(now + j.refresh_token_expires_in * 1000),
      },
    });
    return j.access_token;
  }, { timeout: 15_000 });
}

/**
 * Keep quiet shops alive: a refresh token dies after ~90 idle days. Call from the sweeper once a day.
 * tokenExpiresAt is about 1 hour after the last refresh, so "expired for 14+ days" means "not refreshed for 14+ days".
 */
export async function refreshIdleShops(): Promise<void> {
  const idle = await prisma.shop.findMany({
    where: { status: "ACTIVE", tokenExpiresAt: { lt: new Date(Date.now() - 14 * 86_400_000) } },
    select: { id: true }, take: 200,
  });
  for (const s of idle) await getAccessToken(s.id).catch(() => {});   // AuthLapsed shops surface as "Reconnect" in the UI
}
