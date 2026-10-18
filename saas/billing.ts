// billing.ts — coverage resolution, one-time Clone Pass, Agency tier, free tier. SKETCH, not compiled.
//
// Constraints found while researching (verify before building):
//   - Shopify App Pricing (managed pricing) does NOT support one-time purchases, and enabling it blocks the
//     Billing API. A $29 one-time pass plus a $79/mo agency plan therefore needs MANUAL pricing (Billing API)
//     for both, and Shopify's docs frame the Billing API as the path for "outlier" models. Explain this in
//     your review notes.
//   - A charge belongs to ONE installed shop: it is created with that shop's token and approved by that
//     shop's admin. So the destination pays; the source never sees a charge.
//   - Development stores are not charged real money, and trial-store collection may be deferred. Treat the
//     destination's plan as part of the decision (see `shop.isDevStore`, set from shop.plan.partnerDevelopment).

import * as crypto from "node:crypto";
import { prisma } from "./scheduler.js";

export const FREE_PRODUCT_LIMIT = 12;
export const FREE_RUNS_PER_ORIGIN = 3;               // abuse cap: lifetime free runs per SOURCE shop
export const PASS_PRICE_USD = 9;
export const AGENCY_PRICE_USD = 49;
export const AGENCY_MAX_PRODUCTS_PER_RUN = 20_000;   // "unlimited" is a marketing word. Enforce fair use.
export const AGENCY_MAX_RUNS_PER_MONTH = 100;

type Gql = (query: string, variables?: Record<string, unknown>) => Promise<any>;

export type Coverage =
  | { kind: "FREE" }
  | { kind: "PASS"; entitlementId: string }
  | { kind: "SPONSORED"; entitlementId: string }     // source store paid on behalf of the pair
  | { kind: "AGENCY"; grantId: string; hubShopId: string }
  | { kind: "PAYMENT_REQUIRED"; reason: string };

const pepperHash = (s: string) => crypto.createHmac("sha256", process.env.BILLING_PEPPER!).update(s).digest("hex");

/* ───────────────────────── 1. Who covers this run? ───────────────────────── */
// Called at preflight (to show the plan) and again at confirm (to enforce it). Order matters: cheapest for
// the merchant first. Always server-side: the UI only displays the result.

export async function resolveCoverage(
  run: { id: string; destShopId: string; pairId: string | null },
  productCount: number,
): Promise<Coverage> {
  const pair = run.pairId
    ? await prisma.storePair.findUnique({ where: { id: run.pairId }, include: { sourceShop: true } })
    : null;

  // 1. Free tier: small stores, capped per ORIGIN shop so reinstalling cannot reset it.
  if (productCount <= FREE_PRODUCT_LIMIT && pair) {
    const used = await prisma.freeUsage.count({ where: { originShopGid: pair.sourceShop.shopGid } });
    if (used < FREE_RUNS_PER_ORIGIN) return { kind: "FREE" };
  }

  // 2. A pass bought on the destination (for this run, or an unassigned one).
  const own = await prisma.entitlement.findFirst({
    where: { shopId: run.destShopId, kind: "CLONE_PASS", status: "ACTIVE", OR: [{ runId: run.id }, { runId: null }] },
  });
  if (own && (own.maxProducts ?? Infinity) >= productCount) return { kind: "PASS", entitlementId: own.id };

  // 3. Agency grant: the destination consented to a hub store running clones into it.
  const grant = await prisma.agencyGrant.findFirst({
    where: { destShopId: run.destShopId, revokedAt: null },
    include: { hubShop: { include: { entitlements: { where: { kind: "AGENCY_SUBSCRIPTION", status: "ACTIVE" } } } } },
  });
  if (grant && grant.hubShop.entitlements.length) {
    const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
    const runsThisMonth = await prisma.auditLog.count({
      where: { shopId: grant.hubShopId, action: "coverage.agency", createdAt: { gte: monthStart } },
    });
    if (productCount > AGENCY_MAX_PRODUCTS_PER_RUN) return { kind: "PAYMENT_REQUIRED", reason: "over the agency per-run product limit" };
    if (runsThisMonth >= AGENCY_MAX_RUNS_PER_MONTH) return { kind: "PAYMENT_REQUIRED", reason: "agency monthly run limit reached" };
    return { kind: "AGENCY", grantId: grant.id, hubShopId: grant.hubShopId };
  }

  // 4. Sponsored: the source store (often the paid, established one) bought a pass for this pair.
  if (run.pairId) {
    const sponsored = await prisma.entitlement.findFirst({
      where: { kind: "CLONE_PASS", status: "ACTIVE", sponsoredPairId: run.pairId },
    });
    if (sponsored && (sponsored.maxProducts ?? Infinity) >= productCount) return { kind: "SPONSORED", entitlementId: sponsored.id };
  }

  return { kind: "PAYMENT_REQUIRED", reason: `${productCount} products exceeds the free limit of ${FREE_PRODUCT_LIMIT}` };
}

