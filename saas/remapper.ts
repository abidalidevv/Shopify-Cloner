// remapper.ts — remapping & rewrite engine for the clone pipeline.
// Zero runtime dependencies: pure functions over an in-memory RemapIndex, so it is unit-testable
// and reusable by Stage 5 (products), 8 (pages/articles), 9 (menus) and 11 (theme JSON).
//
// What makes or breaks "zero 404":
//   1. FILE URLs   : every source CDN URL in rich text / theme settings -> the destination file URL from Stage 2.
//   2. GIDs        : every reference (metafields, options, variants) -> destination GID, or a safe fallback.
//   3. Internal links : source domains stripped, handles remapped, so links survive a domain or handle change.
//
// Design rules:
//   - NEVER send Shopify a payload that is likely to be rejected. An unmappable reference is dropped (and
//     reported) or deferred, never passed through, because one bad GID makes productSet reject the whole product.
//   - Rewrites are byte-preserving: HTML is edited in place by attribute offsets, never re-serialized.
//   - Nothing here throws on dirty merchant data. It records a Warning instead. The only throws are RemapError
//     for structural blockers (gift cards, >2048 variants) which the executor turns into an item failure.

/* ───────────────────────── 1. Types ───────────────────────── */

export type MapKind =
  | "PRODUCT" | "VARIANT" | "COLLECTION" | "PAGE" | "BLOG" | "ARTICLE" | "FILE"
  | "METAOBJECT" | "METAOBJECT_DEFINITION" | "METAFIELD_DEFINITION"
  | "LOCATION" | "MENU" | "MARKET" | "PUBLICATION" | "THEME";

/** One IdMap row (only the fields the remapper needs). */
export interface IdRow {
  resourceType: string;
  sourceGid: string;
  destGid: string;
  sourceHandle?: string | null;   // ARTICLE rows use "blogHandle/articleHandle"
  destHandle?: string | null;
  sourceUrl?: string | null;      // FILE rows: canonical source URL
  destUrl?: string | null;        // FILE rows: URL returned by Shopify once the file is READY
}

export interface Warning { code: string; detail: string }

export interface Collector {
  warnings: Warning[];
  unresolvedUrls: string[];       // source-store URLs we could not map. These WILL break if the source is deleted.
  stats: { filesRewritten: number; linksRewritten: number; gidsRewritten: number };
}
export const newCollector = (): Collector => ({
  warnings: [], unresolvedUrls: [], stats: { filesRewritten: 0, linksRewritten: 0, gidsRewritten: 0 },
});

/* ───────────────────────── 2. GID resolution ───────────────────────── */

const GID_RE = /^gid:\/\/shopify\/([A-Za-z0-9_]+)\/([^/?\s]+)(\?.*)?$/;

// Shopify GID type name -> our MapKind. PASSTHROUGH = global ids that are valid in every store.
const KIND_BY_TYPE: Record<string, MapKind | "PASSTHROUGH"> = {
  Product: "PRODUCT", ProductVariant: "VARIANT", Collection: "COLLECTION",
  Page: "PAGE", Blog: "BLOG", Article: "ARTICLE",
  MediaImage: "FILE", Video: "FILE", ExternalVideo: "FILE", GenericFile: "FILE", Model3d: "FILE",
  Metaobject: "METAOBJECT", MetaobjectDefinition: "METAOBJECT_DEFINITION", MetafieldDefinition: "METAFIELD_DEFINITION",
  Location: "LOCATION", Menu: "MENU", Market: "MARKET", Publication: "PUBLICATION", OnlineStoreTheme: "THEME",
  TaxonomyValue: "PASSTHROUGH", TaxonomyCategory: "PASSTHROUGH", TaxonomyAttribute: "PASSTHROUGH",
};

// Kinds that do NOT exist yet while Stage 5 (products) is running. A reference to one of these that is not
// mapped yet must be DEFERRED to Stage 13's patch step, not dropped and not sent.
// PRODUCT / VARIANT are here too: products reference each other within the same stage.
const DEFER_KINDS = new Set<MapKind>(["PRODUCT", "VARIANT", "COLLECTION", "PAGE", "BLOG", "ARTICLE", "MENU"]);

export type RefResult =
  | { status: "mapped"; gid: string }
  | { status: "passthrough"; gid: string }
  | { status: "deferred"; kind: MapKind }
  | { status: "unmapped"; kind: MapKind | "UNKNOWN"; typeName: string };

/** `final` = last chance (Stage 13 patching): anything still unmapped is unmapped, never deferred again. */
export function resolveGid(gid: string, idx: RemapIndex, final = false, extraDefer: readonly MapKind[] = []): RefResult {
  const m = GID_RE.exec(gid);
  if (!m) return { status: "unmapped", kind: "UNKNOWN", typeName: "" };
  const typeName = m[1];
  const k = KIND_BY_TYPE[typeName];
  if (k === "PASSTHROUGH") return { status: "passthrough", gid };
  if (!k) return { status: "unmapped", kind: "UNKNOWN", typeName };
  const mapped = idx.gid(k, gid);
  if (mapped) return { status: "mapped", gid: mapped };
  if (!final && (DEFER_KINDS.has(k) || extraDefer.includes(k))) return { status: "deferred", kind: k };
  return { status: "unmapped", kind: k, typeName };
}

