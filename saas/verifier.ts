// verifier.ts — Stage 13: apply deferred references, verify the destination, build the merchant report.
// Runtime dependency: ./remapper only. HTTP, GraphQL and database access are injected (VerifyCtx), so the
// crawler can be tested against a local server and the checks run unchanged in production.
//
// Principles:
//   - Prove it, don't claim it. Every "zero 404" statement in the report is backed by a check row.
//   - Never write one row per healthy page. Failures and warnings get rows, healthy pages get one aggregate.
//   - Know what you rendered. An unpublished cloned theme is NOT what a plain page request renders, so the
//     crawler reads Shopify.theme.id from the HTML and says which theme it actually saw.

import { remapMetafield, newCollector, isReservedNamespace, scanHtml } from "./remapper.js";
import type { RemapIndex } from "./remapper.js";

/* ───────────────────────── Types ───────────────────────── */

export type Outcome = "PASS" | "WARN" | "FAIL" | "SKIPPED";
export interface Check {
  category: string; name: string; outcome: Outcome;
  expected?: string; actual?: string; url?: string; httpStatus?: number;
}
export interface ExpectedPage { kind: "PRODUCT" | "COLLECTION" | "PAGE" | "ARTICLE"; sourceGid: string; destGid?: string; path: string }
export interface PatchRow { id: string; ownerKind: "PRODUCT" | "VARIANT" | "METAOBJECT"; ownerSourceGid: string; namespace: string; key: string; type: string; sourceValue: string }
export interface FailureRow { resourceType: string; sourceGid: string; code: string; message: string; userErrors: unknown }
export interface TemplateUse { kind: "product" | "collection" | "page" | "article" | "blog"; suffix: string; count: number }

export interface VerifyDb {
  expectedPages(): Promise<ExpectedPage[]>;
  templateSuffixes(): Promise<TemplateUse[]>;
  patches(): AsyncGenerator<PatchRow[]>;
  settlePatch(id: string, status: "DONE" | "FAILED", error?: string): Promise<void>;
  failures(): Promise<FailureRow[]>;
  sourceMetafieldKeys(sourceGids: string[]): Promise<Map<string, { namespace: string; key: string; type: string }[]>>;
  saveReport(summary: ReportSummary, checks: Check[]): Promise<void>;
}

export interface Limits {
  pageConcurrency: number; imageConcurrency: number; maxPagesPerKind: number; imageCap: number;
  mediaSample: number; metafieldSample: number; mediaWaitMs: number; maxRowsPerCheck: number;
}
export const DEFAULT_LIMITS: Limits = {
  pageConcurrency: 4, imageConcurrency: 12, maxPagesPerKind: 300, imageCap: 1500,
  mediaSample: 100, metafieldSample: 100, mediaWaitMs: 60_000, maxRowsPerCheck: 100,
};

type Fetch = typeof fetch;
export interface VerifyCtx {
  dest: { shopHandle: string; baseUrl: string; gql(query: string, variables?: Record<string, unknown>): Promise<any> };
  idx: RemapIndex;
  db: VerifyDb;
  destThemeGid?: string;               // the cloned theme on the destination
  previewThemeId?: string;             // numeric id; appended as ?preview_theme_id= to render an unpublished theme
  expectedCounts?: Record<string, number>;
  limits?: Partial<Limits>;
  fetch?: Fetch;
  sleep?: (ms: number) => Promise<void>;
}

export interface ReportSummary {
  verdict: "PASS" | "PASS_WITH_WARNINGS" | "FAIL";
  headline: string;
  totals: Record<Outcome, number>;
  byCategory: Record<string, Record<Outcome, number>>;
  crawled: { pages: number; images: number; sampled: boolean; passwordProtected: boolean; renderedThemeId: string | null };
  topIssues: { name: string; outcome: Outcome; count: number; example?: string }[];
  checklist: { label: string; url: string; why: string }[];
  generatedAt: string;
}

/* ───────────────────────── Helpers ───────────────────────── */

