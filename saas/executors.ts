// executors.ts — apply remapped payloads to the destination store, one source item at a time.
//
// Contract with the scheduler (runShard):
//   - An executor receives ONE source item (already stitched into a single JSON object by the extractor),
//     the IdMap row if the item was handled before, and a Ctx.
//   - It returns ok | skipped | failed. It THROWS only Defer (come back later) or Systemic (stop the run).
//   - It is idempotent: replaying an item after a crash must neither duplicate nor corrupt anything.
//     Four mechanisms: checksum skip, reconcile-by-handle before create, IdMap written as early as possible,
//     and deterministic idempotency keys where Shopify supports them.
//
// No Prisma, no pg-boss, no global fetch in here: persistence is ctx.db, HTTP is ctx.http, time is ctx.sleep.
// That is what makes every executor unit-testable with fakes.

import crypto from "node:crypto";
import { Defer, RemapError } from "./errors.js";
import {
  newCollector, rewriteHtml, rewriteUrl, rewriteJsonDeep, rewriteUrlsInText,
  remapMetafield, resolveGid, toProductSetInput, mapDestVariants,
} from "./remapper.js";
import type { Collector, DeferredRef, RemapCtx, SrcMetafield, SrcProduct, Warning } from "./remapper.js";

/* ───────────────────────── Contract types ───────────────────────── */

export type Outcome =
  | { kind: "ok" | "skipped" }
  | { kind: "failed"; code: string; message: string; userErrors?: unknown; retryable?: boolean };

export type IdMapRow = { destGid: string; destHandle: string | null; checksum: string | null; destUrl?: string | null };
export type ItemExecutor = (ctx: Ctx, item: any, existing: IdMapRow | undefined) => Promise<Outcome>;

export interface MapExtra {
  sourceHandle?: string | null; destHandle?: string | null; sourceUrl?: string | null; destUrl?: string | null;
  checksum?: string | null; status?: "CREATED" | "UPDATED" | "SKIPPED_EXISTING";
}
export interface ExecDb {
  saveMap(type: string, sourceGid: string, destGid: string, extra?: MapExtra): Promise<void>;
  recordWarnings(type: string, sourceGid: string, detail: { warnings: Warning[]; unresolvedUrls: string[] }): Promise<void>;
  saveDeferred(rows: DeferredRef[]): Promise<void>;
}
export interface DestClient {
  shopId: string; domain: string;
  /** Returns `data`. Throws Defer on THROTTLED/429 and Systemic on auth or scope failures. */
  gql(query: string, variables?: Record<string, unknown>, opts?: { cost?: number; idempotencyKey?: string }): Promise<any>;
}
export interface Ctx {
  run: { id: string; conflictPolicy: string };
  stage: number; pass: string; originShopGid: string;
  dest: DestClient; remap: RemapCtx; db: ExecDb;
  r2: { presign(key: string, ttlSec?: number): Promise<string>; streamJsonl(key: string): AsyncIterable<any> };
  http: typeof fetch;
  sleep(ms: number): Promise<void>;
}

/* ───────────────────────── Helpers ───────────────────────── */

type UserError = { field?: unknown; message: string; code?: string | null };
const sha = (x: unknown): string => crypto.createHash("sha256").update(JSON.stringify(x)).digest("hex");
const firstError = (ue?: UserError[] | null): UserError | undefined => (ue && ue.length ? ue[0] : undefined);
const rcFor = (ctx: Ctx, c: Collector): RemapCtx => ({ ...ctx.remap, c });
const flush = (ctx: Ctx, type: string, id: string, c: Collector) =>
  ctx.db.recordWarnings(type, id, { warnings: c.warnings, unresolvedUrls: c.unresolvedUrls });

interface UpsertSpec {
  type: string;
  src: { id: string; handle?: string | null };
  existing: IdMapRow | undefined;
  build(): { payload: unknown; c: Collector };
  findExisting?(): Promise<string | undefined>;                       // reconcile by handle BEFORE creating
  send(destId: string | undefined, payload: any, idemKey: string): Promise<{ destGid?: string; destHandle?: string | null; userErrors?: UserError[]; extra?: any }>;
  mapExtra?(payload: any): MapExtra;
  after?(destGid: string, payload: any, res: any): Promise<void>;
}

/** The common spine: build -> checksum skip -> reconcile -> send -> IdMap -> warnings. */
async function mappedUpsert(ctx: Ctx, s: UpsertSpec): Promise<Outcome> {
  let built: { payload: unknown; c: Collector };
  try { built = s.build(); }
  catch (e) { if (e instanceof RemapError) return { kind: "failed", code: e.code, message: e.message }; throw e; }

  const checksum = sha(built.payload);
  if (s.existing && s.existing.checksum === checksum && ctx.run.conflictPolicy !== "OVERWRITE") {
    await flush(ctx, s.type, s.src.id, built.c);
    return { kind: "skipped" };
  }
  const destId = s.existing?.destGid ?? (s.findExisting ? await s.findExisting() : undefined);
  const key = sha([ctx.originShopGid, ctx.dest.shopId, s.type, s.src.id, checksum]);   // no attempt number: a retry is the same operation
  const res = await s.send(destId, built.payload, key);

  const err = firstError(res.userErrors);
  if (err || !res.destGid) return { kind: "failed", code: "USER_ERROR", message: err?.message ?? "Shopify returned no id", userErrors: res.userErrors };

  await ctx.db.saveMap(s.type, s.src.id, res.destGid, {
    sourceHandle: s.src.handle ?? null, destHandle: res.destHandle ?? null, checksum,
    status: destId ? "UPDATED" : "CREATED", ...(s.mapExtra?.(built.payload) ?? {}),
  });
  if (s.after) await s.after(res.destGid, built.payload, res);
  await flush(ctx, s.type, s.src.id, built.c);
  return { kind: "ok" };
}

