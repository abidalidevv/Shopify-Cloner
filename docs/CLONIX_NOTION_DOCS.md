# 📑 Clonix — Complete Micro-SaaS Knowledge Base & Technical Blueprint

> 🌟 **Clonix Mission:** Duplicate any production Shopify store with **zero data loss**, **zero 404 URL errors**, and **100% custom template suffix preservation** (`newmedda`, `newqabz`) in under 4 minutes.

---

## 🧭 Navigation Index
- [1. 📦 Product Overview & Philosophy](#1--product-overview--philosophy)
- [2. 🎨 Design Aesthetics & UI System](#2--design-aesthetics--ui-system)
- [3. 🔑 Two-Sided Consent Handshake (Crockford Base32)](#3--two-sided-consent-handshake-crockford-base32)
- [4. ⚡ 14-Stage DAG Barrier Execution Pipeline](#4--14-stage-dag-barrier-execution-pipeline)
- [5. 📊 Zero-404 Parity Scorecard Audit](#5--zero-404-parity-scorecard-audit)
- [6. 💳 Commercial Monetization Architecture ($0 / $9 / $49)](#6--commercial-monetization-architecture-0--9--49)
- [7. ⚠️ Technical Bottlenecks & Production Mitigation](#7--technical-bottlenecks--production-mitigation)
- [8. 🔌 REST API Reference & Endpoints](#8--rest-api-reference--endpoints)
- [9. 🧪 Verification & Automated Test Suite](#9--verification--automated-test-suite)

---

## 1. 📦 Product Overview & Philosophy

> 💡 **The Problem:** Conventional Shopify migration tools (Matrixify, generic CSV exporters) only migrate raw catalog rows. When merchants open their newly cloned store:
> - Custom page and product JSON templates return **404 Not Found**.
> - Product imagery is hotlinked to the old store; when the old store is decommissioned, all images go dark.
> - Inventory defaults to `tracked: false` with zero warehouse allocation.
> - Urdu/Arabic descriptions suffer character corruption.

**Clonix** is engineered as a **Turnkey Micro-SaaS** that synchronizes catalog data, Liquid theme templates, media assets, and Shopify metaobjects in strict lockstep.

```
       [ SOURCE STORE (VAULT) ]             [ DESTINATION STORE (TARGET) ]
       e.g. ph0igg-jv.myshopify.com         e.g. clone.myshopify.com
                  │                                     │
                  │   1. Generates 8-char Token         │
                  │   (7K9M-2PX4 / 15m TTL)             │
                  ├────────────────────────────────────►│ 2. Claims Token
                  │                                     │
                  │   3. Confirms Merchant Consent      │
                  │◄────────────────────────────────────┤
                  │                                     │
                  ▼                                     ▼
           ===================================================
                   14-STAGE BARRIER SYNCHRONIZER (DAG)
           ===================================================
                  │                                     │
                  ▼                                     ▼
           [ 100% Parity ]                       [ Zero 404s ]
```

---

## 2. 🎨 Design Aesthetics & UI System

Clonix strictly embodies the high-contrast aesthetic of **`https://www.clonify.com/en`** combined with Shopify Polaris native ergonomics.

### 🎨 Color Palette Tokens
| Token Name | Hex Code | Purpose & Usage |
| :--- | :--- | :--- |
| **Deep Obsidian** | `#0A0A0C` | App background, top navbar |
| **Card Surface** | `#141418` | Elevated card backgrounds, workspace containers |
| **Hairline Border** | `#23232A` | Crisp 1px card separators and boundaries |
| **Electric Neon Lime**| `#D4FF00` | Primary buttons, active pulse dots, completion badges |
| **Polaris Emerald** | `#008060` | Native Shopify trust markers, verified status pills |
| **Pastel Lavender** | `#E0E7FF` | Preflight & Metaobject stage pills |
| **Pastel Sky** | `#E0F2FE` | Staged upload CDN media ingestion pills |
| **Pastel Amber** | `#FEF3C7` | Active barrier warning alerts |

### 🔤 Typography Standards
- **Headlines:** `Archivo`, 700/900 weight, `-0.02em` tracking.
- **Body & Tables:** `Geist` / Inter, crisp 13px/14px high-legibility layout.
- **Pairing Tokens:** `JetBrains Mono`, `0.12em` letter spacing, uppercase.
- **High-Impact Metrics:** `Anton`, bold metric counters (`99.8%`, `523 CDN ASSETS`).

---

## 3. 🔑 Two-Sided Consent Handshake (Crockford Base32)

> 🛡️ **Zero API Key Exposure:** Merchants never share private Shopify admin access tokens. Everything flows through temporary, cryptographically isolated Crockford tokens.

```
Step 1: Source Store generates: 7K9M-2PX4 (Alphabet: 0-9, A-Z excluding I, L, O, U)
Step 2: Token stored as HMAC-SHA256 hash with 15-minute expiration.
Step 3: Destination Store enters token to claim pairing.
Step 4: Source Store reviews requested scopes (products, themes, metafields) and approves.
Step 5: Handshake establishes an ephemeral mutual sync channel.
```

---

## 4. ⚡ 14-Stage DAG Barrier Execution Pipeline

Clonix executes migrations in a topological sequence. A subsequent stage **never starts** until all dependencies in the previous stage achieve barrier completion:

```
Stage 0: Preflight Probe & Scope Verification
   │
Stage 1: Primary Location & Warehouse Mapping
   │
Stage 2: Staged Upload Media Ingestion (Destination CDN Remap)
   │
Stage 3: Metafield Definitions & Metaobject Schema Sync
   │
Stage 4: Metaobject Entries (Pass 2 Circular Foreign-Key Stitching)
   │
Stage 5: Products & Variants (Urdu UTF-8, Prices, Weights, SKUs)
   │
Stage 6: Inventory Level Tracking (Tracked: True across Locations)
   │
Stage 7: Smart & Automated Collections (Rules, Sort Order)
   │
Stage 8: Pages, Blogs & Legal Policies (Terms, Privacy, Refund)
   │
Stage 9: Navigation Menus (Header & Footer Hierarchies)
   │
Stage 10: Multi-Currency Catalogs & Price Lists
   │
Stage 11: Theme & Liquid Schemas ({% schema %} Asset Remap)
   │
Stage 12: URL Redirects & Legacy Route Preservation
   │
Stage 13: Live Storefront Verification (HTTP 200 Crawl)
```

---

## 5. 📊 Zero-404 Parity Scorecard Audit

Before declaring a run complete, Clonix performs automated store parity verification:

| Asset / Resource | Source Store (`ph0igg-jv`) | Destination Store (`clone`) | Parity Status | Verification Detail |
| :--- | :--- | :--- | :--- | :--- |
| **Urdu Titles & RTL** | `معجون مقوی خاص (نئی پیکنگ)` | `معجون مقوی خاص (نئی پیکنگ)` | 🟢 **MATCH** | 100% UTF-8 byte-for-byte fidelity |
| **Template Suffixes** | `newmedda`, `newqabz` | `newmedda`, `newqabz` | 🟢 **PRESERVED** | Zero fallback crashes on custom layouts |
| **Inventory Tracking** | `97, 98, 99 In Stock` | `Tracked: True` | 🟢 **SYNCED** | Quantity matches exact warehouse levels |
| **Zero-Leak CDN Images** | `523 Media Files` | `0 Leaks Found` | 🟢 **ZERO_LEAK** | All image URLs rewritten to destination CDN |
| **Metaobject Taxonomy** | `12 Definitions` | `12 Linked` | 🟢 **MATCH** | Circular cross-references stitched |
| **Pages & Policies** | `11 Pages` | `11 Created` | 🟢 **MATCH** | Refund, Privacy, Terms policies active |

---

## 6. 💳 Commercial Monetization Architecture ($0 / $9 / $49)

> 💡 **Why this model wins:** Most apps charge recurring $29–$79/mo even for merchants who only need to migrate once. Clonix provides an affordable **$9 Single Clone Pass** charged exclusively to the Destination store.

### Plan Breakdown
```
┌─────────────────────────┐   ┌─────────────────────────┐   ┌─────────────────────────┐
│     FREEMIUM AUDIT      │   │    SINGLE CLONE PASS    │   │      UNLIMITED PRO      │
│          $0             │   │       $9 (One-Time)     │   │       $49 / Month       │
├─────────────────────────┤   ├─────────────────────────┤   ├─────────────────────────┤
│ • 100% Free Parity Audit│   │ • Unlimited Products    │   │ • Unlimited Clones/mo   │
│ • Up to 12 Products     │   │ • Zero-Leak CDN Remap   │   │ • Daily Vault Backups   │
│ • 1 Collection          │   │ • Template Suffix Guard │   │ • Master Agency Token   │
│ • Theme Liquid Copy     │   │ • Destination Pays ONLY │   │ • White-label PDF Audit │
│ • Crockford Pairing     │   │ • Preflight Guarantee   │   │ • Priority Dev Support  │
└─────────────────────────┘   └─────────────────────────┘   └─────────────────────────┘
```

---

## 7. ⚠️ Technical Bottlenecks & Production Mitigation

When cloning large stores (1,000+ products, 5,000+ images), specific Shopify API bottlenecks arise. Clonix implements targeted mitigations for each:

### 1. GraphQL Leaky-Bucket Throttling
- **Limitation:** Standard Shopify Admin API caps apps at **50 query cost points/second** (with a maximum burst bucket of 1,000 points). Bulk mutations like `productCreate` consume 10–25 points each.
- **Clonix Mitigation:** Built-in **Token-Bucket Rate Limiter** with jittered exponential backoff (`min(2^attempt * 250ms + jitter, 10000ms)`). Listens to `extensions.cost.throttleStatus` to dynamically throttle request concurrency.

### 2. High-Volume Staged Upload Concurrency
- **Limitation:** Uploading 500+ high-resolution images sequentially takes 10–15 minutes and can cause socket pool exhaustion.
- **Clonix Mitigation:** Employs an **adaptive concurrency pool (max 4 concurrent uploads)**. Images are fetched and streamed directly into Shopify's Google Cloud Storage staged upload buckets with SHA256 checksum validation.

### 3. Circular Metaobject Pointer Resolution
- **Limitation:** If Metaobject A references Metaobject B, and Metaobject B references Metaobject A, creating either first returns `422 Unprocessable Entity: Referenced metaobject does not exist`.
- **Clonix Mitigation:** **Two-Pass Ingestion**. Pass 1 creates blank shell entries with stub keys. Pass 2 executes an update batch resolving all foreign GID relationships once all IDs are materialized.

### 4. Memory Footprint on Large Catalog Dumps
- **Limitation:** Ingesting 20,000 products into a single JavaScript object causes V8 heap memory exhaustion (`JavaScript heap out of memory`).
- **Clonix Mitigation:** Streams data using **JSON Lines (JSONL)** directly to disk. The engine only retains an in-memory dictionary of ID translations (`Map<OldGid, NewGid>`), requiring less than 15MB of RAM for 50,000 items.

---

## 8. 🔌 REST API Reference & Endpoints

The Clonix SaaS engine exposes a lightweight, zero-dependency REST API running on port 3000:

| Method | Endpoint | Description |
| :--- | :--- | :--- |
| `GET` | `/api/health` | Returns service status and timestamp |
| `GET` | `/api/billing/plans` | Returns available commercial plans ($0, $9, $49) |
| `POST` | `/api/pairing/create` | Generates 8-char Crockford token for Source Store |
| `POST` | `/api/pairing/claim` | Destination Store claims token |
| `POST` | `/api/pairing/authorize` | Source Store approves pairing |
| `GET` | `/api/pairing/:code` | Checks current status of pairing session |
| `POST` | `/api/runs/create` | Initializes a 14-stage migration run |
| `GET` | `/api/runs/:runId/progress`| Polls DAG progress with `If-None-Match` ETag caching |
| `GET` | `/api/runs/:runId/parity` | Returns side-by-side verification scorecard |

---

## 9. 🧪 Verification & Automated Test Suite

Run all tests via Vitest:
```bash
cd tibbeshifa-migrator
npm test
```

### Verified Test Suites (16 Files, 112 Tests Passing 100%):
- ✅ `saas/__tests__/clonix.test.ts` (Pairing tokens, HMAC security, DAG progress, pricing tiers, HTTP server)
- ✅ `src/__tests__/client.test.ts` (GraphQL client, retry mechanics, query cost budgeting)
- ✅ `src/__tests__/inventory.test.ts` (Inventory levels, locations, multi-warehouse sync)
- ✅ `src/__tests__/destination.test.ts` (Preflight probes, collision detection, write safety)
- ✅ `src/__tests__/backup.test.ts` (Lossless JSONL backup archive & verification)
- ✅ `src/__tests__/url-repair.test.ts` (Zero-leak CDN image remapping & template rewriting)
- ✅ `src/__tests__/url-scanner.test.ts` (Leak detection crawler for old shop domains)
- ✅ `src/__tests__/safety-guards.test.ts` (Write protection flags, dry-run guarantees)
- ✅ `src/__tests__/auth.test.ts` (Client credentials exchange, OAuth token refresh)

---
*Generated by Clonix Micro-SaaS Core Team.*