const hash = (s: string): number => { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; };

/** Deterministic sample: the same inputs always pick the same items, so re-verifying is comparable. */
export function sample<T>(items: T[], max: number, key: (x: T) => string): T[] {
  return items.length <= max ? items : [...items].sort((a, b) => hash(key(a)) - hash(key(b))).slice(0, max);
}

async function pool<T>(items: T[], n: number, fn: (x: T) => Promise<void>): Promise<void> {
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(n, items.length) }, async () => {
      while (i < items.length) {
        const item = items[i++];
        if (item !== undefined) await fn(item);
      }
    })
  );
}

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

async function get(f: Fetch, url: string, init: RequestInit = {}): Promise<Response> {
  for (let attempt = 0; ; attempt++) {
    const res = await f(url, { redirect: "manual", headers: { "user-agent": "CloneVerifier/1.0" }, ...init });
    if (res.status !== 429 || attempt >= 3) return res;
    await defaultSleep(Math.min(10_000, (Number(res.headers.get("retry-after")) || 2) * 1000));
  }
}

async function probe(f: Fetch, url: string): Promise<Response> {
  let r = await get(f, url, { method: "HEAD" });
  if (r.status === 405 || r.status === 403) r = await get(f, url, { headers: { range: "bytes=0-0", "user-agent": "CloneVerifier/1.0" } });
  return r;
}

/* ───────────────────────── Entry point ───────────────────────── */

export async function runVerification(ctx: VerifyCtx): Promise<ReportSummary> {
  const L = { ...DEFAULT_LIMITS, ...ctx.limits };
  const checks: Check[] = [];
  const add = (c: Check): void => { checks.push(c); };

  await applyDeferredPatches(ctx, add);
  await checkCounts(ctx, add);
  await checkTemplates(ctx, add);
  const pages = await ctx.db.expectedPages();
  const crawled = await crawl(ctx, L, pages, add);
  await checkMedia(ctx, L, pages, add);
  await checkMetafields(ctx, L, pages, add);
  await summarizeFailures(ctx, add);

  const summary = buildSummary(ctx, checks, crawled);
  await ctx.db.saveReport(summary, checks);
  return summary;
}

/* ───────────────────────── 1. Deferred reference patches ───────────────────────── */
// Products reference each other, and reference collections and pages that did not exist yet during Stage 5.
// By now every IdMap row exists, so resolve with final=true: anything still unmapped is dropped, never retried.

const MF_SET = `mutation($m: [MetafieldsSetInput!]!) {
  metafieldsSet(metafields: $m) { metafields { id } userErrors { field message code elementIndex } } }`;

const MO_UPDATE = `mutation($id: ID!, $metaobject: MetaobjectUpdateInput!) {
  metaobjectUpdate(id: $id, metaobject: $metaobject) { metaobject { id } userErrors { field message code } } }`;