/* ───────────────────────── 3. RemapIndex ───────────────────────── */

interface FileHit { destUrl: string; destGid: string; destName: string }

/** "/s/files/1/0812/5520/3057/" for shop id 81255203057 (zero-padded, 4-digit groups). */
export function cdnPrefixFromShopGid(gid: string): string {
  const id = gid.split("/").pop() ?? "";
  const padded = id.padStart(Math.ceil(id.length / 4) * 4, "0");
  return `/s/files/1/${(padded.match(/.{1,4}/g) ?? []).join("/")}/`;
}

const SIZE_RE = /_(?:pico|icon|thumb|small|compact|medium|large|grande|original|master|\d+x\d*|x\d+)(?:_crop_(?:top|center|bottom|left|right))?(?:@\d+x)?(?=\.[A-Za-z0-9]+$)/;

/** foo_800x.jpg -> { base: "foo.jpg", suffix: "_800x" } */
export function splitSize(name: string): { base: string; suffix: string } {
  const m = SIZE_RE.exec(name);
  return m ? { base: name.replace(SIZE_RE, ""), suffix: m[0] } : { base: name, suffix: "" };
}

const safeDecode = (s: string): string => { try { return decodeURIComponent(s); } catch { return s; } };
const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Pull { folder, name } out of a Shopify file path (CDN form or store-relative /cdn/shop/ form). */
export function fileRefOfPath(pathname: string): { folder: string; name: string } | null {
  let m = /^\/s\/files\/1\/(?:\d{4}\/)+(files|products)\/(.+)$/.exec(pathname);
  if (!m) m = /^\/cdn\/shop\/(files|products)\/(.+)$/.exec(pathname);
  if (!m) return null;
  return { folder: m[1], name: safeDecode(m[2].split("/").pop() ?? m[2]) };
}

export interface RemapIndexOpts {
  originShopGid: string;
  sourceHosts: string[];   // my-source.myshopify.com, tibbeshifa.com, www.tibbeshifa.com ...
  destHosts: string[];
}

export class RemapIndex {
  readonly sourceHosts: Set<string>;
  readonly destHosts: Set<string>;
  readonly cdnPrefixes: Set<string>;
  private gids = new Map<string, string>();
  private handles = new Map<string, string>();
  private byPath = new Map<string, FileHit | null>();   // null = ambiguous
  private byName = new Map<string, FileHit | null>();
  private themes = new Map<string, string>();

  constructor(opts: RemapIndexOpts, rows: Iterable<IdRow> = []) {
    this.sourceHosts = new Set(opts.sourceHosts.map((h) => h.toLowerCase()));
    this.destHosts = new Set(opts.destHosts.map((h) => h.toLowerCase()));
    this.cdnPrefixes = new Set([cdnPrefixFromShopGid(opts.originShopGid)]);
    for (const r of rows) this.add(r);
  }

  add(r: IdRow): void {
    this.gids.set(`${r.resourceType}:${r.sourceGid}`, r.destGid);
    if (r.sourceHandle && r.destHandle) this.handles.set(`${r.resourceType}:${r.sourceHandle}`, r.destHandle);

    if (r.resourceType === "THEME") {
      const s = r.sourceGid.split("/").pop(), d = r.destGid.split("/").pop();
      if (s && d) this.themes.set(s, d);
    }
    if (r.resourceType === "FILE" && r.sourceUrl && r.destUrl) {
      let su: URL, du: URL;
      try { su = new URL(r.sourceUrl, "https://placeholder.invalid"); du = new URL(r.destUrl); } catch { return; }
      const learned = /^(\/s\/files\/1\/(?:\d{4}\/)+)/.exec(su.pathname);   // learn the real prefix from data
      if (learned) this.cdnPrefixes.add(learned[1]);
      const ref = fileRefOfPath(su.pathname);
      if (!ref) return;
      const hit: FileHit = { destUrl: r.destUrl, destGid: r.destGid, destName: safeDecode(du.pathname.split("/").pop() ?? "") };
      const pk = `${ref.folder}/${ref.name}`;
      this.byPath.set(pk, this.byPath.has(pk) ? null : hit);
      this.byName.set(ref.name, this.byName.has(ref.name) ? null : hit);
    }
  }

  gid(kind: MapKind, sourceGid: string): string | undefined { return this.gids.get(`${kind}:${sourceGid}`); }
  handle(kind: MapKind, sourceHandle: string): string | undefined { return this.handles.get(`${kind}:${sourceHandle}`); }
  theme(sourceNumericId: string): string | undefined { return this.themes.get(sourceNumericId); }
  isSourceCdnPath(pathname: string): boolean { for (const p of this.cdnPrefixes) if (pathname.startsWith(p)) return true; return false; }