/** Metafields on owners created after Stage 5 (pages, blogs, articles): everything they can reference exists by now. */
function simpleMetafields(list: SrcMetafield[] | undefined, ctx: Ctx, c: Collector) {
  const out: { namespace: string; key: string; type: string; value: string }[] = [];
  for (const mf of list ?? []) {
    const r = remapMetafield(mf, ctx.remap.idx, c, { final: true });
    if (r.kind === "set") out.push(r.mf);
    else c.warnings.push({ code: r.kind === "dropped" ? r.code : "UNRESOLVED_REFERENCE", detail: `${mf.namespace}.${mf.key}` });
  }
  return out;
}

/* ───────────────────────── Stage 2: Files ───────────────────────── */
// HEAD probe -> fileCreate by URL (zero bandwidth) -> staged-upload fallback for unreachable sources ->
// IdMap row BEFORE polling (a crash must never create the file twice) -> poll until READY (destUrl is only known then).

export interface SrcFile {
  id: string; alt: string | null; url: string | null; embedUrl?: string | null;
  contentType: "IMAGE" | "VIDEO" | "EXTERNAL_VIDEO" | "MODEL_3D" | "FILE";
}
const MAX_FALLBACK_BYTES = 100 * 1024 * 1024;

const FILE_CREATE = `mutation($files: [FileCreateInput!]!) { fileCreate(files: $files) { files { id fileStatus } userErrors { field message code } } }`;
const FILE_STATE = `query($id: ID!) { node(id: $id) { __typename
  ... on MediaImage { fileStatus image { url } } ... on Video { fileStatus originalSource { url } }
  ... on Model3d { fileStatus originalSource { url } } ... on GenericFile { fileStatus url } } }`;
const STAGED = `mutation($input: [StagedUploadInput!]!) { stagedUploadsCreate(input: $input) {
  stagedTargets { url resourceUrl parameters { name value } } userErrors { field message } } }`;

async function probe(ctx: Ctx, url: string): Promise<boolean> {
  const ok = (s: number) => s === 200 || s === 206;
  try {
    const r = await ctx.http(url, { method: "HEAD", redirect: "follow", signal: AbortSignal.timeout(8000) });
    if (ok(r.status)) return true;
    if (r.status === 405 || r.status === 403) {                       // some CDNs refuse HEAD
      const g = await ctx.http(url, { headers: { range: "bytes=0-0" }, redirect: "follow", signal: AbortSignal.timeout(8000) });
      return ok(g.status);
    }
    return false;
  } catch { return false; }
}

/** Fallback for sources Shopify's servers cannot fetch: we download once and push through a staged upload. */
async function stagedUpload(ctx: Ctx, src: SrcFile): Promise<string | { error: string }> {
  let res: Response;
  try { res = await ctx.http(src.url!, { redirect: "follow", signal: AbortSignal.timeout(60_000) }); }
  catch { return { error: "download failed" }; }
  if (!res.ok) return { error: `source returned ${res.status}` };
  const len = Number(res.headers.get("content-length") ?? 0);
  if (len > MAX_FALLBACK_BYTES) return { error: `${len} bytes is over the ${MAX_FALLBACK_BYTES} byte fallback limit` };
  const buf = new Uint8Array(await res.arrayBuffer());
  if (buf.byteLength > MAX_FALLBACK_BYTES) return { error: `${buf.byteLength} bytes is over the fallback limit` };

  const mime = res.headers.get("content-type")?.split(";")[0] ?? "application/octet-stream";
  let name = "file";
  try { name = decodeURIComponent(new URL(src.url!).pathname.split("/").pop() || "file"); } catch { /* keep default */ }
  const d = await ctx.dest.gql(STAGED, { input: [{ filename: name, mimeType: mime, resource: src.contentType === "EXTERNAL_VIDEO" ? "FILE" : src.contentType, httpMethod: "POST", fileSize: String(buf.byteLength) }] }, { cost: 10 });
  const target = d.stagedUploadsCreate.stagedTargets?.[0];
  const ue = firstError(d.stagedUploadsCreate.userErrors);
  if (!target || ue) return { error: ue?.message ?? "no staged target returned" };

  const form = new FormData();
  for (const p of target.parameters as { name: string; value: string }[]) form.append(p.name, p.value);
  form.append("file", new Blob([buf], { type: mime }), name);            // the file field must come last
  const up = await ctx.http(target.url, { method: "POST", body: form, signal: AbortSignal.timeout(120_000) });
  if (!up.ok) return { error: `staged upload rejected (${up.status})` };
  return target.resourceUrl as string;
}