async function applyDeferredPatches(ctx: VerifyCtx, add: (c: Check) => void): Promise<void> {
  let done = 0, failed = 0;
  for await (const batch of ctx.db.patches()) {
    for (let i = 0; i < batch.length; i += 25) {                       // metafieldsSet accepts at most 25 per call
      const send: { p: PatchRow; input: Record<string, string> }[] = [];
      for (const p of batch.slice(i, i + 25)) {
        const owner = ctx.idx.gid(p.ownerKind, p.ownerSourceGid);
        if (!owner) { await ctx.db.settlePatch(p.id, "FAILED", "owner was not cloned"); failed++; continue; }
        const r = remapMetafield({ namespace: p.namespace, key: p.key, type: p.type, value: p.sourceValue }, ctx.idx, newCollector(), { final: true });
        if (r.kind !== "set") { await ctx.db.settlePatch(p.id, "FAILED", r.kind === "dropped" ? r.code : "still unresolved"); failed++; continue; }
        if (p.ownerKind === "METAOBJECT") {                              // metaobject fields are patched with metaobjectUpdate, not metafieldsSet
          const d = await ctx.dest.gql(MO_UPDATE, { id: owner, metaobject: { fields: [{ key: p.key, value: r.mf.value }] } });
          const ue = (d.metaobjectUpdate.userErrors ?? [])[0] as { message: string } | undefined;
          if (ue) { await ctx.db.settlePatch(p.id, "FAILED", ue.message); failed++; } else { await ctx.db.settlePatch(p.id, "DONE"); done++; }
          continue;
        }
        send.push({ p, input: { ownerId: owner, namespace: r.mf.namespace, key: r.mf.key, type: r.mf.type, value: r.mf.value } });
      }
      if (!send.length) continue;
      const d = await ctx.dest.gql(MF_SET, { m: send.map((s) => s.input) });
      const bad = new Map<number, string>();
      for (const e of (d.metafieldsSet.userErrors ?? []) as { message: string; elementIndex?: number | null }[]) {
        if (e.elementIndex == null) send.forEach((_, k) => bad.set(k, e.message)); else bad.set(e.elementIndex, e.message);
      }
      for (let k = 0; k < send.length; k++) {
        const item = send[k];
        if (!item) continue;
        if (bad.has(k)) { await ctx.db.settlePatch(item.p.id, "FAILED", bad.get(k)); failed++; }
        else { await ctx.db.settlePatch(item.p.id, "DONE"); done++; }
      }
    }
  }
  if (done + failed > 0) {
    add({ category: "references", name: "Cross-resource references (related products, collections, pages)",
      outcome: failed ? "WARN" : "PASS", expected: String(done + failed), actual: `${done} applied, ${failed} could not be applied` });
  }
}

/* ───────────────────────── 2. Counts ───────────────────────── */

const COUNT_FIELDS: Record<string, string> = {
  products: "productsCount", collections: "collectionsCount", pages: "pagesCount", blogs: "blogsCount", articles: "articlesCount",
};

async function checkCounts(ctx: VerifyCtx, add: (c: Check) => void): Promise<void> {
  const counts = ctx.expectedCounts ?? {};
  const keys = Object.keys(counts).filter((k) => k in COUNT_FIELDS);
  if (!keys.length) return;
  let data: any;
  try { data = await ctx.dest.gql(`{ ${keys.map((k) => `${k}: ${COUNT_FIELDS[k]} { count }`).join(" ")} }`); }
  catch { add({ category: "counts", name: "Resource counts", outcome: "SKIPPED", actual: "count query failed on this API version" }); return; }
  for (const k of keys) {
    const exp = counts[k];
    if (exp === undefined) continue;
    const act = data[k]?.count;
    add({ category: "counts", name: `${k} count`, expected: String(exp), actual: String(act),
      outcome: act === undefined ? "SKIPPED" : act === exp ? "PASS" : act > exp ? "WARN" : "FAIL" });   // extras can be store defaults
  }
}

/* ───────────────────────── 3. Template suffixes ───────────────────────── */
// The classic migrator bug: pages keep templateSuffix "newmedda" but the theme has no templates/product.newmedda.json,
// so Shopify silently renders the default template. Checked directly against the theme's files, not by guessing from HTML.

async function checkTemplates(ctx: VerifyCtx, add: (c: Check) => void): Promise<void> {
  const uses = await ctx.db.templateSuffixes();
  if (!uses.length) return;
  if (!ctx.destThemeGid) { add({ category: "templates", name: "Custom templates", outcome: "SKIPPED", actual: "no cloned theme id available" }); return; }
  const names = uses.flatMap((u) => [`templates/${u.kind}.${u.suffix}.json`, `templates/${u.kind}.${u.suffix}.liquid`]);
  const found = new Set<string>();
  for (let i = 0; i < names.length; i += 50) {
    const d = await ctx.dest.gql(
      `query($id: ID!, $n: [String!]!) { theme(id: $id) { files(filenames: $n, first: 50) { nodes { filename } } } }`,
      { id: ctx.destThemeGid, n: names.slice(i, i + 50) });
    for (const n of d.theme?.files?.nodes ?? []) found.add(n.filename as string);
  }
  for (const u of uses) {
    const ok = found.has(`templates/${u.kind}.${u.suffix}.json`) || found.has(`templates/${u.kind}.${u.suffix}.liquid`);
    add({ category: "templates", name: `${u.kind} template "${u.suffix}" exists in the cloned theme`, outcome: ok ? "PASS" : "FAIL",
      expected: `${u.count} ${u.kind}(s) use it`, actual: ok ? "present" : "MISSING: these pages fall back to the default template" });
  }
}