  lookupFile(folder: string, name: string): { hit: FileHit; suffix: string } | null {
    const tryKeys = (n: string): FileHit | null => this.byPath.get(`${folder}/${n}`) ?? this.byName.get(n) ?? null;
    const exact = tryKeys(name);                       // exact first, so "logo_large.png" is not mis-stripped
    if (exact) return { hit: exact, suffix: "" };
    const { base, suffix } = splitSize(name);
    if (suffix) { const h = tryKeys(base); if (h) return { hit: h, suffix }; }
    return null;
  }

  mentionsSourceHost(s: string): boolean {
    const l = s.toLowerCase();
    for (const h of this.sourceHosts) if (l.includes(h)) return true;
    return false;
  }

  /** Matches anything that still points at the source store. Used by the Stage 13 crawler. */
  get leakRegex(): RegExp {
    const hosts = [...this.sourceHosts].filter((h) => !this.destHosts.has(h)).map(escapeRe);
    const prefixes = [...this.cdnPrefixes].map(escapeRe);
    return new RegExp([...prefixes, ...hosts].join("|"), "gi");
  }
}

export function buildIndex(
  rows: Iterable<IdRow>,
  sourceHost: string,
  destHost: string,
  originShopGid = "gid://shopify/Shop/1"
): RemapIndex {
  return new RemapIndex(
    {
      originShopGid,
      sourceHosts: [sourceHost],
      destHosts: [destHost],
    },
    rows
  );
}

/* ───────────────────────── 4. URL rewriting ───────────────────────── */

const PLACEHOLDER = "https://placeholder.invalid";

function buildFileUrl(hit: FileHit, suffix: string, u: URL): string {
  const d = new URL(hit.destUrl);
  if (suffix) d.pathname = d.pathname.replace(/(\.[A-Za-z0-9]+)$/, `${suffix}$1`);   // keep _800x style sizing
  for (const [k, v] of u.searchParams) if (k !== "v") d.searchParams.set(k, v);       // keep width/height/crop, drop old version
  return d.toString();
}

function remapSeg(idx: RemapIndex, kind: MapKind, seg: string): string {
  const mapped = idx.handle(kind, safeDecode(seg));
  return mapped && mapped !== safeDecode(seg) ? encodeURIComponent(mapped) : seg;   // handles can be Urdu: compare decoded
}

function rewriteLinkPath(path: string, idx: RemapIndex): string {
  const m = /^(\/[a-z]{2}(?:-[a-zA-Z0-9]{2,4})?)?\/(products|collections|pages|blogs)\/(.+)$/.exec(path);
  if (!m) return path;
  const loc = m[1] ?? "", kind = m[2];
  const seg = m[3].split("/");
  if (kind === "products") seg[0] = remapSeg(idx, "PRODUCT", seg[0]);
  else if (kind === "collections") {
    seg[0] = remapSeg(idx, "COLLECTION", seg[0]);
    if (seg[1] === "products" && seg[2] !== undefined) seg[2] = remapSeg(idx, "PRODUCT", seg[2]);
  } else if (kind === "pages") seg[0] = remapSeg(idx, "PAGE", seg[0]);
  else if (kind === "blogs") {
    const art = seg[1] !== undefined && seg[1] !== "tagged"
      ? idx.handle("ARTICLE", `${safeDecode(seg[0])}/${safeDecode(seg[1])}`) : undefined;
    if (art) { const [b, a] = art.split("/"); seg[0] = encodeURIComponent(b); seg[1] = encodeURIComponent(a); }
    else seg[0] = remapSeg(idx, "BLOG", seg[0]);
  }
  return `${loc}/${kind}/${seg.join("/")}`;
}

function rewriteShopifyScheme(s: string, idx: RemapIndex, c: Collector): string {
  const m = /^shopify:\/\/([a-z_]+)\/(.+)$/i.exec(s);
  if (!m) return s;
  const kind = m[1].toLowerCase(), rest = m[2];
  if (kind === "shop_images" || kind === "files") {
    const parts = rest.split("/");
    const found = idx.lookupFile("files", safeDecode(parts[parts.length - 1]));
    if (!found) { c.unresolvedUrls.push(s); return s; }
    c.stats.filesRewritten++;
    const dir = parts.length > 1 ? parts.slice(0, -1).join("/") + "/" : "";       // e.g. "videos/"
    return `shopify://${kind}/${dir}${found.hit.destName}`;
  }
  const k: MapKind | undefined = ({ products: "PRODUCT", collections: "COLLECTION", pages: "PAGE", blogs: "BLOG" } as Record<string, MapKind>)[kind];
  if (k && !rest.includes("/")) {
    const mapped = idx.handle(k, safeDecode(rest));
    if (mapped && mapped !== safeDecode(rest)) { c.stats.linksRewritten++; return `shopify://${kind}/${mapped}`; }
  }
  return s;
}

/**
 * Rewrite ONE url-ish string. Returns the input untouched when nothing applies.
 * Order: skip non-http -> shopify:// scheme -> files -> theme assets -> internal links.
 */