export const fileExecutor: ItemExecutor = async (ctx, src: SrcFile, existing) => {
  if (existing?.destUrl) return { kind: "skipped" };
  const external = src.contentType === "EXTERNAL_VIDEO";
  const sourceUrl = external ? src.embedUrl : src.url;
  if (!sourceUrl) return { kind: "failed", code: "NO_SOURCE_URL", message: `file ${src.id} has no downloadable URL` };

  let destGid = existing?.destGid;
  if (!destGid) {
    let originalSource = sourceUrl;
    if (!external && !(await probe(ctx, sourceUrl))) {
      const staged = await stagedUpload(ctx, src);
      if (typeof staged !== "string") return { kind: "failed", code: "SOURCE_UNREACHABLE", message: `${src.id}: ${staged.error}`, retryable: false };
      originalSource = staged;                                          // do NOT also send `filename`: Shopify rejects the mismatch
    }
    const d = await ctx.dest.gql(FILE_CREATE, { files: [{ originalSource, contentType: src.contentType, alt: src.alt ?? undefined }] }, { cost: 15 });
    const ue = firstError(d.fileCreate.userErrors), f = d.fileCreate.files?.[0];
    if (ue || !f?.id) return { kind: "failed", code: "USER_ERROR", message: ue?.message ?? "no file id", userErrors: d.fileCreate.userErrors };
    destGid = f.id as string;
    await ctx.db.saveMap("FILE", src.id, destGid, { sourceUrl: src.url, destUrl: null, status: "CREATED" });   // BEFORE polling
  }
  if (external) return { kind: "ok" };                                  // no CDN url to wait for

  for (let i = 0; i < 6; i++) {
    const n = (await ctx.dest.gql(FILE_STATE, { id: destGid }, { cost: 2 })).node;
    if (n?.fileStatus === "FAILED") return { kind: "failed", code: "FILE_PROCESSING_FAILED", message: `${src.id} failed processing on the destination` };
    if (n?.fileStatus === "READY") {
      await ctx.db.saveMap("FILE", src.id, destGid, { sourceUrl: src.url, destUrl: n.image?.url ?? n.originalSource?.url ?? n.url ?? null, status: "CREATED" });
      return { kind: "ok" };
    }
    await ctx.sleep(2000);
  }
  throw new Defer(15_000);                                              // still processing; the IdMap row exists, so nothing is re-created
};

/* ───────────────────────── Stage 4: Metaobject entries (two passes) ───────────────────────── */
// Pass A creates entries but omits references to other metaobjects (they may not exist yet).
// Pass B re-upserts with those references filled in; the payload checksum differs, so only entries that need it are touched.
// shopify--* taxonomy entries use the same path: metaobjectUpsert is accepted for them even though creating their DEFINITIONS is not
// (verified live on TibbeShifa). Kill switch: ALLOW_TAXONOMY_UPSERT=false. If Shopify ever rejects it, the item is skipped with a notice
// and product metafields fall back to the remapper's STANDARD_TAXONOMY_REFERENCE path.

export interface SrcMetaobject { id: string; handle: string; type: string; fields: { key: string; value: string | null; type: string }[] }
const METAOBJECT_UPSERT = `mutation($handle: MetaobjectHandleInput!, $metaobject: MetaobjectUpsertInput!) {
  metaobjectUpsert(handle: $handle, metaobject: $metaobject) { metaobject { id handle } userErrors { field message code } } }`;

export const metaobjectExecutor: ItemExecutor = async (ctx, src: SrcMetaobject, existing) => {
  const taxonomy = src.type.startsWith("shopify--");
  const warnOnly = async (code: string, detail: string): Promise<Outcome> => {
    await ctx.db.recordWarnings("METAOBJECT", src.id, { warnings: [{ code, detail }], unresolvedUrls: [] });
    return { kind: "skipped" };
  };
  if (taxonomy && process.env.ALLOW_TAXONOMY_UPSERT === "false") return warnOnly("TAXONOMY_UPSERT_DISABLED", `${src.type}/${src.handle}`);

  const pass2 = ctx.pass === "B";
  const late: DeferredRef[] = [];                                       // references to products/collections/pages: they do not exist until stages 5-8
  const r = await mappedUpsert(ctx, {
    type: "METAOBJECT", src, existing,
    build: () => {
      late.length = 0;
      const c = newCollector(), fields: { key: string; value: string }[] = [];
      for (const f of src.fields) {
        if (f.value === null || f.value === "") continue;
        const o = remapMetafield({ namespace: "mo", key: f.key, type: f.type, value: f.value }, ctx.remap.idx, c,
          pass2 ? {} : { extraDefer: ["METAOBJECT"] });                  // pass B: metaobject targets must exist by now, so unmapped = dropped
        if (o.kind === "set") fields.push({ key: f.key, value: o.mf.value });
        else if (o.kind === "dropped") c.warnings.push({ code: o.code, detail: `${src.type}.${f.key}: ${o.detail}` });
        else if (pass2) late.push({ ownerKind: "METAOBJECT", ownerSourceGid: src.id, namespace: "mo", key: f.key, type: f.type, sourceValue: f.value, waitingOn: o.waitingOn });
        // deferred in pass A: omitted now (metaobject refs are filled in pass B, late-kind refs are patched in stage 13)
      }
      return { payload: { handle: { type: src.type, handle: src.handle }, metaobject: { fields } }, c };
    },
    send: async (_destId, p) => {
      const d = await ctx.dest.gql(METAOBJECT_UPSERT, p, { cost: 10 + p.metaobject.fields.length });
      const u = d.metaobjectUpsert;
      return { destGid: u.metaobject?.id, destHandle: u.metaobject?.handle, userErrors: u.userErrors };
    },
  });
  if (r.kind === "failed" && taxonomy && /reserved|not authorized|access denied/i.test(r.message)) {
    return warnOnly("TAXONOMY_UPSERT_REJECTED", `${src.type}/${src.handle}: ${r.message}`);
  }
  // Saved even when the item was skipped by checksum: pass A and pass B payloads are identical for entries whose only
  // pending references are late kinds, so the skip path must not lose them. saveDeferred is an idempotent upsert.
  if (pass2 && late.length && r.kind !== "failed") await ctx.db.saveDeferred(late);
  return r;
};

