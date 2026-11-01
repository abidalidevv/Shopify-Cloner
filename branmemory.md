# 🧠 CLONIX (Shopify Micro-SaaS Engine) — MASTER BRAIN MEMORY & PROJECT KNOWLEDGE BASE
**File:** `branmemory.md` (Alias of `brainmemory.md`)  
**App Name:** **Clonix** (Internal code name: *Shopify-Cloner / Matrixify Alternative*)  
**Lead Developer:** Abid Ali ([@abidalidevv](https://github.com/abidalidevv))  
**GitHub Repository:** `https://github.com/abidalidevv/Shopify-Cloner.git` (Branch: `main`)  
**Created:** November 1, 2026 (Preserved for Antigravity AI Post-Windows Reinstallation)  

---

> [!IMPORTANT]
> **NOTICE FOR FUTURE ANTIGRAVITY AGENT:**  
> This file is the permanent memory of the **Clonix** project. The user reinstalled Windows on this machine. Antigravity lost its short-term conversational context, but **this document contains 100% of the architecture, history, code structure, secrets overview, business logic, completed phases, and future roadmap**. Read this file first when continuing work on Clonix.

---

## 📌 1. Project Identity & Value Proposition

### What is Clonix?
Clonix is a high-performance **Shopify Micro-SaaS Embedded Application & Store Migration / Backup Engine**.
It was built from scratch to solve the biggest pain points of existing Shopify backup/migration tools (like Matrixify, Rewind, and Duplicate):
1. **Speed & Efficiency:** Matrixify uses slow, manual Excel/CSV imports that fail on rate limits and large catalogs. Clonix uses high-throughput Shopify GraphQL + REST batch pipelines with intelligent concurrency.
2. **True Relational Remapping (`saas/remapper.ts`):** When migrating stores or restoring backups, Shopify assigns brand new GraphQL IDs (`gid://shopify/Product/12345`). Clonix maintains a dual-pass in-memory & persistent ID translation map that automatically repairs relational integrity across:
   - Product IDs & Variant IDs
   - Collection Rules & Manual Collection Member IDs
   - Navigation Menus & Deep Nested Link Trees
   - Custom Liquid Snippets & Metaobject References
3. **Dual-Vault Architecture (`saas/vault.ts`):**
   - **Fast Cloud CDN Vault:** Lightweight JSON archives containing full catalog data + CDN pointers. Backs up in ~3-5 seconds.
   - **Full Offline Media Vault:** Multi-threaded parallel binary downloader that pulls all original images, webps, cutouts, and MP4 videos directly to local disk / Cloudflare R2 / AWS S3.
4. **Autonomous Health & Conversion Engine:** Beyond backups, Clonix includes diagnostic auditing (`saas/diagnoser.ts`) for zero Cumulative Layout Shift (0.00 CLS), WebP image compression, and bilingual SEO metadata injection.

---

## 🏗️ 2. Repository Architecture & Directory Map

```text
Shopify-Cloner (Clonix Root)
│
├── saas/                                  # CORE BACKEND MICRO-SAAS ENGINE (TypeScript)
│   ├── api.ts                             # Express API router & REST endpoints (/api/saas/*)
│   ├── server.ts                          # Standalone Node.js Express server bootstrap
│   ├── extractor.ts                       # GraphQL + REST batch catalog & asset extractor
│   ├── remapper.ts                        # Master ID Relational Remapper (Source -> Target GIDs)
│   ├── vault.ts                           # Snapshot registry, cloud vs offline archive manager
│   ├── pairing.ts                         # Secure store handshake & pairing authentication
│   ├── scheduler.ts                       # Cron & recurring backup job scheduler
│   ├── executors.ts                       # Worker threads for backup/migration/restore tasks
│   ├── r2.ts                              # Cloudflare R2 / AWS S3 blob storage driver
│   ├── billing.ts                         # Shopify App Billing API (Subscriptions, Free Trial)
│   ├── crypto.ts                          # AES-256-GCM encryption for stored API tokens
│   ├── db.ts                              # Neon PostgreSQL database client
│   ├── diagnoser.ts                       # Store performance & health diagnostics
│   ├── errors.ts                          # Standardized error codes & custom error types
│   ├── shopify-client.ts                  # Resilient Shopify API client with backoff retries
│   ├── tokens.ts                          # Token rotation, JWT auth, and verification
│   ├── verifier.ts                        # Data integrity validator post-migration
│   ├── schema.prisma                      # Database schema (Neon PostgreSQL)
│   └── __tests__/                         # Automated test suite (Vitest)
│       ├── clonix.test.ts
│       └── scheduler-executors.test.ts
│
├── clonix-app/                            # EMBEDDED SHOPIFY FRONTEND (Vite + React + Polaris)
│   ├── src/
│   │   ├── components/                    # Polaris UI cards, modals, tables, progress bars
│   │   ├── pages/                         # Dashboard, Migration, Vault, Billing, Settings
│   │   ├── hooks/                         # useStorePairing, useBackupVault, useShopifyApi
│   │   └── App.tsx                        # Main application container
│   ├── package.json
│   ├── vite.config.ts
│   └── tsconfig.json
│
├── clonix-landing/                        # PUBLIC MARKETING & SAAS LANDING PAGE
├── clonix-docs/                           # TECHNICAL DOCS & API REFERENCE
├── prisma/                                # Prisma migrations & client generated assets
├── shopify.app.toml                       # Shopify App CLI configuration (scopes, webhooks, auth)
├── shopify.server.ts                      # Shopify API server middleware
├── MASTER_SAAS_SPEC.md                    # 13,000-word comprehensive technical specification
├── CLONIX_PROJECT_COMPLETE_LIFECYCLE.md   # Product lifecycle, milestones, and release roadmaps
├── CLONIX_DESIGN_SYSTEM.md                # Polaris UI colors, typography, UX patterns
├── CLONIX_NOTION_DOCS.md                  # Notion documentation dump & SOPs
├── package.json                           # Root scripts (build, dev, test, saas:start)
└── tsconfig.json                          # TypeScript root configuration
```

---

## 🗄️ 3. Database Schema (Neon PostgreSQL / Prisma)

The database schema defined in `saas/schema.prisma` manages multi-tenant Shopify installations:
- **`Store` Model:** Stores `shopDomain`, `accessToken` (AES-256 encrypted), `installedAt`, `plan` (`FREE`, `PRO`, `AGENCY`), `status`.
- **`Pairing` Model:** Manages source store ➔ destination store connection tokens, permissions, and expiry.
- **`BackupSnapshot` Model:** Metadata for every archive (type: `FAST_CDN` vs `FULL_OFFLINE`, `s3Key`, `sizeBytes`, `statsJson`, `status`).
- **`JobQueue` Model:** Asynchronous worker queue for long-running extractions and imports (progress percentage, logs, retry counters).
- **`AuditLog` Model:** Complete event stream of all backup, restore, and token generation actions for compliance.

---

## 💻 4. File Locations on Ali's PC

| Location | Path | Description |
| :--- | :--- | :--- |
| **Git Working Directory** | `C:\Users\Ali\Desktop\Matrixify\tibbeshifa-migrator` | Current active git repo connected to GitHub |
| **Permanent Target Folder** | `D:\Projects\Clonix - Shopify Micro-SaaS Engine\` | Safe location on D: drive (survives Windows reinstall) |
| **Clean Isolated Directory** | `D:\Projects\Shopify Micro-SaaS Engine\` | Clean copy of all standalone backend + frontend files |
| **Backup Vault (External)** | `F:\Backup_Before_Windows\` | Cold storage backup before Windows OS installation |

---

## 🔑 5. Live Production Store Testbed: TibbeShifa (`tibbeshifa.com`)

Clonix was rigorously validated on a live commercial Pakistani herbal brand:
- **Store URL:** `https://tibbeshifa.com`
- **Shopify Admin Domain:** `0pr27z-us.myshopify.com`
- **Active Theme ID:** `189439770845` (`Horizon-Migrated`)
- **Catalog Size:** 7 core products, 604 media assets (images, cutouts, videos), 6 landing pages, custom metafields & metaobjects.
- **Key Optimizations Implemented & Verified:**
  1. **Option A Warm Cream Shimmer Loader (`#F5F3E9`):** 0.00 CLS (zero layout shift) on Google PageSpeed Insights.
  2. **100% WebP Compression:** 582 images compressed, saving 176.46 MB bandwidth (-49%).
  3. **Bilingual SEO Metadata (≤ 60 chars):** Live for all 7 products in Urdu and English.
  4. **WhatsApp Smart Floating Widget:** Dynamic 50ms cart query with live line items + total COD PKR, prefilled for Hakim Riaz Ahmad Bhatti (`03070223366`), auto-elevating above `.ts-sticky-buy-bar`.
  5. **Rich Medical & FAQ Schema:** Injected in `layout/theme.liquid` and `/pages/faq`.
  6. **AI Crawlers & Policies:** `agents.md` and `llms.txt` active with full native policies.

---

## 🚀 6. Step-by-Step Instructions for Next Antigravity (Post-Windows)

When Ali opens Antigravity on this machine after reinstalling Windows:
1. **Navigate to the Project:**
   ```powershell
   cd "D:\Projects\Clonix - Shopify Micro-SaaS Engine"
   ```
2. **Verify Git Remote:**
   ```powershell
   git status
   git remote -v
   # origin should point to https://github.com/abidalidevv/Shopify-Cloner.git
   ```
3. **Install Dependencies:**
   ```powershell
   npm install
   # inside clonix-app:
   cd clonix-app; npm install; cd ..
   ```
4. **Environment Setup:**
   - Copy `.env.example` to `.env`.
   - Provide Shopify partner credentials or client API keys.
5. **Run the Engines:**
   - Backend Micro-SaaS Engine: `npm run saas:dev` (runs `saas/server.ts` on port 3000).
   - Frontend Polaris Dashboard: `cd clonix-app && npm run dev` (runs Vite dev server).
   - Run Tests: `npm test` (executes Vitest test suite).
