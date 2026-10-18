// pairing.ts — pairing approval state machine + the hook into the scheduler.
// SKETCH. Assumes the Shopify app template (React Router / Remix) exposing `authenticate`.
//
// Rule 1: the shop is ALWAYS derived from the verified session token, never from request params.
// Rule 2: two-sided consent. Source approves READING, destination confirms WRITING.

import * as crypto from "node:crypto";
import { prisma, startRun, boss, Q } from "./scheduler.js";
import { authenticate } from "../shopify.server.js";   // from the Shopify app template

/* ───────────────────────── Session verification ─────────────────────────
authenticate.admin(request) does the heavy lifting:
  - reads the App Bridge session token (JWT, HS256, signed with your app's client secret)
  - verifies signature, aud === your client id, exp / nbf, and that `dest` and `iss` hosts match
  - exchanges it (token exchange) for an offline access token for that shop
`sub` in the JWT is the Shopify user id: store it as approvedByUserId / createdByUserId.
For high-trust actions (approving a transfer that includes PII, v1.1) also require the store owner:
verify against the online session's associated_user.account_owner flag.                            */

export async function requireShop(request: Request, opts: { owner?: boolean } = {}) {
  const { session } = await authenticate.admin(request);
  const shop = await prisma.shop.findUniqueOrThrow({ where: { domain: session.shop } });
  if (shop.status !== "ACTIVE") throw new Response("shop inactive", { status: 403 });
  const userId = session.onlineAccessInfo?.associated_user?.id?.toString() ?? null;
  if (opts.owner && !session.onlineAccessInfo?.associated_user?.account_owner) {
    throw new Response("store owner required", { status: 403 });
  }
  return { shop, userId };
}

/* ───────────────────────── Code handling ───────────────────────── */

const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";            // Crockford base32, no I L O U
const makeCode = () => Array.from(crypto.randomBytes(8), (b) => ALPHABET[b % 32] ?? "0").join("");  // 8 chars = 40 bits
// HMAC with a server-side pepper, so a leaked database can't be brute-forced offline.
const hashCode = (code: string) => crypto.createHmac("sha256", process.env.PAIR_PEPPER!).update(code).digest("hex");

const CODE_TTL_MS = 15 * 60_000;
const APPROVAL_TTL_MS = 60 * 60_000;
const MAX_CLAIM_FAILURES = 5;                                 // per destination shop, per 15 minutes

/* ───────────────────────── State machine ─────────────────────────
  (none) --createPair(source)-------------------------> PENDING_CLAIM   (code, 15 min TTL)
  PENDING_CLAIM --claimPair(dest, valid code)---------> PENDING_APPROVAL (code burned, 1 hour TTL)
  PENDING_APPROVAL --approvePair(source staff)--------> ACTIVE
  PENDING_CLAIM / PENDING_APPROVAL --TTL sweep--------> EXPIRED
  any --revoke (either side) / app/uninstalled--------> REVOKED
  ACTIVE --createRun(dest)----------------------------> CloneRun (PREFLIGHT -> AWAITING_CONFIRM -> RUNNING)  */

// 1. Source: generate a code.
export async function createPair(request: Request) {
  const { shop: source, userId } = await requireShop(request);

  // Invalidate any earlier pending codes for this source shop so only one code is valid at a time
  await prisma.storePair.updateMany({
    where: { sourceShopId: source.id, status: "PENDING_CLAIM" },
    data: { status: "REVOKED" },
  });

  const code = makeCode();
  const pair = await prisma.storePair.create({
    data: { sourceShopId: source.id, status: "PENDING_CLAIM", codeHash: hashCode(code), codeExpiresAt: new Date(Date.now() + CODE_TTL_MS) },
  });
  await audit(source.id, userId, "pair.created", { pairId: pair.id });
  return { pairId: pair.id, code };            // the only time the plaintext code exists
}

// 2. Destination: claim with the code. Does NOT grant anything yet.
export async function claimPair(request: Request, code: string) {
  const { shop: dest, userId } = await requireShop(request);

  // Unknown codes can't be attributed to a pair, so the attempt limit is per destination shop.
  const recentFails = await prisma.auditLog.count({
    where: { shopId: dest.id, action: "pair.claim_failed", createdAt: { gt: new Date(Date.now() - 15 * 60_000) } },
  });
  if (recentFails >= MAX_CLAIM_FAILURES) throw new Response("too many attempts", { status: 429 });

  const normalized = code.trim().toUpperCase().replace(/[OIL]/g, (ch) => (ch === "O" ? "0" : "1")).replace(/[^0-9A-Z]/g, "");   // Crockford: O->0, I/L->1
  const result = await prisma.storePair.updateMany({
    where: {
      codeHash: hashCode(normalized), status: "PENDING_CLAIM", codeExpiresAt: { gt: new Date() },
      NOT: { sourceShopId: dest.id },                             // cannot pair a shop with itself
    },
    data: {
      destShopId: dest.id, status: "PENDING_APPROVAL", claimedAt: new Date(),
      codeHash: null,                                              // single use: burned on claim
      codeExpiresAt: new Date(Date.now() + APPROVAL_TTL_MS),       // reused as the approval deadline
    },
  });
  if (result.count !== 1) {
    await audit(dest.id, userId, "pair.claim_failed", {});
    throw new Response("invalid or expired code", { status: 400 });
  }
  await audit(dest.id, userId, "pair.claimed", {});
}