/* ───────────────────────── Stage 5: Products ───────────────────────── */

const PRODUCT_SELECTION = `id handle variants(first: 250) { nodes { id selectedOptions { name value } inventoryItem { id } } pageInfo { hasNextPage endCursor } }`;
const PRODUCT_SET = `mutation($input: ProductSetInput!, $identifier: ProductSetIdentifiers, $synchronous: Boolean!) {
  productSet(input: $input, identifier: $identifier, synchronous: $synchronous) {
    product { ${PRODUCT_SELECTION} } productSetOperation { id status } userErrors { field message code } } }`;
const PRODUCT_OP = `query($id: ID!) { productOperation(id: $id) { __typename status
  ... on ProductSetOperation { product { ${PRODUCT_SELECTION} } userErrors { field message code } } } }`;
const VARIANT_PAGE = `query($id: ID!, $after: String) { product(id: $id) { variants(first: 250, after: $after) {
  nodes { id selectedOptions { name value } inventoryItem { id } } pageInfo { hasNextPage endCursor } } } }`;
const PRODUCT_BY_HANDLE = `query($h: String!) { productByIdentifier(identifier: { handle: $h }) { id } }`;

export const productExecutor: ItemExecutor = async (ctx, src: SrcProduct, existing) => {
  let plan: ReturnType<typeof toProductSetInput> | undefined;
  return mappedUpsert(ctx, {
    type: "PRODUCT", src, existing,
    build: () => { plan = toProductSetInput(rcFor(ctx, newCollector()), src); return { payload: plan.input, c: plan.c }; },
    findExisting: async () => (await ctx.dest.gql(PRODUCT_BY_HANDLE, { h: src.handle }, { cost: 2 })).productByIdentifier?.id,
    send: async (destId, input) => {
      const p = plan!;
      const d = await ctx.dest.gql(PRODUCT_SET,
        { input, identifier: destId ? { id: destId } : { handle: input.handle }, synchronous: p.synchronous },
        { cost: 20 + input.variants.length * 5 + input.files.length * 3 });
      const r = d.productSet;
      if (r.userErrors?.length) return { userErrors: r.userErrors };

      let product = r.product;
      if (!product && r.productSetOperation) {                          // async path: big products (see remapper's synchronous threshold)
        for (let i = 0; i < 30 && !product; i++) {
          await ctx.sleep(2000);
          const o = (await ctx.dest.gql(PRODUCT_OP, { id: r.productSetOperation.id }, { cost: 3 })).productOperation;
          if (o?.status === "COMPLETE") {
            if (o.userErrors?.length) return { userErrors: o.userErrors };
            product = o.product;
          }
        }
        if (!product) throw new Defer(10_000);                          // retry is safe: productSet upserts by handle
      }
      const nodes = [...product.variants.nodes];
      let page = product.variants.pageInfo;
      while (page.hasNextPage) {                                        // >250 variants: page the rest
        const v = (await ctx.dest.gql(VARIANT_PAGE, { id: product.id, after: page.endCursor }, { cost: 10 })).product.variants;
        nodes.push(...v.nodes); page = v.pageInfo;
      }
      return { destGid: product.id, destHandle: product.handle, extra: { variants: nodes } };
    },
    after: async (_g, _p, res) => {
      const p = plan!;
      const { mapped, unmatched } = mapDestVariants(src, res.extra.variants);
      for (const m of mapped) {
        await ctx.db.saveMap("VARIANT", m.sourceGid, m.destGid);
        await ctx.db.saveMap("INVENTORY", m.sourceGid, m.destInventoryItemGid);   // keyed by SOURCE VARIANT gid; Stage 6 reads it
      }
      if (unmatched.length) p.c.warnings.push({ code: "VARIANT_NOT_MATCHED", detail: `${unmatched.length} variant(s) could not be paired by option values` });
      if (p.deferred.length) await ctx.db.saveDeferred(p.deferred);        // applied by Stage 13
    },
  });
};

/* ───────────────────────── Stage 7: Collections ───────────────────────── */