/* ───────────────────────── 4. Crawl ───────────────────────── */

interface CrawlStats { pages: number; images: number; sampled: boolean; passwordProtected: boolean; renderedThemeId: string | null }

const IMG_ATTRS = new Set(["src", "srcset", "data-src", "data-srcset", "poster"]);
const IMG_TAGS = new Set(["img", "source", "video"]);

async function crawl(ctx: VerifyCtx, L: Limits, pages: ExpectedPage[], add: (c: Check) => void): Promise<CrawlStats> {
  const f = ctx.fetch ?? fetch;
  const stats: CrawlStats = { pages: 0, images: 0, sampled: false, passwordProtected: false, renderedThemeId: null };
  const base = ctx.dest.baseUrl.replace(/\/$/, "");
  const baseHost = new URL(base).host;

  const byKind = new Map<string, ExpectedPage[]>();
  for (const p of pages) byKind.set(p.kind, [...(byKind.get(p.kind) ?? []), p]);
  const picked: ExpectedPage[] = [];
  for (const list of byKind.values()) {
    const s = sample(list, L.maxPagesPerKind, (x) => x.sourceGid);
    if (s.length < list.length) stats.sampled = true;
    picked.push(...s);
  }

  const ok = new Map<string, number>(), seen = new Map<string, number>(), rows = new Map<string, number>();
  const addCapped = (c: Check): void => {                                        // protect the database from a catastrophic run
    const k = `${c.category}:${c.name}`, n = (rows.get(k) ?? 0) + 1;
    rows.set(k, n);
    if (n <= L.maxRowsPerCheck) add(c);
  };
  const imageRefs = new Map<string, string>();
  const expectedTheme = ctx.destThemeGid?.split("/").pop();
  let themeJudged = false;

  await pool(picked, L.pageConcurrency, async (p) => {
    if (stats.passwordProtected) return;
    const url = base + p.path + (ctx.previewThemeId ? `?preview_theme_id=${ctx.previewThemeId}` : "");
    seen.set(p.kind, (seen.get(p.kind) ?? 0) + 1);
    let res: Response;
    try { res = await get(f, url); } catch (e) {
      addCapped({ category: "pages", name: `${p.kind.toLowerCase()} page reachable`, outcome: "FAIL", url: p.path, actual: `request failed: ${String(e).slice(0, 80)}` });
      return;
    }
    stats.pages++;
    const loc = res.headers.get("location") ?? "";
    if (res.status >= 300 && res.status < 400 && /\/password/.test(loc)) { stats.passwordProtected = true; return; }
    if (res.status >= 300 && res.status < 400) {
      addCapped({ category: "pages", name: `${p.kind.toLowerCase()} page redirects`, outcome: "WARN", url: p.path, httpStatus: res.status, expected: "200", actual: `redirects to ${loc}` });
      return;
    }
    if (res.status !== 200) {
      addCapped({ category: "pages", name: `${p.kind.toLowerCase()} page reachable`, outcome: "FAIL", url: p.path, httpStatus: res.status, expected: "200", actual: String(res.status) });
      return;
    }
    const html = await res.text();

    // Which theme did we actually see?
    const rendered = /Shopify\.theme\s*=\s*\{[^}]*?"id"\s*:\s*(\d+)/.exec(html)?.[1];
    if (rendered && !stats.renderedThemeId) stats.renderedThemeId = rendered;
    if (rendered && !themeJudged && expectedTheme) {
      themeJudged = true;
      add({ category: "templates", name: "Crawl rendered the cloned theme", outcome: rendered === expectedTheme ? "PASS" : "WARN",
        expected: expectedTheme, actual: rendered === expectedTheme ? "yes" : `no, rendered theme ${rendered}. Publish the clone (or share a preview) to verify visually.` });
    }

    // Anything still pointing at the source store will break when it is deleted.
    const re = new RegExp(ctx.idx.leakRegex.source, "gi");
    const hit = [...html.matchAll(re)][0];
    if (hit) {
      addCapped({ category: "leaks", name: "Page still references the source store", outcome: "FAIL", url: p.path,
        actual: html.slice(Math.max(0, hit.index! - 20), hit.index! + 90).replace(/\s+/g, " ") });
      return;
    }

    for (const a of scanHtml(html).attrs) {
      if (!IMG_TAGS.has(a.tag) || !IMG_ATTRS.has(a.name)) continue;
      const raw = html.slice(a.start, a.end).replace(/&amp;/g, "&");
      const cands = a.name.includes("srcset") ? raw.split(/,\s+/).map((s) => s.trim().split(/\s+/)[0]).filter((s): s is string => Boolean(s)) : [raw];
      for (const c of cands) {
        try {
          const u = new URL(c, base + p.path);
          if (u.host === "cdn.shopify.com" || u.host === baseHost) if (!imageRefs.has(u.href)) imageRefs.set(u.href, p.path);
        } catch { /* not a URL */ }
      }
    }
    ok.set(p.kind, (ok.get(p.kind) ?? 0) + 1);
  });

  if (stats.passwordProtected) {
    add({ category: "pages", name: "Storefront crawl", outcome: "SKIPPED",
      actual: "the destination storefront is password protected, so pages cannot be crawled. Disable the password or crawl after launch." });
    return stats;
  }
  for (const [kind, n] of seen) {
    const good = ok.get(kind) ?? 0;
    add({ category: "pages", name: `${kind.toLowerCase()} pages healthy`, outcome: good === n ? "PASS" : "WARN",
      expected: `${n}${stats.sampled ? " (sampled)" : ""}`, actual: `${good} returned 200 with no source-store references` });
  }

  // Images: HEAD each unique URL (capped, deterministic sample).
  const urls = sample([...imageRefs.keys()], L.imageCap, (u) => u);
  stats.images = urls.length;
  let broken = 0;
  await pool(urls, L.imageConcurrency, async (u) => {
    let r: Response | undefined;
    try { r = await probe(f, u); } catch { /* counted below */ }
    const ct = r?.headers.get("content-type") ?? "";
    if (!r || (r.status !== 200 && r.status !== 206) || !/^(image|video)\//.test(ct)) {
      broken++;
      addCapped({ category: "images", name: "Broken image or video", outcome: "FAIL", url: u, ...(r?.status !== undefined ? { httpStatus: r.status } : {}), expected: `referenced by ${imageRefs.get(u)}`, actual: r ? `status ${r.status}, ${ct || "no content type"}` : "request failed" });
    }
  });
  if (urls.length) add({ category: "images", name: "Images load", outcome: broken ? "WARN" : "PASS", expected: String(urls.length), actual: `${urls.length - broken} loaded` });
  return stats;
}

