# Shopify Cloner

High-fidelity Shopify store migration and cloning engine built with TypeScript and the Shopify Admin GraphQL & REST APIs. Designed to duplicate full store ecosystems—including catalog taxonomy, custom theme templates, inventory tracking, customers, and historical orders—with zero manual re-entry and zero data loss.

---

## Overview

Most conventional Shopify migration apps (like Matrixify or standard CSV exporters) only migrate raw catalog rows. This typically leaves stores broken on destination:
- Custom theme template suffixes (`templateSuffix`) return **404 Not Found** because custom page and product JSON templates aren't compiled into the active theme.
- Products default to untracked inventory (`tracked: false`) with missing warehouse allocations.
- Standard Product Taxonomy categories and category-specific metafields are lost.
- Historical customer records and orders require complex manual spreadsheet mapping.

**Shopify Cloner** solves these edge cases with an automated multi-phase pipeline that syncs both store data and theme layouts in lockstep.

---

## Key Features

- **Theme & Template Preservation (Zero 404s):** Synchronizes custom Liquid/JSON templates (`product.custom.json`, `page.custom.json`) directly into the destination theme via the Asset API.
- **Taxonomy & Category Mapping:** Retains standard Shopify Taxonomy Category references (`gid://shopify/TaxonomyCategory/...`) and category metafield structures.
- **Inventory & Warehouse Synchronization:** Automatically updates `inventoryItem` properties to enable tracking (`tracked: true`), configures physical weights, and assigns stock counts to matching locations.
- **Customer & Order History:** Clones customer profiles and historical order records (with line items, shipping/billing addresses, and financial/fulfillment statuses) using idempotent REST order ingestion.
- **Markets & Catalogs:** Auto-provisions market catalogs (e.g. regional pricing, assigned markets) via the Markets API.
- **Review System Integration:** Generates validated, UTF-8 BOM-encoded review imports (compatible with Judge.me, Loox, and Shopify Reviews) with native metafield rating badges.
- **Strict Write-Safety Rails:** Real writes are strictly guarded behind explicit flags (`--apply`) and typed destination domain confirmations. Dry-run preview is the default.

---

## Architecture Pipeline

```
[ Source Store ] (Read-Only)
       │
       ▼  GraphQL Queries (Paginated & Rate-Limited)
[ Local Cloner Engine ]
   ├── Phase 1: Authentication & Token Exchange (Client Credentials / OAuth)
   ├── Phase 2: Schema Validation (Verifies mutations against live Shopify API)
   ├── Phase 3: Raw Lossless Backup (JSONL + Media Catalog)
   ├── Phase 4: Reference Scanner & ID Remapping (Translates old GIDs to new GIDs)
   └── Phase 5: Theme Asset Compiler (Pushes custom template definitions)
       │
       ▼  Idempotent Writes (GraphQL & REST Admin APIs)
[ Destination Store ] (Live & Verified)
```

---

## Supported Resource Types

| Resource | Migration Method | Scope & Coverage |
|---|---|---|
| **Products & Variants** | GraphQL `productCreate` + `productVariantsBulkUpdate` | Titles, descriptions, vendors, tags, options, compare-at prices, weights, SKUs |
| **Product Taxonomy** | GraphQL `productUpdate` | Standard Category GIDs (`gid://shopify/TaxonomyCategory/...`) |
| **Inventory Levels** | GraphQL `inventoryItemUpdate` + `inventorySetQuantities` | `tracked: true`, on-hand / available counts per location |
| **Collections** | GraphQL `collectionCreate` | Manual and automated (smart rule) collections |
| **Themes & Templates** | GraphQL / REST Asset API | Layouts, section presets, `templateSuffix` mappings |
| **Pages & Menus** | GraphQL `pageCreate` + `menuCreate` | Full page HTML, multi-level nested navigation items |
| **Customers** | GraphQL `customerCreate` | Names, emails, phone numbers, addresses, customer notes |
| **Orders** | REST `POST /orders.json` (Bypass mode) | Historical orders, line items, timestamps, financial statuses |
| **Markets & Catalogs** | GraphQL `catalogCreate` | Market catalogs linked to primary or international markets |
| **Files & Media** | GraphQL `fileCreate` | Media images, banner graphics, CDN asset persistence |
| **URL Redirects** | GraphQL `urlRedirectCreate` | 301 legacy path redirects |

---

## Prerequisites

- **Node.js** >= 20.0.0
- **npm** >= 10.0.0
- Shopify Custom App credentials (or Partner App OAuth credentials) for both Source and Destination stores with relevant Admin API scopes.

---

## Quick Start

### 1. Clone the repository
```bash
git clone https://github.com/abidalidevv/Shopify-Cloner.git
cd Shopify-Cloner
```

### 2. Install dependencies
```bash
npm install
```

### 3. Configure environment
Copy the example environment file and configure your store domains and credentials:
```bash
cp .env.example .env
```

Edit `.env`:
```env
# Source Store (Read-Only)
SOURCE_SHOP=your-source-store.myshopify.com
SOURCE_CLIENT_ID=your_source_client_id
SOURCE_CLIENT_SECRET=your_source_client_secret

# Destination Store
DEST_SHOP=your-destination-store.myshopify.com
DEST_CLIENT_ID=your_dest_client_id
DEST_CLIENT_SECRET=your_dest_client_secret

# Global Settings
SHOPIFY_API_VERSION=2026-10
DRY_RUN=true
```

### 4. Build TypeScript
```bash
npm run build
```

---

## CLI Usage

### Backup Source Data
Extract all store resources into local JSON snapshots:
```bash
npm run backup
```

### Validate API Schema
Check compatibility between your source backup and the destination store's live GraphQL schema:
```bash
npm run validate-schema
```

### Run Migration in Dry-Run Mode (Safe)
Preview operations without making any changes to the destination store:
```bash
npm run migrate -- --module=all
```

### Apply Migration to Live Destination
To execute real writes, pass `--apply` and explicitly verify the destination shop domain:
```bash
npm run migrate -- --module=all --apply --confirm-dest=your-destination-store.myshopify.com
```

### Migrate Specific Modules
You can run migrations for individual modules independently:
```bash
npm run migrate -- --module=products --apply --confirm-dest=your-destination-store.myshopify.com
npm run migrate -- --module=collections --apply --confirm-dest=your-destination-store.myshopify.com
npm run migrate -- --module=pages --apply --confirm-dest=your-destination-store.myshopify.com
npm run migrate -- --module=inventory --apply --confirm-dest=your-destination-store.myshopify.com
```

---

## Safety & Security

- **Strict Read-Only Source Policy:** The engine will never execute mutations against the source store domain.
- **Idempotent Operations:** Records are mapped via natural keys (handles, emails, SKUs). Rerunning a migration will not create duplicate products or collections.
- **Credential Protection:** Secrets and environment files are strictly excluded via `.gitignore` and are never logged or persisted in state checkpoints.

---

## License

MIT License. Free for personal, commercial, and agency use.