export interface SrcCollection {
  id: string; handle: string; title: string; descriptionHtml: string | null; sortOrder: string | null; templateSuffix: string | null;
  seo: { title: string | null; description: string | null } | null; imageUrl: string | null; imageAlt: string | null;
  ruleSet: { appliedDisjunctively: boolean; rules: { column: string; relation: string; condition: string; conditionObjectId?: string | null }[] } | null;
  productIds: string[]; metafields: SrcMetafield[];
}
const COLLECTION_BY_HANDLE = `query($h: String!) { collectionByIdentifier(identifier: { handle: $h }) { id } }`;
const COLLECTION_CREATE = `mutation($input: CollectionInput!) { collectionCreate(input: $input) { collection { id handle } userErrors { field message } } }`;
const COLLECTION_UPDATE = `mutation($input: CollectionInput!) { collectionUpdate(input: $input) { collection { id handle } userErrors { field message } } }`;
const COLLECTION_ADD = `mutation($id: ID!, $ids: [ID!]!) { collectionAddProducts(id: $id, productIds: $ids) { collection { id } userErrors { field message } } }`;

export const collectionExecutor: ItemExecutor = async (ctx, src: SrcCollection, existing) => {
  let members: string[] = [];
  return mappedUpsert(ctx, {
    type: "COLLECTION", src, existing,
    build: () => {
      const c = newCollector(), idx = ctx.remap.idx;
      const input: Record<string, unknown> = { title: src.title, handle: src.handle, descriptionHtml: rewriteHtml(src.descriptionHtml, idx, c) };
      if (src.sortOrder) input.sortOrder = src.sortOrder;
      if (src.templateSuffix) input.templateSuffix = src.templateSuffix;
      if (src.seo && (src.seo.title || src.seo.description)) input.seo = { title: src.seo.title ?? undefined, description: src.seo.description ?? undefined };
      if (src.imageUrl) input.image = { src: rewriteUrl(src.imageUrl, idx, c), altText: src.imageAlt ?? undefined };
      const mfs = simpleMetafields(src.metafields, ctx, c);
      if (mfs.length) input.metafields = mfs;

      if (src.ruleSet) {
        // A smart collection with a dropped rule would silently match MORE products, so an unmapped rule fails the item instead.
        input.ruleSet = {
          appliedDisjunctively: src.ruleSet.appliedDisjunctively,
          rules: src.ruleSet.rules.map((r) => {
            if (!r.conditionObjectId) return { column: r.column, relation: r.relation, condition: r.condition };
            const g = resolveGid(r.conditionObjectId, idx, true);
            if (g.status === "mapped" || g.status === "passthrough") return { column: r.column, relation: r.relation, condition: r.condition, conditionObjectId: g.gid };
            throw new RemapError("COLLECTION_RULE_UNMAPPED", `rule ${r.column} references ${r.conditionObjectId}, which was not cloned`);
          }),
        };
      } else {
        members = src.productIds.flatMap((g) => { const d = idx.gid("PRODUCT", g); if (!d) c.warnings.push({ code: "COLLECTION_MEMBER_UNMAPPED", detail: g }); return d ? [d] : []; });
      }
      return { payload: input, c };
    },
    findExisting: async () => (await ctx.dest.gql(COLLECTION_BY_HANDLE, { h: src.handle }, { cost: 2 })).collectionByIdentifier?.id,
    send: async (destId, input) => {
      const d = destId
        ? (await ctx.dest.gql(COLLECTION_UPDATE, { input: { ...input, id: destId } }, { cost: 15 })).collectionUpdate
        : (await ctx.dest.gql(COLLECTION_CREATE, { input }, { cost: 15 })).collectionCreate;
      return { destGid: d.collection?.id, destHandle: d.collection?.handle, userErrors: d.userErrors, extra: { created: !destId } };
    },
    after: async (destGid, _p, res) => {
      if (!res.extra.created) return;                                   // membership is only added on first create
      for (let i = 0; i < members.length; i += 250) {
        const d = await ctx.dest.gql(COLLECTION_ADD, { id: destGid, ids: members.slice(i, i + 250) }, { cost: 20 });
        const ue = firstError(d.collectionAddProducts.userErrors);
        if (ue) throw new Error(`collectionAddProducts: ${ue.message}`);
      }
    },
  });
};

/* ───────────────────────── Stage 8: Pages, blogs, articles ───────────────────────── */

export interface SrcPage { id: string; handle: string; title: string; body: string | null; templateSuffix: string | null; isPublished: boolean; metafields: SrcMetafield[] }
export interface SrcBlog { id: string; handle: string; title: string; commentPolicy: string | null; templateSuffix: string | null }
export interface SrcArticle {
  id: string; blogId: string; blogHandle: string; handle: string; title: string; body: string | null; summary: string | null;
  authorName: string | null; tags: string[]; isPublished: boolean; publishedAt: string | null; templateSuffix: string | null;
  imageUrl: string | null; imageAlt: string | null; metafields: SrcMetafield[];
}
const PAGE_CREATE = `mutation($page: PageCreateInput!) { pageCreate(page: $page) { page { id handle } userErrors { field message code } } }`;
const PAGE_UPDATE = `mutation($id: ID!, $page: PageUpdateInput!) { pageUpdate(id: $id, page: $page) { page { id handle } userErrors { field message code } } }`;
const BLOG_CREATE = `mutation($blog: BlogCreateInput!) { blogCreate(blog: $blog) { blog { id handle } userErrors { field message code } } }`;
const BLOG_UPDATE = `mutation($id: ID!, $blog: BlogUpdateInput!) { blogUpdate(id: $id, blog: $blog) { blog { id handle } userErrors { field message code } } }`;
const ARTICLE_CREATE = `mutation($article: ArticleCreateInput!) { articleCreate(article: $article) { article { id handle } userErrors { field message code } } }`;
const ARTICLE_UPDATE = `mutation($id: ID!, $article: ArticleUpdateInput!) { articleUpdate(id: $id, article: $article) { article { id handle } userErrors { field message code } } }`;
const findByQuery = (field: "pages" | "blogs") => `query($q: String!) { ${field}(first: 1, query: $q) { nodes { id } } }`;