/* ───────────────────────── 5. Media processing status ───────────────────────── */

async function checkMedia(ctx: VerifyCtx, L: Limits, pages: ExpectedPage[], add: (c: Check) => void): Promise<void> {
  const prods = sample(pages.filter((p) => p.kind === "PRODUCT" && p.destGid), L.mediaSample, (p) => p.sourceGid);
  if (!prods.length) return;
  const sleep = ctx.sleep ?? defaultSleep, deadline = Date.now() + L.mediaWaitMs;
  const failed = new Set<string>();
  let pending = prods;
  for (;;) {
    const next: ExpectedPage[] = [];
    for (let i = 0; i < pending.length; i += 50) {
      const chunk = pending.slice(i, i + 50);
      const d = await ctx.dest.gql(`query($ids: [ID!]!) { nodes(ids: $ids) { ... on Product { handle media(first: 50) { nodes { status } } } } }`, { ids: chunk.map((p) => p.destGid) });
      ((d.nodes ?? []) as ({ handle: string; media: { nodes: { status: string }[] } } | null)[]).forEach((n, k) => {
        if (!n) return;
        const st = n.media.nodes.map((m) => m.status);
        if (st.includes("FAILED")) failed.add(n.handle);
        else if (st.some((s) => s === "PROCESSING" || s === "UPLOADED")) {
          const item = chunk[k];
          if (item) next.push(item);
        }
      });
    }
    pending = next;
    if (!pending.length || Date.now() > deadline) break;
    await sleep(5000);
  }
  add({ category: "media", name: "Product media processed", expected: `${prods.length} sampled products`,
    outcome: failed.size ? "FAIL" : pending.length ? "WARN" : "PASS",
    actual: failed.size ? `${failed.size} with failed media, e.g. ${[...failed][0]}` : pending.length ? `${pending.length} still processing` : "all READY" });
}

