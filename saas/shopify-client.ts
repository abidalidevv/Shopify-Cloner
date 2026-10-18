// shopify-client.ts — every Admin GraphQL call goes through here: shared per-shop rate bucket, token refresh,
// and error classification (Defer = come back later, Systemic = stop the run, plain Error = retry with backoff).
import { prisma } from "./db.js";
import { getAccessToken } from "./tokens.js";
import { Defer, Systemic } from "./errors.js";

export const API_VERSION = process.env.SHOPIFY_API_VERSION ?? "2026-10";
const SIDE = "api";   // Shopify keeps ONE bucket per app per shop, so one row per shop

export type Gql = (query: string, variables?: Record<string, unknown>, opts?: { cost?: number; idempotencyKey?: string }) => Promise<any>;

/** Spend `cost` points from the shop's shared bucket, or throw Defer when the wait is long (free the worker slot). */
export async function reserve(shopId: string, cost: number): Promise<void> {
  // Seed a conservative bucket on first use; reconcileBucket() corrects it from the first response.
  await prisma.$executeRaw`
    INSERT INTO "ShopThrottle" ("shopId", side, available, "maxPoints", "restoreRate", "updatedAt")
    VALUES (${shopId}, ${SIDE}, 500, 1000, 50, now()) ON CONFLICT ("shopId", side) DO NOTHING`;
  const rows = await prisma.$queryRaw<{ available: number }[]>`
    UPDATE "ShopThrottle" SET
      available = LEAST("maxPoints", available + "restoreRate" * EXTRACT(EPOCH FROM (now() - "updatedAt"))) - ${cost},
      "updatedAt" = now()
    WHERE "shopId" = ${shopId} AND side = ${SIDE}
      AND LEAST("maxPoints", available + "restoreRate" * EXTRACT(EPOCH FROM (now() - "updatedAt"))) >= ${cost}
    RETURNING available`;
  if (rows.length) return;
  const [b] = await prisma.$queryRaw<{ wait_ms: number }[]>`
    SELECT 1000 * GREATEST(0, ${cost} - (available + "restoreRate" * EXTRACT(EPOCH FROM (now() - "updatedAt")))) / "restoreRate" AS wait_ms
    FROM "ShopThrottle" WHERE "shopId" = ${shopId} AND side = ${SIDE}`;
  const wait = Math.ceil(b?.wait_ms ?? 1000);
  if (wait <= 2000) { await new Promise((r) => setTimeout(r, wait)); return reserve(shopId, cost); }
  throw new Defer(wait);
}

export async function reconcileBucket(shopId: string, t: { currentlyAvailable: number; maximumAvailable: number; restoreRate: number }): Promise<void> {
  await prisma.$executeRaw`
    INSERT INTO "ShopThrottle" ("shopId", side, available, "maxPoints", "restoreRate", "updatedAt")
    VALUES (${shopId}, ${SIDE}, ${t.currentlyAvailable}, ${t.maximumAvailable}, ${t.restoreRate}, now())
    ON CONFLICT ("shopId", side) DO UPDATE SET available = ${t.currentlyAvailable}, "maxPoints" = ${t.maximumAvailable}, "restoreRate" = ${t.restoreRate}, "updatedAt" = now()`;
}

export function makeGql(shopId: string, domain: string): Gql {
  return async (query, variables = {}, opts = {}) => {
    await reserve(shopId, opts.cost ?? 10);
    const token = await getAccessToken(shopId);                 // may throw AuthLapsed: map it to Systemic in the task handler
    // Only applies where the mutation declares $idempotencyKey (@idempotent). Everything else relies on reconcile-by-handle.
    const vars = opts.idempotencyKey && query.includes("$idempotencyKey") ? { ...variables, idempotencyKey: opts.idempotencyKey } : variables;
    const res = await fetch(`https://${domain}/admin/api/${API_VERSION}/graphql.json`, {
      method: "POST", headers: { "content-type": "application/json", "x-shopify-access-token": token },
      body: JSON.stringify({ query, variables: vars }), signal: AbortSignal.timeout(60_000),
    });
    if (res.status === 401 || res.status === 402 || res.status === 403 || res.status === 423) throw new Systemic(`shopify ${res.status} for ${domain}`);
    if (res.status === 429) throw new Defer((Number(res.headers.get("retry-after")) || 2) * 1000);
    if (!res.ok) throw new Error(`shopify ${res.status} for ${domain}`);
    const body = (await res.json()) as {
      data?: any; errors?: { message: string; extensions?: { code?: string } }[];
      extensions?: { cost?: { throttleStatus?: { currentlyAvailable: number; maximumAvailable: number; restoreRate: number } } };
    };
    const ts = body.extensions?.cost?.throttleStatus;
    if (ts) await reconcileBucket(shopId, ts);
    if (body.errors?.some((e) => e.extensions?.code === "THROTTLED")) throw new Defer(2000);
    const denied = body.errors?.find((e) => e.extensions?.code === "ACCESS_DENIED");
    if (denied) throw new Systemic(`access denied (missing scope?): ${denied.message}`);
    if (body.errors?.length && !body.data) throw new Error(body.errors[0].message);
    return body.data;
  };
}