export const pageExecutor: ItemExecutor = async (ctx, src: SrcPage, existing) => mappedUpsert(ctx, {
  type: "PAGE", src, existing,
  build: () => {
    const c = newCollector();
    const page: Record<string, unknown> = { title: src.title, handle: src.handle, body: rewriteHtml(src.body, ctx.remap.idx, c), isPublished: src.isPublished };
    if (src.templateSuffix) page.templateSuffix = src.templateSuffix;
    const mfs = simpleMetafields(src.metafields, ctx, c);
    if (mfs.length) page.metafields = mfs;
    return { payload: page, c };
  },
  findExisting: async () => (await ctx.dest.gql(findByQuery("pages"), { q: `handle:${JSON.stringify(src.handle)}` }, { cost: 3 })).pages.nodes[0]?.id,
  send: async (destId, page) => {
    const r = destId ? (await ctx.dest.gql(PAGE_UPDATE, { id: destId, page }, { cost: 10 })).pageUpdate : (await ctx.dest.gql(PAGE_CREATE, { page }, { cost: 10 })).pageCreate;
    return { destGid: r.page?.id, destHandle: r.page?.handle, userErrors: r.userErrors };
  },
});

export const blogExecutor: ItemExecutor = async (ctx, src: SrcBlog, existing) => mappedUpsert(ctx, {
  type: "BLOG", src, existing,
  build: () => {
    const blog: Record<string, unknown> = { title: src.title, handle: src.handle };
    if (src.commentPolicy) blog.commentPolicy = src.commentPolicy;
    if (src.templateSuffix) blog.templateSuffix = src.templateSuffix;
    return { payload: blog, c: newCollector() };
  },
  findExisting: async () => (await ctx.dest.gql(findByQuery("blogs"), { q: `handle:${JSON.stringify(src.handle)}` }, { cost: 3 })).blogs.nodes[0]?.id,
  send: async (destId, blog) => {
    const r = destId ? (await ctx.dest.gql(BLOG_UPDATE, { id: destId, blog }, { cost: 10 })).blogUpdate : (await ctx.dest.gql(BLOG_CREATE, { blog }, { cost: 10 })).blogCreate;
    return { destGid: r.blog?.id, destHandle: r.blog?.handle, userErrors: r.userErrors };
  },
});

export const articleExecutor: ItemExecutor = async (ctx, src: SrcArticle, existing) => {
  const blogId = ctx.remap.idx.gid("BLOG", src.blogId);
  if (!blogId) return { kind: "failed", code: "BLOG_NOT_MAPPED", message: `blog ${src.blogHandle} was not cloned`, retryable: true };
  return mappedUpsert(ctx, {
    type: "ARTICLE", src: { id: src.id, handle: `${src.blogHandle}/${src.handle}` }, existing,   // rewriteLinkPath looks articles up as "blog/article"
    build: () => {
      const c = newCollector(), idx = ctx.remap.idx;
      const a: Record<string, unknown> = { blogId, title: src.title, handle: src.handle, body: rewriteHtml(src.body, idx, c), isPublished: src.isPublished, tags: src.tags };
      if (src.summary) a.summary = rewriteHtml(src.summary, idx, c);
      if (src.authorName) a.author = { name: src.authorName };
      if (src.publishedAt) a.publishDate = src.publishedAt;
      if (src.templateSuffix) a.templateSuffix = src.templateSuffix;
      if (src.imageUrl) a.image = { url: rewriteUrl(src.imageUrl, idx, c), altText: src.imageAlt ?? undefined };
      const mfs = simpleMetafields(src.metafields, ctx, c);
      if (mfs.length) a.metafields = mfs;
      return { payload: a, c };
    },
    findExisting: async () => {
      const d = await ctx.dest.gql(`query($id: ID!, $q: String!) { blog(id: $id) { articles(first: 1, query: $q) { nodes { id } } } }`,
        { id: blogId, q: `handle:${JSON.stringify(src.handle)}` }, { cost: 4 });
      return d.blog?.articles?.nodes?.[0]?.id;
    },
    send: async (destId, article) => {
      const r = destId ? (await ctx.dest.gql(ARTICLE_UPDATE, { id: destId, article: { ...(article as object), blogId: undefined } }, { cost: 10 })).articleUpdate
                       : (await ctx.dest.gql(ARTICLE_CREATE, { article }, { cost: 10 })).articleCreate;
      return { destGid: r.article?.id, destHandle: r.article?.handle, userErrors: r.userErrors };
    },
    mapExtra: () => ({ destHandle: null }),                         // overwritten below with the blog-qualified handle
    after: async (destGid) => {
      const destBlog = blogHandleOf(ctx, src.blogHandle) ?? src.blogHandle;
      await ctx.db.saveMap("ARTICLE", src.id, destGid, {
        sourceHandle: `${src.blogHandle}/${src.handle}`,
        destHandle: `${destBlog}/${src.handle}`,
      });
    },
  });
};
const blogHandleOf = (ctx: Ctx, sourceBlogHandle: string): string | undefined => {
  return ctx.remap.idx.handle("BLOG", sourceBlogHandle);
};