export function rewriteUrl(raw: string, idx: RemapIndex, c: Collector): string {
  const s = raw.trim();
  if (!s || /^(#|mailto:|tel:|sms:|javascript:|data:|blob:|whatsapp:)/i.test(s)) return raw;
  if (/^shopify:\/\//i.test(s)) return rewriteShopifyScheme(s, idx, c);

  let u: URL;
  try { u = new URL(s, PLACEHOLDER); } catch { return raw; }
  const host = u.host.toLowerCase();
  const cls = host === "cdn.shopify.com" ? "cdn"
    : host === "placeholder.invalid" ? "relative"
    : idx.sourceHosts.has(host) ? "source"          // checked before dest: a moved domain is in both sets
    : idx.destHosts.has(host) ? "dest" : "external";
  if (cls === "external") return raw;

  const tail = (p: string): string => `${p}${u.search}${u.hash}`;
  const emit = (p: string): string => (cls === "relative" || cls === "source" ? tail(p) : `${u.origin}${tail(p)}`);

  if (cls === "cdn" && !idx.isSourceCdnPath(u.pathname)) return raw;   // somebody else's CDN path (theme default assets etc.)

  const fr = fileRefOfPath(u.pathname);
  if (fr) {
    const found = idx.lookupFile(fr.folder, fr.name);
    if (found) { c.stats.filesRewritten++; return buildFileUrl(found.hit, found.suffix, u); }
    if (cls === "cdn" || cls === "source") c.unresolvedUrls.push(s);   // will break once the source store is gone
    return raw;
  }
  if (cls === "cdn") { c.unresolvedUrls.push(s); return raw; }          // source CDN path that is not a file (e.g. theme asset)

  const tm = /^\/cdn\/shop\/t\/(\d+)\/assets\//.exec(u.pathname);       // theme assets carry the OLD theme id
  if (tm) {
    const nd = idx.theme(tm[1]);
    if (!nd) { if (cls === "source") c.unresolvedUrls.push(s); return raw; }
    c.stats.filesRewritten++;
    return emit(u.pathname.replace(`/t/${tm[1]}/`, `/t/${nd}/`));
  }

  const np = rewriteLinkPath(u.pathname, idx);
  if (np !== u.pathname || cls === "source") { c.stats.linksRewritten++; return emit(np); }
  return raw;
}

/* ───────────────────────── 5. HTML rewriting (byte-preserving) ───────────────────────── */

export interface AttrSpan { tag: string; name: string; start: number; end: number }

/**
 * Minimal tag/attribute scanner that returns exact value offsets. It skips comments, closing tags and
 * script bodies, and reports <style> bodies separately. Enough for Shopify rich text / page bodies.
 */
export function scanHtml(html: string): { attrs: AttrSpan[]; styleBlocks: { start: number; end: number }[] } {
  const attrs: AttrSpan[] = [];
  const styleBlocks: { start: number; end: number }[] = [];
  const n = html.length;
  const ws = (ch: string | undefined): boolean => ch === " " || ch === "\n" || ch === "\t" || ch === "\r" || ch === "\f";
  let i = 0;
  while (i < n) {
    const lt = html.indexOf("<", i);
    if (lt < 0) break;
    if (html.startsWith("<!--", lt)) { const e = html.indexOf("-->", lt + 4); i = e < 0 ? n : e + 3; continue; }
    const nx = html[lt + 1];
    if (nx === "/" || nx === "!" || nx === "?") { const e = html.indexOf(">", lt + 1); i = e < 0 ? n : e + 1; continue; }
    const m = /^<([a-zA-Z][a-zA-Z0-9:-]*)/.exec(html.slice(lt, lt + 80));
    if (!m) { i = lt + 1; continue; }
    const tag = m[1].toLowerCase();
    let p = lt + m[0].length;
    for (;;) {
      while (p < n && (ws(html[p]) || html[p] === "/")) p++;
      if (p >= n) break;
      if (html[p] === ">") { p++; break; }
      const ns = p;
      while (p < n && !ws(html[p]) && html[p] !== "=" && html[p] !== ">" && html[p] !== "/") p++;
      const name = html.slice(ns, p).toLowerCase();
      if (name === "") { p++; continue; }                       // stray character: guarantee progress
      let q = p;
      while (q < n && ws(html[q])) q++;
      if (html[q] !== "=") continue;                            // boolean attribute
      p = q + 1;
      while (p < n && ws(html[p])) p++;
      let vs: number, ve: number;
      const ch = html[p];
      if (ch === '"' || ch === "'") { vs = p + 1; ve = html.indexOf(ch, vs); if (ve < 0) ve = n; p = Math.min(n, ve + 1); }
      else { vs = p; while (p < n && !ws(html[p]) && html[p] !== ">") p++; ve = p; }
      attrs.push({ tag, name, start: vs, end: ve });
    }
    if (tag === "script" || tag === "style") {
      const re = new RegExp(`</${tag}`, "gi");
      re.lastIndex = p;
      const mm = re.exec(html);
      const end = mm ? mm.index : n;
      if (tag === "style") styleBlocks.push({ start: p, end });
      i = end;
    } else i = p;
  }
  return { attrs, styleBlocks };
}

const URL_ATTRS = new Set(["src", "data-src", "data-original", "data-lazy-src", "poster", "href", "data-href", "data-background", "data-bg"]);
const SRCSET_ATTRS = new Set(["srcset", "data-srcset"]);

const decodeAttr = (v: string): string => v.replace(/&amp;/g, "&");
const encodeAttr = (v: string): string => v.replace(/&/g, "&amp;");

export function rewriteSrcset(val: string, f: (u: string) => string): string {
  let out = "", i = 0;
  const n = val.length;
  while (i < n) {
    let j = i;
    while (j < n && (/\s/.test(val[j]) || val[j] === ",")) j++;
    out += val.slice(i, j); i = j;
    if (i >= n) break;
    let k = i;
    while (k < n && !/\s/.test(val[k])) k++;
    let url = val.slice(i, k), trailing = "";
    const tc = /,+$/.exec(url);
    if (tc) { trailing = tc[0]; url = url.slice(0, -trailing.length); }
    out += f(url) + trailing; i = k;
    if (tc) continue;                                           // candidate had no descriptor
    let d = i;
    while (d < n && val[d] !== ",") d++;
    out += val.slice(i, d); i = d;
  }
  return out;
}

export function rewriteCssUrls(css: string, f: (u: string) => string): string {
  return css.replace(/url\(\s*(['"]?)([^'")]+)\1\s*\)/gi, (_m, q: string, u: string) => `url(${q}${f(u)}${q})`);
}

interface Edit { start: number; end: number; text: string }

function applyEdits(src: string, edits: Edit[]): string {
  let out = src;
  for (const e of edits.sort((a, b) => b.start - a.start)) out = out.slice(0, e.start) + e.text + out.slice(e.end);
  return out;
}

/** Rewrite every URL-bearing attribute, srcset, inline style and <style> block in an HTML fragment. */
export function rewriteHtml(html: string | null | undefined, idx: RemapIndex, c: Collector): string {
  if (!html) return html ?? "";
  const f = (u: string): string => rewriteUrl(u, idx, c);
  const viaAttr = (raw: string, fn: (decoded: string) => string): string => {
    const dec = decodeAttr(raw);
    const res = fn(dec);
    return res === dec ? raw : encodeAttr(res);                // untouched values stay byte-identical
  };
  const { attrs, styleBlocks } = scanHtml(html);
  const edits: Edit[] = [];
  for (const a of attrs) {
    const raw = html.slice(a.start, a.end);
    let out = raw;
    if (URL_ATTRS.has(a.name)) out = viaAttr(raw, f);
    else if (SRCSET_ATTRS.has(a.name)) out = viaAttr(raw, (v) => rewriteSrcset(v, f));
    else if (a.name === "style") out = viaAttr(raw, (v) => rewriteCssUrls(v, f));
    if (out !== raw) edits.push({ start: a.start, end: a.end, text: out });
  }
  for (const b of styleBlocks) {
    const raw = html.slice(b.start, b.end), out = rewriteCssUrls(raw, f);
    if (out !== raw) edits.push({ start: b.start, end: b.end, text: out });
  }
  return edits.length ? applyEdits(html, edits) : html;
}

/* ───────────────────────── 6. JSON / text rewriting ───────────────────────── */

/** URLs embedded in plain text (multi-line text metafields, JSON strings). Only touches source-store URLs. */
export function rewriteUrlsInText(s: string, idx: RemapIndex, c: Collector): string {
  // shopify:// must be matched FIRST: its "//" would otherwise be eaten as a protocol-relative URL and skipped.
  // Theme {% schema %} blocks and settings carry these (shopify://shop_images/..., shopify://files/videos/...).
  return s.replace(/shopify:\/\/[^\s"'<>)\]]+|(?:https?:)?\/\/[^\s"'<>)\]]+/gi, (m) => rewriteUrl(m, idx, c));
}

export function rewriteStringSmart(s: string, idx: RemapIndex, c: Collector): string {
  if (GID_RE.test(s)) {
    const r = resolveGid(s, idx, true);
    if (r.status === "mapped") { c.stats.gidsRewritten++; return r.gid; }
    if (r.status === "unmapped") c.warnings.push({ code: "UNMAPPED_GID_IN_JSON", detail: s });
    return s;
  }
  if (/^shopify:\/\//i.test(s) || /^(https?:)?\/\/\S+$/i.test(s) || /^\/(?!\/)\S*$/.test(s)) return rewriteUrl(s, idx, c);
  if (s.includes("<") && s.includes(">")) return rewriteHtml(s, idx, c);   // theme richtext settings are HTML strings
  if (s.includes("cdn.shopify.com") || idx.mentionsSourceHost(s)) return rewriteUrlsInText(s, idx, c);
  return s;
}

/** Deep rewrite for `json` metafields and theme settings_data / template JSON (Stage 11 reuses this). */
export function rewriteJsonDeep(v: unknown, idx: RemapIndex, c: Collector): unknown {
  if (typeof v === "string") return rewriteStringSmart(v, idx, c);
  if (Array.isArray(v)) return v.map((x) => rewriteJsonDeep(x, idx, c));
  if (v && typeof v === "object") {
    const o: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v as Record<string, unknown>)) o[k] = rewriteJsonDeep(x, idx, c);
    return o;
  }
  return v;
}

function rewriteJsonString(value: string, idx: RemapIndex, c: Collector, code: string): string {
  let doc: unknown;
  try { doc = JSON.parse(value); } catch { c.warnings.push({ code, detail: "value is not valid JSON, left as is" }); return value; }
  const out = JSON.stringify(rewriteJsonDeep(doc, idx, c));
  return out === JSON.stringify(doc) ? value : out;
}

function rewriteRichText(value: string, idx: RemapIndex, c: Collector): string {
  let doc: unknown;
  try { doc = JSON.parse(value); } catch { c.warnings.push({ code: "RICH_TEXT_PARSE", detail: "invalid JSON, left as is" }); return value; }
  const before = JSON.stringify(doc);
  const walk = (n: unknown): void => {
    if (Array.isArray(n)) { n.forEach(walk); return; }
    if (!n || typeof n !== "object") return;
    const o = n as Record<string, unknown>;
    if (typeof o.url === "string") o.url = rewriteUrl(o.url, idx, c);
    for (const k of Object.keys(o)) if (k !== "url") walk(o[k]);
  };
  walk(doc);
  const after = JSON.stringify(doc);
  return after === before ? value : after;
}

/* ───────────────────────── 7. Metafields ───────────────────────── */

export interface SrcMetafield { namespace: string; key: string; type: string; value: string }
export interface OutMetafield { namespace: string; key: string; type: string; value: string }

export type MfOutcome =
  | { kind: "set"; mf: OutMetafield }
  | { kind: "deferred"; mf: SrcMetafield; waitingOn: MapKind[] }
  | { kind: "dropped"; code: string; detail: string };

/** Namespaces we cannot write on a destination store (reserved, or owned by another app). */
export const isReservedNamespace = (ns: string): boolean => ns.startsWith("shopify--") || ns.startsWith("app--") || ns.startsWith("$app");

const REF_BASE: Record<string, MapKind | "MIXED"> = {
  file_reference: "FILE", product_reference: "PRODUCT", variant_reference: "VARIANT",
  collection_reference: "COLLECTION", page_reference: "PAGE", metaobject_reference: "METAOBJECT", mixed_reference: "MIXED",
};

export function remapMetafield(mf: SrcMetafield, idx: RemapIndex, c: Collector, opts: { final?: boolean; extraDefer?: readonly MapKind[] } = {}): MfOutcome {
  const id = `${mf.namespace}.${mf.key}`;
  if (isReservedNamespace(mf.namespace)) return { kind: "dropped", code: "RESERVED_NAMESPACE", detail: id };

  const isList = mf.type.startsWith("list.");
  const base = isList ? mf.type.slice(5) : mf.type;
  const set = (value: string): MfOutcome => ({ kind: "set", mf: { namespace: mf.namespace, key: mf.key, type: mf.type, value } });

  if (base in REF_BASE) {
    let gids: string[];
    try { gids = isList ? (JSON.parse(mf.value) as string[]) : [mf.value]; } catch { return { kind: "dropped", code: "BAD_REFERENCE_VALUE", detail: id }; }
    const out: string[] = [], waiting = new Set<MapKind>();
    for (const g of gids) {
      const r = resolveGid(g, idx, opts.final, opts.extraDefer);
      if (r.status === "mapped") { out.push(r.gid); c.stats.gidsRewritten++; }
      else if (r.status === "passthrough") out.push(r.gid);
      else if (r.status === "deferred") waiting.add(r.kind);
      else {
        // Standard taxonomy attribute values (shopify--* metaobjects) cannot be created via API; Shopify provisions
        // them when the merchant re-selects the attribute in admin. Reported as its own code so the checklist can say so.
        const std = mf.namespace === "shopify" && r.kind === "METAOBJECT";
        c.warnings.push({ code: std ? "STANDARD_TAXONOMY_REFERENCE" : "UNMAPPED_REFERENCE", detail: `${id} -> ${g}` });
      }
    }
    if (waiting.size) return { kind: "deferred", mf, waitingOn: [...waiting] };    // whole metafield waits, so partial lists never get written
    if (!out.length) return { kind: "dropped", code: "NO_RESOLVABLE_REFERENCE", detail: id };
    return set(isList ? JSON.stringify(out) : out[0]);
  }

  switch (base) {
    case "customer_reference": case "company_reference":
      return { kind: "dropped", code: "UNSUPPORTED_TYPE_V1", detail: `${id} (${mf.type})` };
    case "rich_text_field": return set(rewriteRichText(mf.value, idx, c));
    case "json": return set(rewriteJsonString(mf.value, idx, c, "JSON_METAFIELD_PARSE"));
    case "link": return set(rewriteJsonString(mf.value, idx, c, "LINK_METAFIELD_PARSE"));
    case "url": return set(rewriteUrl(mf.value, idx, c));
    case "multi_line_text_field": case "single_line_text_field": return set(rewriteUrlsInText(mf.value, idx, c));
    default: return set(mf.value);          // numbers, dates, colors, ratings, dimensions, taxonomy value refs (global ids) ...
  }
}

/* ───────────────────────── 8. productSet ───────────────────────── */

export interface SrcProduct {
  id: string; handle: string; title: string; descriptionHtml: string | null;
  vendor: string | null; productType: string | null; status: "ACTIVE" | "DRAFT" | "ARCHIVED";
  tags: string[]; templateSuffix: string | null; isGiftCard?: boolean; requiresSellingPlan?: boolean;
  category: { id: string } | null;                                   // standard taxonomy category: a GLOBAL id
  seo: { title: string | null; description: string | null } | null;
  options: { name: string; position: number; linkedMetafield?: { namespace: string; key: string } | null; optionValues: { name: string }[] }[];
  media: { id: string; mediaContentType: string; alt: string | null; imageUrl?: string | null; originalSourceUrl?: string | null; embedUrl?: string | null }[];
  variants: SrcVariant[];
  metafields: SrcMetafield[];
}
export interface SrcVariant {
  id: string; sku: string | null; barcode: string | null; price: string; compareAtPrice: string | null;
  taxable: boolean; inventoryPolicy: "DENY" | "CONTINUE"; position: number;
  selectedOptions: { name: string; value: string }[];
  mediaId?: string | null;                                           // from ProductVariant.media(first: 1), a MediaImage id
  inventoryItem: {
    tracked: boolean; requiresShipping: boolean; unitCostAmount?: string | null;
    weight?: { unit: "GRAMS" | "KILOGRAMS" | "OUNCES" | "POUNDS"; value: number } | null;
    countryCodeOfOrigin?: string | null; harmonizedSystemCode?: string | null;
  };
  metafields: SrcMetafield[];
}

export interface FileSetInput { id?: string; originalSource?: string; contentType?: "IMAGE" | "VIDEO" | "EXTERNAL_VIDEO" | "MODEL_3D" | "FILE"; alt?: string }
export interface ProductSetInput {
  title: string; handle: string; descriptionHtml: string; vendor?: string; productType?: string;
  status: string; tags: string[]; templateSuffix?: string; category?: string;
  seo?: { title?: string; description?: string };
  productOptions: { name: string; position: number; values: { name: string }[] }[];
  files: FileSetInput[];
  variants: Record<string, unknown>[];
  metafields: OutMetafield[];
}

export interface DeferredRef {
  ownerKind: "PRODUCT" | "VARIANT" | "METAOBJECT"; ownerSourceGid: string;
  namespace: string; key: string; type: string; sourceValue: string; waitingOn: MapKind[];
}

export interface RemapPolicy { handleSuffix?: string }
export interface RemapCtx { idx: RemapIndex; c: Collector; policy?: RemapPolicy }

export interface ProductSetPlan {
  input: ProductSetInput;
  synchronous: boolean;            // pass to productSet(synchronous:). Large products should use the async operation path
  deferred: DeferredRef[];         // persist as DeferredPatch rows; Stage 13 applies them
  c: Collector;                    // warnings + unresolved URLs -> one ItemFailure(code "WARN") per product
}

export class RemapError extends Error {
  code: string;
  constructor(code: string, message: string) { super(message); this.code = code; }
}

const MAX_VARIANTS = 2048;

export function toProductSetInput(rc: RemapCtx, src: SrcProduct): ProductSetPlan {
  const { idx, c } = rc;
  if (src.isGiftCard) throw new RemapError("GIFT_CARD_PRODUCT", "gift card products are not cloned in v1");
  if (src.variants.length > MAX_VARIANTS) throw new RemapError("VARIANT_LIMIT", `${src.variants.length} variants exceeds ${MAX_VARIANTS}`);
  if (src.requiresSellingPlan) c.warnings.push({ code: "SELLING_PLANS_NOT_CLONED", detail: "subscription selling plans are app-bound; product cloned as one-time purchase" });

  // Options. Taxonomy-linked options reference store-specific shopify-- metaobjects that cannot be created by API,
  // so they are flattened to plain options. Names and values are preserved, only the taxonomy link is lost.
  const productOptions = [...src.options].sort((a, b) => a.position - b.position).map((o, i) => {
    if (o.linkedMetafield) c.warnings.push({ code: "LINKED_OPTION_FLATTENED", detail: `${o.name} (${o.linkedMetafield.namespace}.${o.linkedMetafield.key})` });
    return { name: o.name, position: i + 1, values: o.optionValues.map((v) => ({ name: v.name })) };
  });

  // Files. Stage 2 already created every file (product media included) and recorded its dest GID, so attach by id.
  // That avoids duplicate uploads and keeps the URL map used by the HTML rewriter authoritative.
  const files: FileSetInput[] = [];
  const destFileBySrc = new Map<string, string>();
  for (const m of src.media) {
    const destGid = idx.gid("FILE", m.id);
    if (destGid) { files.push({ id: destGid }); destFileBySrc.set(m.id, destGid); continue; }
    if (m.mediaContentType === "EXTERNAL_VIDEO" && m.embedUrl) files.push({ originalSource: m.embedUrl, contentType: "EXTERNAL_VIDEO", alt: m.alt ?? undefined });
    else if (m.mediaContentType === "IMAGE" && (m.originalSourceUrl ?? m.imageUrl)) files.push({ originalSource: (m.originalSourceUrl ?? m.imageUrl) as string, contentType: "IMAGE", alt: m.alt ?? undefined });
    else { c.warnings.push({ code: "MEDIA_SKIPPED", detail: `${m.id} (${m.mediaContentType})` }); continue; }
    c.warnings.push({ code: "MEDIA_NOT_PREMAPPED", detail: `${m.id} was not created in Stage 2; falling back to URL upload` });
  }

  const deferred: DeferredRef[] = [];
  const mapMetafields = (list: SrcMetafield[], ownerKind: "PRODUCT" | "VARIANT", ownerSourceGid: string): OutMetafield[] => {
    const out: OutMetafield[] = [];
    for (const mf of list) {
      const r = remapMetafield(mf, idx, c);
      if (r.kind === "set") out.push(r.mf);
      else if (r.kind === "deferred") deferred.push({ ownerKind, ownerSourceGid, namespace: mf.namespace, key: mf.key, type: mf.type, sourceValue: mf.value, waitingOn: r.waitingOn });
      else c.warnings.push({ code: r.code, detail: r.detail });
    }
    return out;
  };

  const variants = [...src.variants].sort((a, b) => a.position - b.position).map((v, i) => {
    const item: Record<string, unknown> = { tracked: v.inventoryItem.tracked, requiresShipping: v.inventoryItem.requiresShipping };
    if (v.inventoryItem.unitCostAmount) item.cost = v.inventoryItem.unitCostAmount;
    if (v.inventoryItem.weight) item.measurement = { weight: { value: v.inventoryItem.weight.value, unit: v.inventoryItem.weight.unit } };
    if (v.inventoryItem.countryCodeOfOrigin) item.countryCodeOfOrigin = v.inventoryItem.countryCodeOfOrigin;
    if (v.inventoryItem.harmonizedSystemCode) item.harmonizedSystemCode = v.inventoryItem.harmonizedSystemCode;

    const out: Record<string, unknown> = {
      position: i + 1,
      optionValues: v.selectedOptions.map((o) => ({ optionName: o.name, name: o.value })),
      price: v.price, taxable: v.taxable, inventoryPolicy: v.inventoryPolicy, inventoryItem: item,
      // NOTE: no inventoryQuantities here. Quantities are Stage 6 (needs the Stage 1 location map).
    };
    if (v.sku) out.sku = v.sku;
    if (v.barcode) out.barcode = v.barcode;
    if (v.compareAtPrice) out.compareAtPrice = v.compareAtPrice;
    const vf = v.mediaId ? destFileBySrc.get(v.mediaId) : undefined;
    if (vf) out.file = { id: vf };
    const vm = mapMetafields(v.metafields, "VARIANT", v.id);
    if (vm.length) out.metafields = vm;
    return out;
  });

  const seoTitle = src.seo?.title || undefined, seoDesc = src.seo?.description || undefined;
  const input: ProductSetInput = {
    title: src.title,
    handle: src.handle + (rc.policy?.handleSuffix ?? ""),
    descriptionHtml: rewriteHtml(src.descriptionHtml, idx, c),
    vendor: src.vendor || undefined,
    productType: src.productType || undefined,
    status: src.status,
    tags: src.tags,
    templateSuffix: src.templateSuffix || undefined,      // the 404 fix: custom template suffixes (newmedda, newqabz ...) survive
    category: src.category?.id,                           // global taxonomy GID, valid on every store, no remap
    seo: seoTitle || seoDesc ? { title: seoTitle, description: seoDesc } : undefined,
    productOptions, files, variants,
    metafields: mapMetafields(src.metafields, "PRODUCT", src.id),
  };

  return { input, synchronous: variants.length <= 100 && files.length <= 30, deferred, c };
}

/* ───────────────────────── 9. Variant mapping after productSet ───────────────────────── */

export const variantKey = (opts: { name: string; value: string }[]): string =>
  opts.map((o) => `${o.name}=${o.value}`).join("|").toLowerCase();

export interface DestVariantNode { id: string; selectedOptions: { name: string; value: string }[]; inventoryItem: { id: string } }
export interface VariantMapping { sourceGid: string; destGid: string; destInventoryItemGid: string; sourceInventoryItemGid?: string }

/** Pair source and destination variants by option values. Persist as IdMap(VARIANT) rows; Stage 6 needs them. */
export function mapDestVariants(src: SrcProduct, dest: DestVariantNode[]): { mapped: VariantMapping[]; unmatched: string[] } {
  const byKey = new Map(dest.map((d) => [variantKey(d.selectedOptions), d]));
  const mapped: VariantMapping[] = [], unmatched: string[] = [];
  for (const v of src.variants) {
    const d = byKey.get(variantKey(v.selectedOptions));
    if (d) mapped.push({ sourceGid: v.id, destGid: d.id, destInventoryItemGid: d.inventoryItem.id });
    else unmatched.push(v.id);
  }
  return { mapped, unmatched };
}