/* ───────────────────────── 6. Metafields ───────────────────────── */

async function checkMetafields(ctx: VerifyCtx, L: Limits, pages: ExpectedPage[], add: (c: Check) => void): Promise<void> {
  const prods = sample(pages.filter((p) => p.kind === "PRODUCT" && p.destGid), L.metafieldSample, (p) => p.sourceGid);
  if (!prods.length) return;
  const expected = await ctx.db.sourceMetafieldKeys(prods.map((p) => p.sourceGid));
  let hard = 0, soft = 0;
  const ex: string[] = [];
  for (let i = 0; i < prods.length; i += 50) {
    const chunk = prods.slice(i, i + 50);
    const d = await ctx.dest.gql(`query($ids: [ID!]!) { nodes(ids: $ids) { ... on Product { metafields(first: 100) { nodes { namespace key } } } } }`, { ids: chunk.map((p) => p.destGid) });
    chunk.forEach((p, k) => {
      const have = new Set(((d.nodes?.[k]?.metafields?.nodes ?? []) as { namespace: string; key: string }[]).map((m) => `${m.namespace}.${m.key}`));
      for (const e of expected.get(p.sourceGid) ?? []) {
        if (isReservedNamespace(e.namespace) || /^(list\.)?(customer|company)_reference$/.test(e.type)) continue;   // intentionally not cloned
        if (have.has(`${e.namespace}.${e.key}`)) continue;
        if (e.namespace === "shopify") soft++; else hard++;                       // taxonomy attributes are reported separately
        if (ex.length < 3) ex.push(`${p.path} is missing ${e.namespace}.${e.key}`);
      }
    });
  }
  add({ category: "metafields", name: "Product metafields present", expected: `${prods.length} sampled products`,
    outcome: hard ? "FAIL" : soft ? "WARN" : "PASS",
    actual: hard || soft ? `${hard} custom and ${soft} taxonomy metafields missing. ${ex.join("; ")}` : "all expected metafields present" });
}

/* ───────────────────────── 7. What the clone itself recorded ───────────────────────── */