// 3. Source: explicit approval. This is the consent to READ and send data.
//    The UI must show the destination's name, domain, plan, and exactly what will be copied.
export async function approvePair(request: Request, pairId: string, allowed: string[]) {
  const { shop: source, userId } = await requireShop(request /*, { owner: includesPii } */);
  const r = await prisma.storePair.updateMany({
    where: { id: pairId, sourceShopId: source.id, status: "PENDING_APPROVAL", codeExpiresAt: { gt: new Date() } },
    data: { status: "ACTIVE", approvedAt: new Date(), approvedByUserId: userId, allowedResources: allowed as any },
  });
  if (r.count !== 1) throw new Response("cannot approve", { status: 409 });
  await audit(source.id, userId, "pair.approved", { pairId, allowed });
}

// 4. Destination: create the run. Preflight is read-only and runs before any pass is consumed.
export async function createRun(request: Request, pairId: string) {
  const { shop: dest, userId } = await requireShop(request);
  return prisma.$transaction(async (tx: any) => {
    const pair = await tx.storePair.findFirst({ where: { id: pairId, destShopId: dest.id, status: "ACTIVE" } });
    if (!pair) throw new Response("pair not active", { status: 409 });

    // Optional active entitlement (if merchant pre-purchased), but do not consume until confirmation
    const ent = await tx.entitlement.findFirst({ where: { shopId: dest.id, status: "ACTIVE" } });

    // The partial unique index (one active run per destination) rejects a second concurrent run.
    const run = await tx.cloneRun.create({
      data: {
        mode: "DIRECT",
        pairId,
        destShopId: dest.id,
        status: "PREFLIGHT",
        selectedResources: pair.allowedResources,
        createdByUserId: userId,
        entitlementId: ent?.id ?? null,
      },
    });
    return run;       // preflight runs (read-only, no pass spent); the report asks the destination owner to confirm
  });
}

// 5. Destination: confirm after reading the preflight report -> scheduler takes over.
export async function confirmRun(request: Request, runId: string) {
  const { shop: dest } = await requireShop(request);
  const run = await prisma.cloneRun.findFirstOrThrow({ where: { id: runId, destShopId: dest.id } });
  await startRun(run.id);
}

/* ───────────────────────── Uninstall cascade (app/uninstalled webhook) ─────────────────────────
Verify the webhook HMAC, dedupe on X-Shopify-Webhook-Id (WebhookEvent), then:
  1. Shop.status = UNINSTALLED, set redactAfter, wipe the encrypted token
  2. every pair where this shop is source or destination -> REVOKED
  3. every active run touching this shop -> CANCELLED
Workers notice at the next chunk boundary (assertRunActive) and stop; the sweeper ignores non-RUNNING runs. */

export async function onShopUninstalled(shopDomain: string) {
  const shop = await prisma.shop.update({
    where: { domain: shopDomain },
    data: { status: "UNINSTALLED", uninstalledAt: new Date(), accessTokenEnc: Buffer.alloc(0) },
  });
  await prisma.storePair.updateMany({
    where: { OR: [{ sourceShopId: shop.id }, { destShopId: shop.id }], status: { not: "REVOKED" } },
    data: { status: "REVOKED", revokedAt: new Date() },
  });
  await prisma.cloneRun.updateMany({
    where: { OR: [{ destShopId: shop.id }, { pair: { sourceShopId: shop.id } }], status: { in: ["PREFLIGHT", "AWAITING_CONFIRM", "QUEUED", "RUNNING", "PAUSED"] } },
    data: { status: "CANCELLED", finishedAt: new Date() },
  });
}

// Sweeper addition: EXPIRE pairs whose code or approval window passed.
export const expirePairs = () =>
  prisma.storePair.updateMany({
    where: { status: { in: ["PENDING_CLAIM", "PENDING_APPROVAL"] }, codeExpiresAt: { lt: new Date() } },
    data: { status: "EXPIRED", codeHash: null },
  });

const audit = (shopId: string, actorUserId: string | null, action: string, meta: object) =>
  prisma.auditLog.create({ data: { shopId, actorUserId, action, meta } });
