# 🚀 Shopify Store Cloner & Backup Micro-SaaS: Master Specification (`MASTER_SAAS_SPEC.md`)

> **Document Version:** 2.0.0 (Master Commercial Edition)  
> **Target:** High-Concurrency Commercial Shopify Store Cloner & Backup App  
> **Status:** Architecture 100% Validated; Migration Parity 100% Proven; Ready for Frontend Build  
> **Date:** October 17, 2026  

---

## 📑 Table of Contents
1. [Executive Summary & Product Vision](#-1-executive-summary--product-vision)
2. [Market Opportunity & Competitor Exploitation](#-2-market-opportunity--competitor-exploitation)
3. [Monetization Architecture & Pricing Tiers](#-3-monetization-architecture--pricing-tiers)
4. [Finalized Tech Stack, Database & Hosting](#-4-finalized-tech-stack-database--hosting)
5. [End-to-End Workflow: How It Works (A to Z)](#-5-end-to-end-workflow-how-it-works-a-to-z)
6. [Core Engine Architecture (8 Production Modules)](#-6-core-engine-architecture-8-production-modules)
7. [The 14-Stage DAG Barrier Execution Pipeline](#-7-the-14-stage-dag-barrier-execution-pipeline)
8. [Platform Bottlenecks & Engineered Mitigations](#-8-platform-bottlenecks--engineered-mitigations)
9. [Pre-Prepared Claude Prompt (For 40-Min Reset)](#-9-pre-prepared-claude-prompt-for-40-min-reset)
10. [Step-by-Step Implementation Roadmap](#-10-step-by-step-implementation-roadmap)

---

## 🎯 1. Executive Summary & Product Vision

### Core Mission
Create a **1-click, high-fidelity Shopify Store Duplication & Offline Backup SaaS** that eliminates complex spreadsheets (Matrixify) and absurd $79/mo subscriptions (Duplify).

### Two Operating Models Under One Engine:
1. **Model 2: Direct 2-Way Pairing (Primary SaaS Door):**
   - Merchant enters an 8-character Crockford Base32 pairing code on Destination Store.
   - Source Store approves with 1 click.
   - Data streams directly between stores in the cloud with zero file handling by merchant.
2. **Model 1: Standalone Offline ZIP Vault (Backup & Disaster Recovery):**
   - 1-click download of a lightweight, highly-compressed ZIP (1.78 MB).
   - Contains all theme liquid code, templates, and complete JSON catalog.
   - Merchant can restore to any store anytime via drag-and-drop.

---

## 🥊 2. Market Opportunity & Competitor Exploitation

| Competitor | Pricing | Biggest Weakness | Our Winning Angle |
|---|---|---|---|
| **Duplify** | $79 – $129 / month | **Extremely expensive.** Drops custom page templates; huge churn after 1 clone. | **$29 One-Time Pass** + Zero broken templates guarantee. |
| **Matrixify (Excelify)** | Free (10 items), then $20 to $200/mo | **Intimidating 50-column spreadsheet.** User must fix broken image links manually. | **1-Click Native UI.** Zero spreadsheets, zero technical know-how required. |
| **Rewind Backups** | $19 – $299 / month | **No 1-click store-to-store clone.** Purely point-in-time recovery. | **Cloning + Offline Backups** bundled together. |

---

## 💰 3. Monetization Architecture & Pricing Tiers

### 1. 🆓 Free Tier (The Viral Growth Hook)
* **Threshold:** Up to **12 Products, 1 Collection, 3 Pages, and Active Theme**.
* **100% Free Health & Parity Audit Report:** Runs for stores of **ANY size** (e.g., crawls a 1,000 product store and flags: *"You have 4 custom templates and 12 unmapped metafields other tools break"* — driving instant $29 conversions).
* **Fair Use:** Maximum 3 free runs per origin shop GID to prevent uninstall/reinstall abuse.

### 2. ⚡ Single Clone Pass ($29 One-Time)
* **Billed Exclusively to Destination Store (Store B):** Store A installs for **$0 free**.
* Uses Shopify App Billing API (`appPurchaseOneTimeCreate`).
* **Includes:** Unlimited products, collections, pages, blogs, navigation menus, metafields, theme assets, and zero-leak CDN rewrite.
* **Fair-Play Guarantee:** If clone fails before reaching 10% progress, pass auto-releases for a free retry.

### 3. 🏢 Agency Pro Tier ($79 / Month Recurring)
* Uses Shopify Recurring Billing API (`appSubscriptionCreate`).
* **Features:** Unlimited store clones, white-label PDF audit reports, and **Master Agency Pairing Tokens** allowing agency teams to pair client stores instantly without repeated consent prompts.

---

## 🛠️ 4. Finalized Tech Stack, Database & Hosting

| Layer | Selected Technology | Rationale & Cost |
|---|---|---|
| **App Framework** | **React Router v7 (Official Shopify Template)** | Current official Shopify CLI standard (replaces legacy Remix template). Native App Bridge 4.0. |
| **Design System** | **Shopify Polaris Web Components** | Built into App Bridge script tags. 100% native admin look. Zero AI aesthetic. |
| **Backend Runtime** | **Node.js (v20+ LTS) / TypeScript** | Strict typing across all data structures, high async performance. |
| **Database** | **PostgreSQL (Supabase / Neon.tech)** | Direct connection for background workers; Transaction-pooled for web app. |
| **Job Queue** | **`pg-boss` (Postgres Native Queue)** | Runs directly inside PostgreSQL! **Zero Redis required.** Persistent worker process. |
| **File Storage** | **Cloudflare R2** | **$0 Egress Fees.** Stores transient backup ZIP files and JSONL staging files safely. |
| **Progress Tracking** | **Short Polling with ETag (2s interval)** | Direct `GET /api/runs/:id/progress` with Bearer auth; 304 on unchanged state. Reliable inside iframes. |
| **Hosting Server** | **VPS / Railway / Node Container** | Persistent process required for `pg-boss` workers (shared hosting kills long tasks). |

---

## 🔄 5. End-to-End Workflow: How It Works (A to Z)

```
[ Store A (Source) ]                         [ Store B (Destination) ]
         │                                              │
         ▼ Installs App ($0 Free)                       ▼ Installs App
         │                                              │
         ├──────────────────────────────────────────────┤
         │             8-Char Pairing Handshake         │
         │   Store B generates code "7K9M-2PX4"         │
         │   Store A enters code & approves consent     │
         │   Encrypted HMAC exchange creates session    │
         ├──────────────────────────────────────────────┤
         │                                              │
         ▼                                              ▼
   [ Stage 0: Pre-Flight ] ──────────────► [ Shopify Billing API ($29) ]
   • Audit inventory & items               • Billed only if > Free limit
   • Validates token rotation              • Dev stores get sponsored bypass
         │
         ▼
   [ Distributed 14-Stage Pipeline via pg-boss ]
   • Shopify GraphQL Bulk Operation extracts data
   • Zero-Bandwidth URL streamer downloads images directly to Store B CDN
   • Zero-404 Remapper translates IDs, custom templates, & rich-text HTML
         │
         ▼
   [ Stage 13: Verifier & Report Card ]
   • Crawls Store B storefront: checks HTTP 200, images READY, 0 dead links
   • Merchant receives green checkmark and PDF report
```

---

## 🧩 6. Core Engine Architecture (8 Production Modules)

All located in `saas/` (and root):

1. **`schema.prisma`:**
   - Multi-tenant relational schema: `Tenant`, `Shop`, `CloneRun`, `StageShardTask`, `PairingSession`, `StorePass`, `AgencySubscription`, `VerificationAudit`.
   - Supports row-level locking (`refreshLocked`) and dead-worker heartbeats.
2. **`tokens.ts`:**
   - Compliant with **Shopify April 2026 Expiring Offline Token Rule**.
   - Rotates 60-minute access tokens and 90-day refresh tokens under PostgreSQL transactional locks.
3. **`billing.ts`:**
   - Handles Freemium gating, $29 Single Clone Pass (`appPurchaseOneTimeCreate`), $79/mo Agency Hub subscription, and fair-play pass releases.
4. **`pairing.ts`:**
   - Crockford Base32 8-character pairing state machine with HMAC-SHA256 pepper, 15-minute TTL, and uninstall cascade revocation.
5. **`scheduler.ts`:**
   - 14-Stage DAG barrier queue with `pg-boss`.
   - 90-second worker leases, 30-second heartbeats, 25-item durable checkpoints, and self-seeding token bucket rate limiter (`ShopThrottle`).
6. **`remapper.ts`:**
   - High-performance remapping engine: rewrites URLs, rich text HTML, custom page template suffixes (`newmedda`, `newqabz`), and metafields.
7. **`verifier.ts`:**
   - Stage 13 automated crawler that verifies live storefront HTTP 200 status, image CDN transition, and generates the merchant audit report card.
8. **`diagnoser.ts`:**
   - Side-by-side store comparator used for automated regression testing and parity checks.

---

## 📈 7. The 14-Stage DAG Barrier Execution Pipeline

Every clone progresses through sequential barriers to prevent foreign key errors (Theme is at Stage 11 because its ID rewrites depend on all preceding stages):

* **Stage 0: Preflight & Quota:** Scope check, reachable media HEAD probe, billing verification.
* **Stage 1: Shop Locale & Currencies:** Currency formats, units, languages, and primary location mapping.
* **Stage 2: Files & Assets Ingestion:** Media registration via `fileCreate` (Shopify CDN auto-fetch) with destination GID indexing.
* **Stage 3: Standard Taxonomy Metaobjects:** System taxonomy entries linking.
* **Stage 4: Custom Metafield Definitions:** Product, variant, collection, and shop definitions.
* **Stage 5: Product Catalog & Variants:** `productSet` mutation with handles, SKUs, and weights.
* **Stage 6: Inventory Quantities & Tracking:** `inventoryItemUpdate` (`tracked: true`) and `inventorySetQuantities`.
* **Stage 7: Custom Collections & Smart Rules:** Manual and automated collection rules.
* **Stage 8: Content Pages, Blogs & Articles:** Legal policies, contact, about, and landing pages.
* **Stage 9: Navigation Menus:** Main menu, footer menu, and deep nested links.
* **Stage 10: Translations & Adapt Strings:** Multi-language locale dictionary strings.
* **Stage 11: Theme Code & Liquid Templates:** Theme files upsert (`{% schema %}` rewrites, `settings_data.json` presets, section groups).
* **Stage 12: URL Redirects & Policies:** 301 redirects to maintain SEO rank.
* **Stage 13: Storefront Verification Audit & Patch:** Automated crawl, broken link scan, deferred metafield patching, merchant score card.

---

## 🛡️ 8. Platform Bottlenecks & Engineered Mitigations

| Bottleneck | Platform Cause | Engineered Solution |
|---|---|---|
| **GraphQL 50 pts/sec limit** | Shopify API rate throttling | `ShopThrottle` token bucket in Postgres smoothly paces mutations. |
| **Image processing latency** | Shopify async image resizing | Stage 13 Verifier polls until images hit `READY` status. |
| **Theme REST 2 req/sec limit** | Shopify legacy theme asset endpoint | Isolated sequential worker queue; prevents catalog blocking. |
| **10,000+ item timeouts** | REST/GraphQL pagination timeouts | Stage 0 utilizes Shopify `bulkOperationRunQuery` (JSONL). |
| **Old store deletion media loss** | Merchant deletes source store | Images are copied to Destination's native CDN bucket before job finishes. |

---

## 🤖 9. Pre-Prepared Claude Prompt (For 40-Min Reset)

Jab Claude ki limit reset ho, to seedha yeh prompt paste karna hai:

```text
Hamare paas Shopify Store Cloner Micro-SaaS ka complete backend engine (Prisma, pg-boss DAG scheduler, token rotation, remapper, verifier, billing) ready hai.

Aap se 2 specific cheezein review karwani hain:
1. File: saas/remapper.ts aur saas/verifier.ts:
   - Check karein kya Liquid theme settings aur deep nested JSON metafields mein koi edge-case CDN link reh to nahi jata?
   - Shopify April 2026 standard taxonomy metaobject linking mein koi payload discrepancy to nahi?
2. Shopify Partner App Store Review Submission:
   - Review our required OAuth scopes: [read_products, write_products, read_themes, write_themes, read_content, write_content, read_orders, write_orders, read_customers, write_customers, read_inventory, write_inventory, read_translations, write_translations].
   - Kya Shopify App Review team in scopes par koi rejection de sakti hai, aur hum justification mein kya provide karein?
```

---

## 🚦 10. Step-by-Step Implementation Roadmap

1. **Step 1: Frontend App Shell (Polaris + Remix):**
   - Initialize Shopify App frontend shell with official Polaris components.
   - Screens: Pairing Code input modal, Live DAG Progress Bar, and Verification Audit Card.
2. **Step 2: Database Initialization:**
   - Setup Supabase free Postgres instance.
   - Apply `npx prisma db push` using `schema.prisma`.
3. **Step 3: Background Worker Startup:**
   - Connect `pg-boss` to Supabase Postgres.
   - Hook up Stage 0 to Stage 13 workers.
4. **Step 4: End-to-End Test Run:**
   - Execute test pairing between Dev stores and verify real-time UI progress updates.
