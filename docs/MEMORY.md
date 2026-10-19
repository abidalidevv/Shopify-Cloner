# 🧠 TibbeShifa & Micro-SaaS Project: Handover & State Memory

> **Last Updated:** October 19, 2026 (06:40 PM PKT)  
> **Status:** Full Physical Media Vault (396.9 MB, 533 media files) created; Delete Confirmation Modal & 1-Click Rollback Implemented; Real Backend Vault API wired; Unlimited Pro Plan ($49/mo) Active.

---

## 📌 1. Shopify Store Migration Status (Live & Verified)
* **Source Store:** `ph0igg-jv.myshopify.com` (tibbeshifa.com)
* **Destination Store:** `0pr27z-us.myshopify.com`
* **Theme:** `Horizon-Migrated` (Published as Main Theme, ID: `189439770845`) + `Backup - Horizon Latest` (ID: `189439705309`)
* **Parity (100% Verified):**
  * **Products (7/7):** Exact handles, Urdu titles (`نجات بواسیر`, `شفائے معدہ`, `نجات دبلاپن`, etc.), prices, stock levels (97-99), 100g weight, tracked status, and custom template suffixes (`newmedda`, `newqabz`, etc.).
  * **SKUs:** `TS-SM-001`, `TS-SC-001`, `TS-QK-001`, `TS-NJ-001` synced.
  * **Metaobjects (12/12):** Exact 12 taxonomy entries upserted and linked to product category metafields.
  * **Collections (7/7):** Active and linked.
  * **Pages (11/11):** All content, policies, and templates.
  * **Customers (2/2):** Muhammad Riaz and Muhammad Umair.
  * **Historical Orders (3/3):** #1001, #1002, #1003.
  * **Navigation Menus (3/3):** Main menu, Footer menu, Customer account menu.
  * **SEO Tags:** Homepage Title & Description rendered dynamically via theme liquid.
  * **Zero-Leak CDN:** 0 references to old CDN paths across products, pages, and theme assets.
* **Offline ZIP Archives:**
  1. `tibbeshifa-full-vault-2026-10-19.zip` (1.78 MB, 598 files) — Fast Cloud Pass.
  2. `tibbeshifa-full-media-vault-2026-10-19.zip` (396.9 MB) — Full Physical Media Archive (533 physical media files: 4 MP4 videos, 314 WebP, 157 PNG, 45 JPG, 12 AVIF, 1 TTF font).

---

## 🚀 2. Micro-SaaS Engine Architecture (`saas/` directory)
All production engine modules are written and validated:
1. `saas/vault.ts`: Real backend snapshot engine handling listing, packaging, and deletion of offline archives.
2. `saas/server.ts`: Production HTTP server with endpoints (`/api/vault/snapshots`, `/api/vault/create-snapshot`, `/api/pairing/*`, `/api/runs/*`, `/api/billing/plans`), CSP frame-ancestors headers, and live request logging.
3. `saas/tokens.ts`: Shopify April 2026 Expiring Offline Access Token rotation under row locks (`refreshLocked`).
4. `saas/billing.ts`: Multi-store billing engine with Neon PostgreSQL AgencySubscription verification.
5. `saas/pairing.ts`: 8-char Crockford base32 pairing state machine, HMAC pepper, 15m TTL.
6. `saas/scheduler.ts`: 14-stage DAG barrier queue with worker leases, heartbeats, and rate-limiting.
7. `saas/remapper.ts`: Zero-404 URL, HTML, Metafields, and `toProductSetInput` remapping engine.
8. `saas/verifier.ts`: Live storefront auditor generating the merchant parity scorecard.
9. `saas/schema.prisma`: Multi-tenant PostgreSQL schema deployed to Neon cloud.

---

## 🎨 3. Embedded App UI (`clonix-app/`)
* **Framework:** React + Vite + TypeScript inside Shopify Admin iframe.
* **Header:** Prominent active subscription badge `👑 Plan: Unlimited Pro ($49/mo) [ACTIVE]`.
* **Offline Vault Tab:**
  * Mode Selector: ⚡ **Fast Cloud Package** (1.78 MB) vs 📦 **Full Offline Media Bundle** (396.9 MB).
  * ⚠️ **Delete Confirmation Modal:** Protects against accidental deletion of backups with clear prompt.
  * 🔄 **1-Click Rollback / Restore to This Store:** Allows disaster recovery rollback to any snapshot date.
  * 🛡️ **Deduplication Guard (Idempotent Restore):** Matches items by handle/SKU so repeated restores never duplicate products.
  * **Live Multi-Stage Progress Bar:** Shows real percentage and status during archive creation and restore.

---

## 🔒 4. Git Repository Status
* **Remote:** `https://github.com/abidalidevv/Shopify-Cloner.git`
* **Local Repo:** `c:\Users\Ali\Desktop\Matrixify\tibbeshifa-migrator`
* **Branch:** `main`
* **Security:** `.env`, secrets, `*.zip`, `.csv`, `.log`, and private backup JSONs are strictly git-ignored.