/* ───────────────────────── Stage 9: Menus ───────────────────────── */

export interface SrcMenuItem { title: string; type: string; url: string | null; resourceId: string | null; tags: string[]; items: SrcMenuItem[] }
export interface SrcMenu { id: string; handle: string; title: string; items: SrcMenuItem[] }
const RESOURCE_ITEM_TYPES = new Set(["COLLECTION", "PRODUCT", "PAGE", "BLOG", "ARTICLE"]);
const PLAIN_ITEM_TYPES = new Set(["FRONTPAGE", "SEARCH", "COLLECTIONS", "CUSTOMER_ACCOUNT_PAGE"]);
const MENU_CREATE = `mutation($title: String!, $handle: String!, $items: [MenuItemCreateInput!]!) { menuCreate(title: $title, handle: $handle, items: $items) { menu { id handle } userErrors { field message code } } }`;
const MENU_UPDATE = `mutation($id: ID!, $title: String!, $handle: String, $items: [MenuItemUpdateInput!]!) { menuUpdate(id: $id, title: $title, handle: $handle, items: $items) { menu { id handle } userErrors { field message code } } }`;

/** Items whose target was not cloned degrade to plain links instead of failing the whole menu. */
export function mapMenuItems(items: SrcMenuItem[], ctx: Ctx, c: Collector): Record<string, unknown>[] {
  const idx = ctx.remap.idx;
  return items.map((it) => {
    const out: Record<string, unknown> = { title: it.title, tags: it.tags ?? [] };
    const asLink = (why: string) => { out.type = "HTTP"; out.url = it.url ? rewriteUrl(it.url, idx, c) : "/"; c.warnings.push({ code: "MENU_ITEM_DEGRADED_TO_LINK", detail: `${it.title}: ${why}` }); };
    if (PLAIN_ITEM_TYPES.has(it.type)) out.type = it.type;
    else if (RESOURCE_ITEM_TYPES.has(it.type) && it.resourceId) {
      const r = resolveGid(it.resourceId, idx, true);
      if (r.status === "mapped") { out.type = it.type; out.resourceId = r.gid; } else asLink(`${it.type} ${it.resourceId} was not cloned`);
    } else if (it.type === "HTTP") { out.type = "HTTP"; out.url = it.url ? rewriteUrl(it.url, idx, c) : "/"; }
    else asLink(`${it.type} items cannot be copied`);
    if (it.items?.length) out.items = mapMenuItems(it.items, ctx, c);
    return out;
  });
}

export const menuExecutor: ItemExecutor = async (ctx, src: SrcMenu, existing) => mappedUpsert(ctx, {
  type: "MENU", src, existing,
  build: () => { const c = newCollector(); return { payload: { title: src.title, handle: src.handle, items: mapMenuItems(src.items, ctx, c) }, c }; },
  findExisting: async () => {                                           // main-menu and footer already exist on every new store
    const d = await ctx.dest.gql(`{ menus(first: 100) { nodes { id handle } } }`, {}, { cost: 5 });
    return (d.menus.nodes as { id: string; handle: string }[]).find((m) => m.handle === src.handle)?.id;
  },
  send: async (destId, p) => {
    const r = destId ? (await ctx.dest.gql(MENU_UPDATE, { id: destId, ...p }, { cost: 15 })).menuUpdate : (await ctx.dest.gql(MENU_CREATE, p, { cost: 15 })).menuCreate;
    return { destGid: r.menu?.id, destHandle: r.menu?.handle, userErrors: r.userErrors };
  },
});

/* ───────────────────────── Stage 11: Theme (pass A create, pass B rewrite) ───────────────────────── */
// Pass A: create an UNPUBLISHED theme from the zip the extractor stored in R2 (themeCreate needs a URL; there is no empty-theme create).
// Pass B: for each text file, rewrite {% schema %} defaults, settings_data.json (including presets), templates, locales and assets
//         through the IdMap, upsert only files that changed, then scan the OUTPUT for anything still pointing at the source store.
//         The crawler only sees rendered pages, so this scan is what catches settings for sections that are not on any crawled page.

export interface SrcThemeItem { kind: "theme" | "file"; id: string; name?: string; zipKey?: string; themeId?: string; filename?: string; text?: string }
const THEME_CREATE = `mutation($source: URL!, $name: String, $role: ThemeRole) { themeCreate(source: $source, name: $name, role: $role) { theme { id name processing } userErrors { field message code } } }`;
const THEME_STATE = `query($id: ID!) { theme(id: $id) { id processing role } }`;
const THEME_FILES_UPSERT = `mutation($themeId: ID!, $files: [OnlineStoreThemeFilesUpsertFileInput!]!) { themeFilesUpsert(themeId: $themeId, files: $files) { upsertedThemeFiles { filename } userErrors { field message code } } }`;