/* ───────────────────────── 2. One-time Clone Pass ───────────────────────── */

export async function startPayment(shopId: string, runId: string, gql: Gql, appUrl: string): Promise<string> {
  const shop = await prisma.shop.findUniqueOrThrow({ where: { id: shopId } });

  // Row first, charge second. @@unique([shopId, runId]) means a page refresh can never create a second charge.
  const ent = await prisma.entitlement.upsert({
    where: { shopId_runId: { shopId, runId } },
    create: { shopId, runId, kind: "CLONE_PASS", status: "PENDING" },
    update: {},
  });
  if (ent.status === "PENDING" && ent.confirmationUrl && Date.now() - ent.purchasedAt.getTime() < 24 * 3_600_000) {
    return ent.confirmationUrl;                               // reuse: approving two charges would bill twice
  }

  const r = await gql(
    `mutation($name: String!, $price: MoneyInput!, $url: URL!, $test: Boolean) {
       appPurchaseOneTimeCreate(name: $name, price: $price, returnUrl: $url, test: $test) {
         confirmationUrl appPurchaseOneTime { id } userErrors { field message }
       } }`,
    {
      name: "Clone Pass",
      price: { amount: PASS_PRICE_USD, currencyCode: "USD" },
      url: `${appUrl}/billing/return?run=${runId}`,
      test: shop.isDevStore || process.env.BILLING_TEST === "true",
    },
  );
  const out = r.data.appPurchaseOneTimeCreate;
  if (out.userErrors?.length) throw new Error(`billing: ${out.userErrors[0].message}`);

  await prisma.entitlement.update({
    where: { id: ent.id },
    data: { shopifyChargeGid: out.appPurchaseOneTime.id, confirmationUrl: out.confirmationUrl },
  });
  return out.confirmationUrl;       // route does a TOP-LEVEL redirect (the approval page cannot render inside the iframe)
}

/** Webhook APP_PURCHASES_ONE_TIME_UPDATE is the reliable path. Never trust the return URL alone. */
export async function onOneTimePurchaseUpdate(payload: { app_purchase_one_time: { admin_graphql_api_id: string; status: string } }) {
  const p = payload.app_purchase_one_time;
  const ent = await prisma.entitlement.findFirst({ where: { shopifyChargeGid: p.admin_graphql_api_id } });
  if (!ent) return;
  if (p.status === "ACTIVE") {
    await prisma.entitlement.updateMany({ where: { id: ent.id, status: "PENDING" }, data: { status: "ACTIVE", purchasedAt: new Date() } });
  } else if (p.status === "DECLINED" || p.status === "EXPIRED") {
    await prisma.entitlement.updateMany({ where: { id: ent.id, status: "PENDING" }, data: { status: "CANCELLED" } });
  }
}

/** Fast path when the merchant lands back on returnUrl: ask Shopify directly instead of waiting for the webhook. */
export async function verifyReturn(shopId: string, runId: string, gql: Gql): Promise<boolean> {
  const ent = await prisma.entitlement.findUnique({ where: { shopId_runId: { shopId, runId } } });
  if (!ent?.shopifyChargeGid) return false;
  const r = await gql(`{ currentAppInstallation { oneTimePurchases(first: 10, sortKey: CREATED_AT, reverse: true) { nodes { id status } } } }`);
  const node = r.data.currentAppInstallation.oneTimePurchases.nodes.find((n: { id: string }) => n.id === ent.shopifyChargeGid);
  if (node?.status === "ACTIVE") {
    await prisma.entitlement.updateMany({ where: { id: ent.id, status: "PENDING" }, data: { status: "ACTIVE", purchasedAt: new Date() } });
    return true;
  }
  return false;
}

/* ───────────────────────── 3. Consume at the moment writes start ───────────────────────── */
// Call when stage 1 begins. Consuming earlier would charge for runs that die in preflight.

export async function consumeCoverage(runId: string, destShopId: string, c: Coverage, ctx: { originShopGid: string; destShopGid: string; productCount: number }) {
  await prisma.$transaction(async (tx: any) => {
    if (c.kind === "FREE") {
      await tx.freeUsage.create({ data: { originShopGid: ctx.originShopGid, destShopGid: ctx.destShopGid, runId, productCount: ctx.productCount } });
    } else if (c.kind === "PASS" || c.kind === "SPONSORED") {
      const r = await tx.entitlement.updateMany({
        where: { id: c.entitlementId, status: "ACTIVE" },                 // atomic: one pass funds exactly one run
        data: { status: "CONSUMED", consumedByRunId: runId },
      });
      if (r.count !== 1) throw new Error("pass already consumed");
    } else if (c.kind === "AGENCY") {
      await tx.auditLog.create({ data: { shopId: c.hubShopId, action: "coverage.agency", meta: { runId, destShopId } } });
    } else {
      throw new Error(`run is not covered: ${c.reason}`);
    }
  });
}