async function summarizeFailures(ctx: VerifyCtx, add: (c: Check) => void): Promise<void> {
  const rows = await ctx.db.failures();
  const warn = new Map<string, { n: number; ex: string }>(), hardFail = new Map<string, { n: number; ex: string }>();
  let unresolved = 0, unresolvedEx = "";
  for (const r of rows) {
    if (r.code !== "WARN") {
      const e = hardFail.get(r.code) ?? { n: 0, ex: `${r.resourceType} ${r.sourceGid}: ${r.message}` };
      e.n++; hardFail.set(r.code, e); continue;
    }
    const d = (r.userErrors ?? {}) as { warnings?: { code: string; detail: string }[]; unresolvedUrls?: string[] };
    for (const w of d.warnings ?? []) { const e = warn.get(w.code) ?? { n: 0, ex: w.detail }; e.n++; warn.set(w.code, e); }
    for (const u of d.unresolvedUrls ?? []) { unresolved++; unresolvedEx ||= u; }
  }
  for (const [code, e] of hardFail) add({ category: "clone", name: `Could not clone: ${code}`, outcome: "FAIL", expected: "0", actual: `${e.n} item(s), e.g. ${e.ex}` });
  if (unresolved) add({ category: "leaks", name: "Links to source-store files that could not be remapped", outcome: "FAIL",
    expected: "0", actual: `${unresolved}, e.g. ${unresolvedEx}. These break when the source store is deleted.` });
  for (const [code, e] of warn) add({ category: "clone", name: `Notice: ${code}`, outcome: "WARN", actual: `${e.n} occurrence(s), e.g. ${e.ex}` });
}

/* ───────────────────────── Report ───────────────────────── */

export function manualChecklist(shopHandle: string): ReportSummary["checklist"] {
  const a = `https://admin.shopify.com/store/${shopHandle}`;
  return [
    { label: "Publish the cloned theme", url: `${a}/themes`, why: "The clone is created unpublished so nothing changes until you decide." },
    { label: "Homepage title and description", url: `${a}/online_store/preferences`, why: "Shopify has no API for these two fields." },
    { label: "Email notification templates", url: `${a}/settings/notifications`, why: "No API either. Use the Notifications Concierge to rewrite and paste." },
    { label: "Payments", url: `${a}/settings/payments`, why: "Payment providers cannot be copied." },
    { label: "Shipping and delivery", url: `${a}/settings/shipping`, why: "Rates and zones are store-specific." },
    { label: "Taxes and duties", url: `${a}/settings/taxes`, why: "Tax settings are not copied." },
    { label: "Checkout settings", url: `${a}/settings/checkout`, why: "Checkout customization is not copied." },
    { label: "Domains", url: `${a}/settings/domains`, why: "Connect your domain when you are ready to go live." },
    { label: "Reinstall your other apps", url: `${a}/settings/apps`, why: "App data and app blocks live with the apps." },
  ];
}

export function buildSummary(ctx: VerifyCtx, checks: Check[], crawled: CrawlStats): ReportSummary {
  const zero = (): Record<Outcome, number> => ({ PASS: 0, WARN: 0, FAIL: 0, SKIPPED: 0 });
  const totals = zero(), byCategory: Record<string, Record<Outcome, number>> = {};
  const issues = new Map<string, { name: string; outcome: Outcome; count: number; example?: string }>();
  for (const c of checks) {
    totals[c.outcome]++;
    (byCategory[c.category] ??= zero())[c.outcome]++;
    if (c.outcome === "FAIL" || c.outcome === "WARN") {
      const k = `${c.outcome}:${c.name}`;
      const exampleVal = c.url ?? c.actual;
      const e = issues.get(k) ?? {
        name: c.name,
        outcome: c.outcome,
        count: 0,
        ...(exampleVal ? { example: exampleVal } : {}),
      };
      e.count++;
      issues.set(k, e);
    }
  }
  const verdict = totals.FAIL ? "FAIL" : totals.WARN ? "PASS_WITH_WARNINGS" : "PASS";
  const topIssues = [...issues.values()].sort((a, b) => (a.outcome === b.outcome ? b.count - a.count : a.outcome === "FAIL" ? -1 : 1)).slice(0, 10);
  const headline = crawled.passwordProtected
    ? "Verification ran, but the storefront crawl was skipped because the destination is password protected."
    : `${crawled.pages} pages and ${crawled.images} images checked${crawled.sampled ? " (sampled)" : ""}: ${totals.FAIL} problem(s), ${totals.WARN} notice(s).`;
  return { verdict, headline, totals, byCategory, crawled, topIssues, checklist: manualChecklist(ctx.dest.shopHandle), generatedAt: new Date().toISOString() };
}