/** Pure and testable: rewrite one theme file and report whether it changed and whether a source reference survived. */
export function rewriteThemeFile(filename: string, text: string, rc: RemapCtx): { text: string; changed: boolean; residual: string | null } {
  let out = text;
  if (/\.json$/i.test(filename)) {
    const m = /^(\s*\/\*[\s\S]*?\*\/\s*)?([\s\S]*)$/.exec(text);       // settings_data.json often starts with a /* ... */ banner
    const banner = m?.[1] ?? "";
    const jsonStr = m?.[2] ?? text;
    try {
      const doc = JSON.parse(jsonStr);
      const next = JSON.stringify(rewriteJsonDeep(doc, rc.idx, rc.c), null, 2);
      if (next !== JSON.stringify(doc, null, 2)) out = banner + next;
    } catch { rc.c.warnings.push({ code: "THEME_JSON_PARSE", detail: filename }); }
  } else {
    out = rewriteUrlsInText(text, rc.idx, rc.c);                         // .liquid (incl. {% schema %}), .css, .js
  }
  const hit = new RegExp(rc.idx.leakRegex.source, "gi").exec(out);
  return { text: out, changed: out !== text, residual: hit ? out.slice(Math.max(0, hit.index - 25), hit.index + 80).replace(/\s+/g, " ") : null };
}

export const themeExecutor: ItemExecutor = async (ctx, item: SrcThemeItem, existing) => {
  if (ctx.pass === "A") {
    if (item.kind !== "theme") return { kind: "skipped" };
    let destGid = existing?.destGid;
    if (!destGid) {
      if (!item.zipKey) return { kind: "failed", code: "THEME_ZIP_MISSING", message: "the extractor did not store a theme archive" };
      const source = await ctx.r2.presign(item.zipKey, 6 * 3600);
      const d = await ctx.dest.gql(THEME_CREATE, { source, name: `${item.name ?? "Theme"} (clone)`, role: "UNPUBLISHED" }, { cost: 20 });
      const ue = firstError(d.themeCreate.userErrors);
      if (ue || !d.themeCreate.theme?.id) return { kind: "failed", code: "USER_ERROR", message: ue?.message ?? "no theme id", userErrors: d.themeCreate.userErrors };
      destGid = d.themeCreate.theme.id as string;
      await ctx.db.saveMap("THEME", item.id, destGid, { sourceHandle: item.name ?? null, status: "CREATED" });
    }
    for (let i = 0; i < 8; i++) {
      const t = (await ctx.dest.gql(THEME_STATE, { id: destGid }, { cost: 2 })).theme;
      if (t && !t.processing) return { kind: "ok" };
      await ctx.sleep(3000);
    }
    throw new Defer(15_000);
  }

  // pass B
  if (item.kind !== "file" || !item.filename || item.text === undefined) return { kind: "skipped" };
  const themeId = item.themeId ? ctx.remap.idx.gid("THEME", item.themeId) : undefined;
  if (!themeId) return { kind: "failed", code: "THEME_NOT_MAPPED", message: "the cloned theme is not in the IdMap", retryable: true };

  const c = newCollector();
  const r = rewriteThemeFile(item.filename, item.text, rcFor(ctx, c));
  if (r.residual) c.warnings.push({ code: "THEME_RESIDUAL_LEAK", detail: `${item.filename}: ${r.residual}` });
  if (r.changed) {
    const d = await ctx.dest.gql(THEME_FILES_UPSERT, { themeId, files: [{ filename: item.filename, body: { type: "TEXT", value: r.text } }] }, { cost: 10 });
    const ue = firstError(d.themeFilesUpsert.userErrors);
    if (ue) return { kind: "failed", code: "USER_ERROR", message: `${item.filename}: ${ue.message}`, userErrors: d.themeFilesUpsert.userErrors };
  }
  await flush(ctx, "THEME", item.id, c);
  return { kind: r.changed ? "ok" : "skipped" };
};

/* ───────────────────────── Registry ───────────────────────── */

const notYet = (name: string): ItemExecutor => {
  let said = false;
  return async () => { if (!said) { said = true; console.warn(`[executors] ${name} has no executor yet; items are skipped`); } return { kind: "skipped" }; };
};

/** Types still without a real executor: skipped loudly, and Stage 13's count checks will show the gap. */
export const NOT_IMPLEMENTED = ["LOCATION", "PUBLICATION", "MARKET", "METAOBJECT_DEFINITION", "METAFIELD_DEFINITION", "INVENTORY", "CATALOG", "PRICE_LIST", "TRANSLATION", "REDIRECT", "POLICY", "DISCOUNT", "CUSTOMER", "ORDER"] as const;

export const EXECUTORS: Record<string, ItemExecutor | undefined> = {
  FILE: fileExecutor, METAOBJECT: metaobjectExecutor, PRODUCT: productExecutor, COLLECTION: collectionExecutor,
  PAGE: pageExecutor, BLOG: blogExecutor, ARTICLE: articleExecutor, MENU: menuExecutor, THEME: themeExecutor,
  ...Object.fromEntries(NOT_IMPLEMENTED.map((t) => [t, notYet(t)])),
};