/** "You only pay for a clone that works": give the pass back if the run died before real progress. */
export async function releasePassIfFailedEarly(runId: string, itemsDone: number, itemsTotal: number) {
  if (itemsTotal > 0 && itemsDone / itemsTotal >= 0.1) return;
  await prisma.entitlement.updateMany({ where: { consumedByRunId: runId }, data: { status: "ACTIVE", consumedByRunId: null } });
}

/* ───────────────────────── 4. Agency tier ───────────────────────── */
// The subscription lives on ONE paid store the agency owns (the "hub"), because Shopify bills per shop.
// Client destination stores install the app for free and redeem a token; the destination's admin must consent.

export async function startAgencySubscription(shopId: string, gql: Gql, appUrl: string): Promise<string> {
  const shop = await prisma.shop.findUniqueOrThrow({ where: { id: shopId } });
  const r = await gql(
    `mutation($name: String!, $lineItems: [AppSubscriptionLineItemInput!]!, $url: URL!, $test: Boolean) {
       appSubscriptionCreate(name: $name, lineItems: $lineItems, returnUrl: $url, test: $test) {
         confirmationUrl appSubscription { id } userErrors { field message } } }`,
    {
      name: "Agency",
      lineItems: [{ plan: { appRecurringPricingDetails: { price: { amount: AGENCY_PRICE_USD, currencyCode: "USD" }, interval: "EVERY_30_DAYS" } } }],
      url: `${appUrl}/billing/agency-return`,
      test: shop.isDevStore || process.env.BILLING_TEST === "true",
    },
  );
  const out = r.data.appSubscriptionCreate;
  if (out.userErrors?.length) throw new Error(`billing: ${out.userErrors[0].message}`);
  await prisma.entitlement.create({ data: { shopId, kind: "AGENCY_SUBSCRIPTION", status: "PENDING", shopifyChargeGid: out.appSubscription.id } });
  return out.confirmationUrl;
}

/** Webhook APP_SUBSCRIPTIONS_UPDATE: ACTIVE grants access; CANCELLED / EXPIRED / FROZEN / DECLINED remove it. */
export async function onSubscriptionUpdate(payload: { app_subscription: { admin_graphql_api_id: string; status: string } }) {
  const p = payload.app_subscription;
  await prisma.entitlement.updateMany({
    where: { shopifyChargeGid: p.admin_graphql_api_id, kind: "AGENCY_SUBSCRIPTION" },
    data: { status: p.status === "ACTIVE" ? "ACTIVE" : p.status === "PENDING" ? "PENDING" : "CANCELLED" },
  });
}

export async function createAgencyToken(hubShopId: string, label: string): Promise<{ id: string; token: string }> {
  const token = "agy_" + crypto.randomBytes(24).toString("base64url");
  const row = await prisma.agencyToken.create({ data: { hubShopId, label, tokenHash: pepperHash(token) } });
  return { id: row.id, token };                                // plaintext is returned once and never stored
}

export async function redeemAgencyToken(destShopId: string, approvedByUserId: string | null, token: string) {
  const row = await prisma.agencyToken.findUnique({ where: { tokenHash: pepperHash(token) } });
  if (!row || row.revokedAt) throw new Error("invalid token");
  const sub = await prisma.entitlement.findFirst({ where: { shopId: row.hubShopId, kind: "AGENCY_SUBSCRIPTION", status: "ACTIVE" } });
  if (!sub) throw new Error("the agency subscription is not active");
  if (row.hubShopId === destShopId) throw new Error("a hub cannot grant itself");

  await prisma.$transaction([
    prisma.agencyGrant.upsert({
      where: { hubShopId_destShopId: { hubShopId: row.hubShopId, destShopId } },
      create: { hubShopId: row.hubShopId, destShopId, tokenId: row.id, approvedByUserId },
      update: { revokedAt: null, tokenId: row.id, approvedByUserId },
    }),
    prisma.agencyToken.update({ where: { id: row.id }, data: { lastUsedAt: new Date() } }),
    prisma.auditLog.create({ data: { shopId: destShopId, actorUserId: approvedByUserId, action: "agency.grant", meta: { hubShopId: row.hubShopId } } }),
  ]);
}
