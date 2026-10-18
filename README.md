# Clonix — Zero-404 Shopify Store Cloner & Automated Vault 🚀

[![CI / Tests](https://img.shields.io/badge/tests-115%20passing-008060.svg?style=flat-square)](https://github.com/abidalidevv/Shopify-Cloner)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.6-blue.svg?style=flat-square)](https://www.typescriptlang.org/)
[![Vite](https://img.shields.io/badge/Vite-5.4-purple.svg?style=flat-square)](https://vitejs.dev/)
[![Shopify API](https://img.shields.io/badge/Shopify%20Admin%20API-2025--01-green.svg?style=flat-square)](https://shopify.dev/docs/api/admin-graphql)
[![Pricing](https://img.shields.io/badge/Pricing-%240%20%7C%20%249%20%7C%20%2449-D4FF00.svg?style=flat-square)](https://github.com/abidalidevv/Shopify-Cloner)

**Clonix** is a high-fidelity Shopify store cloning and automated vault Micro-SaaS. Designed to duplicate full store ecosystems—including catalog taxonomy, custom theme templates (`templateSuffix`), inventory tracking, metaobjects, and offline backup vaults—with zero manual re-entry and zero broken URLs.

---

## ⚡ The Core Problem Clonix Solves

Conventional Shopify migration apps (like standard CSV exporters or generic duplicators) fail on production themes:
1. **Broken Custom Templates (404 Fallback):** Custom product/page JSON templates (e.g. `product.newmedda.json`, `product.newqabz.json`) are ignored. The destination falls back to generic layouts or 404s.
2. **Leaked CDN Image References:** Images remain hotlinked to the old store's CDN (`cdn.shopify.com/.../ph0igg-jv/...`). When the old store closes, all product imagery breaks.
3. **Broken Taxonomy & Metaobjects:** Standard category definitions and circular metaobject entries fail to stitch.
4. **Untracked Inventory:** Imported variants default to `tracked: false` with zero warehouse allocation.

**Clonix** resolves all four using a **14-Stage Directed Acyclic Graph (DAG)** execution engine with topological barrier synchronization.

---

## 📦 Architecture Overview

```
┌────────────────────────────────┐            ┌────────────────────────────────┐
│   Source Store (Origin Vault)  │            │  Destination Store (Target)   │
│   e.g. ph0igg-jv.myshopify.com │            │  e.g. clone.myshopify.com      │
└───────────────┬────────────────┘            └───────────────▲────────────────┘
                │                                             │
                │ Read-Only Scopes                            │ Idempotent Write Mutations
                ▼                                             │
  ┌───────────────────────────────────────────────────────────┴────────────────┐
  │                         CLONIX SAAS ENGINE (DAG Barrier)                   │
  │                                                                            │
  │  Stage 0: Preflight Probe & Template Extractor (Locales, Currencies)       │
  │  Stage 1: Primary Location & Warehouse Mapping                             │
  │  Stage 2: Hybrid Media Ingestion (URL Pull + Staged Upload Fallback)       │
  │  Stage 3: Metafield Definitions & Metaobject Schema Sync                   │
  │  Stage 4: Metaobject Entries (Pass 1 Stubs + Pass 2 Foreign Key Stitch)    │
  │  Stage 5: Products & Variants (Urdu UTF-8, Compare-At, SKUs)               │
  │  Stage 6: Inventory Level Tracking (Tracked: True across Locations)        │
  │  Stage 7: Smart & Automated Collections (Rules & Sort Orders)              │
  │  Stage 8: Pages & Legal Policies (Terms, Privacy, Refund)                  │
  │  Stage 9: Menus & Navigation Hierarchy (Multi-level handles)               │
  │  Stage 10: Pricing Structures & Multi-Currency Catalogs                    │
  │  Stage 11: Theme & Liquid Schemas ({% schema %} Asset Remap)               │
  │  Stage 12: URL Redirects & Legacy Route Preservation                       │
  │  Stage 13: Live Storefront Verification (Verified Zero-404 Crawl)          │
  └────────────────────────────────────────────────────────────────────────────┘
```

---

## 💳 Commercial Monetization Model

Clonix offers a merchant-friendly freemium-to-paid pricing architecture:

| Tier | Price | Model | Entitlements & Features |
| :--- | :--- | :--- | :--- |
| **Freemium Audit** | **$0** | Free Forever | Store Parity & Health Audit, up to 12 products & 1 collection, active theme Liquid copy, flags broken template suffixes. |
| **Single Clone Pass** | **$9** | One-Time Pass | 1-time full store cloning, unlimited products & collections, zero-leak CDN remapping, custom template preservation. **Charged exclusively to Destination Store ($0 for Source)**. |
| **Unlimited Pro** | **$49 / mo** | Recurring Monthly | Unlimited store duplications every month, automated daily vault backups, master agency pairing token (zero repeated consent friction), white-label PDF audit reports. **Essential for dev-store workflows**. |

---

## 🔑 2-Sided Consent Handshake (Crockford Base32)

To securely bridge two independent Shopify stores without exposing permanent API keys:
1. **Source Merchant** generates an 8-character Crockford Base32 token (e.g. `7K9M-2PX4`) with a strict **15-minute Time-To-Live (TTL)**.
2. Generating a new token automatically invalidates previous pending tokens for that source shop.
3. The raw token is displayed once and hashed in storage using **HMAC-SHA256**.
4. Input codes normalize `O -> 0` and `I/L -> 1` to eliminate human transcription errors.
5. **Destination Merchant** claims the token inside their Clonix app.
6. **Source Merchant** approves requested scopes; self-pairing (`source == dest`) is strictly blocked.

---

## 🛡️ Trust & Honest Scope Disclosure

To maintain 100% merchant transparency and eliminate App Store review friction:
- **What is Cloned:** Full catalog (products, variants, inventory counts), collections, media files (rewritten to destination CDN), custom theme templates (`*.json`, `*.liquid`), metaobjects, pages, blogs, and menus.
- **What is Excluded by Security Design:** Payment gateway private credentials, checkout API keys, customer passwords, tax agency credentials, and third-party app access tokens.

---

## ⚠️ Real-World Bottlenecks & Mitigation Strategies

| Bottleneck | Shopify Limitation | Clonix Engine Mitigation |
| :--- | :--- | :--- |
| **GraphQL Rate Limits (Bucket Throttling)** | Standard apps receive **50 points/sec** (burst 1000). Mutations (e.g. `productCreate`) cost 10–25 points. | Implements a **shared PostgreSQL leaky-bucket rate limiter** (`ShopThrottle`) that auto-reconciles from `extensions.cost.throttleStatus`. |
| **Media Bandwidth & Upload Limits** | Downloading 5,000 images to the app server and re-uploading consumes 10GB+ bandwidth. | Implements **Hybrid Media Ingestion**: uses `fileCreate` with `originalSource` (Shopify CDN pulls directly) by default; falls back to staged uploads only if the source CDN blocks direct fetches. |
| **Circular Metaobject References** | Metaobject A references B, and B references A; single-pass creation fails with `MISSING_REFERENCE`. | Solved via **Two-Pass Ingestion + Late Deferral**: Pass 1 creates shell entries; Pass 2 stitches cross-references; references to products/pages not yet created are deferred to Stage 13. |
| **Memory Leaks on Massive Backups** | Loading 20,000 products into a single JavaScript object causes V8 heap OOM crashes. | Streams records as **JSON Lines (JSONL)** directly to disk / R2. Memory only retains an in-memory dictionary of ID translations (`Map<OldGid, NewGid>`), requiring < 15MB RAM for 50,000 items. |

---

## 🛠️ Project Structure

```
├── clonix-app/               # React 18 + Vite Frontend Application
│   ├── src/
│   │   ├── components/       # Header, RoleSelector, OrbitalSyncCanvas, PairingWorkspace, DAGTracker
│   │   ├── hooks/            # usePairingSession, useMigrationProgress
│   │   └── types/            # TypeScript interfaces
│   └── package.json
├── clonix-preview/           # Standalone zero-dependency HTML/CSS prototype
│   └── index.html
├── clonix-landing/           # High-converting Clonify-style SaaS Landing Page
│   └── index.html
├── tibbeshifa-migrator/      # Core Backend Engine & CLI
│   ├── src/                  # Shopify API clients, DAG runners, backup/restore logic
│   ├── saas/                 # Clonix Micro-SaaS Server & REST API
│   │   ├── api.ts            # Pairing, DAG progress, parity scorecard handlers
│   │   ├── extractor.ts      # Stage 0 preflight probe & template discovery
│   │   ├── scheduler.ts      # 14-stage DAG barrier execution on pg-boss + Prisma
│   │   ├── executors.ts      # Real item executors (file, metaobject, product, theme, etc.)
│   │   ├── shopify-client.ts # Rate-limited Admin GraphQL client with auto-refresh
│   │   ├── crypto.ts         # AES-256-GCM envelope encryption
│   │   ├── server.ts         # Production HTTP server (port 3000)
│   │   ├── constants.ts      # Tier limits ($0 / $9 / $49)
│   │   └── __tests__/        # Vitest suite (17 test files, 115 tests passing)
│   └── package.json
└── CLONIX_DESIGN_SYSTEM.md   # Design tokens & typography guide
```

---

## 🧪 Running Tests & Local Server

### 1. Run Complete Test Suite
```bash
cd tibbeshifa-migrator
npm test
```
*Executes all 17 test files (115 unit & integration tests) covering auth, rate-limiting, DAG execution, pairing tokens, Stage 0 extractor, and HTTP server endpoints.*

### 2. Start the Production Clonix SaaS Server
```bash
cd tibbeshifa-migrator
npx tsx saas/server.ts
```
*Launches HTTP server on `http://localhost:3000` exposing REST endpoints and serving the frontend application.*

### 3. Run Frontend Development Server
```bash
cd clonix-app
npm run dev
```

---

## 📄 License
Private & Proprietary. Built for high-volume Shopify merchants and agencies.
