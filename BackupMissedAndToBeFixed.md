# 📋 Backup Missed Items & Resolution Roadmap (`BackupMissedAndToBeFixed.md`)

> **Document Version:** 1.2.0  
> **Target:** Store-to-Store Migration Parity & Micro-SaaS Engine Enhancement  
> **Source Store:** `ph0igg-jv.myshopify.com` (tibbeshifa.com)  
> **Destination Store:** `0pr27z-us.myshopify.com`  
> **Updated:** October 16, 2026  

---

## 🔍 Executive Summary

During the visual admin inspection comparing products, inventory, customers, orders, metaobjects, catalogs, and online store preferences, **9 specific admin-level areas** were identified and analyzed.

Every item has been investigated at the raw GraphQL / REST protocol level, resolved where possible, and documented with exact Shopify platform limitations and solutions.

---

## 📊 Complete Breakdown of All 9 Areas & Solutions

### 1. 📦 Products > Inventory Page ("No inventory found")
* **Observation:**  
  On the old store, `products/inventory?location_id=90464649457` listed all 7 products, SKUs, and stock (97, 98, 99). On the new store, it showed *"No inventory found"*.
* **Root Cause:**  
  Newly created products in Shopify have `inventoryItem.tracked: false`. When inventory is untracked, Shopify's Inventory management screen filters them out completely.
* **Resolution Applied:**  
  * Enabled tracking via `inventoryItemUpdate(input: { tracked: true })`.
  * Set on-hand and available quantities via `inventorySetQuantities` to match source (97, 98, 99).
  * Synced all SKUs (`TS-SM-001`, `TS-SC-001`, `TS-QK-001`, `TS-NJ-001`).
* **Current Status:** ✅ **100% RESOLVED (Visible on Inventory Screen)**

---

### 2. 👥 Customers Page ("No customers match this segment criteria")
* **Observation:**  
  Old store had 2 customers (`Muhammad Riaz`, `Muhammad Umair`). New store showed 0 customers.
* **Resolution Applied:**  
  Migrated all customer profiles with names, emails, and notes via Shopify GraphQL `customerCreate`:
  1. `Muhammad Riaz` (`abidmmp100@gmail.com`) → GID: `gid://shopify/Customer/31333877809373`
  2. `Muhammad Umair` (`umairmcs100@gmail.com`) → GID: `gid://shopify/Customer/31333877842141`
* **Current Status:** ✅ **100% RESOLVED (Both Customers Live)**

---

### 3. 🛍️ Orders Page ("Empty / Koi order copy nahi hua")
* **Observation:**  
  Old store had 3 pending COD orders (`#1001`, `#1002`, `#1003`). New store had 0 orders.
* **Root Cause:**  
  Shopify restricts historical order creation in GraphQL; historical order imports must be executed via Admin REST API (`POST /admin/api/2026-10/orders.json`) with `inventory_behaviour: bypass` and E.164 phone formatting.
* **Resolution Applied:**  
  Migrated all 3 historical orders with exact line items, pricing (Rs. 1,999), and customer linkages:
  1. **Order #1001** (Muhammad Riaz — نجات بواسیر) → `gid://shopify/Order/18960266428637`
  2. **Order #1002** (Muhammad Riaz / Abid Ali — نجات بواسیر) → `gid://shopify/Order/18960268591325`
  3. **Order #1003** (Muhammad Umair — قبض کشا) → `gid://shopify/Order/18960269705437`
* **Current Status:** ✅ **100% RESOLVED (All 3 Orders Live with Pending Payment Status)**

---

### 4. 📂 Catalogs Page (Markets > Catalogs)
* **Observation:**  
  Old store had an active catalog: `TibbeShifa Pakistan` (Market: Pakistan). New store had 0 catalogs.
* **Root Cause:**  
  Market catalogs in Shopify are created under Shopify Markets API, not the standard Product Catalog endpoint.
* **Resolution Applied:**  
  Created `TibbeShifa Pakistan` catalog on destination store via GraphQL `catalogCreate`:
  * **Catalog Title:** `TibbeShifa Pakistan`
  * **Type:** `MarketCatalog`
  * **ID:** `gid://shopify/MarketCatalog/126688035037`
  * **Assigned Market:** `Pakistan` (`gid://shopify/Market/64849445085`)
  * **Status:** `ACTIVE`
* **Current Status:** ✅ **100% RESOLVED (Visible in Catalogs Screen)**

---

### 5. 🧩 Metaobjects Page (12 entries vs 2 entries)
* **Observation:**  
  Old store had 12 metaobjects (e.g. `Male` for Target Gender, `Kidney and urinary health`, `Recovery`, `Digestive health`). New store only showed 2 default Knowledge Base facts.
* **Root Cause in Shopify Platform:**  
  Those 12 entries are **Shopify Standard Taxonomy Metaobjects** with type prefix `shopify--` (e.g. `shopify--target-gender`, `shopify--herbal-supplement-health-goal`).  
  When our script attempted to create these definitions via API, Shopify explicitly blocked it:
  > *"Not authorized. This type is reserved for use by another application."*
* **How it works:**  
  Shopify reserves the `shopify--` namespace exclusively for its own internal Taxonomy app. Shopify automatically provisions and links these entries when a merchant edits a product and selects category attributes in the admin UI.
* **SaaS Strategy:**  
  Custom user-defined metaobjects (e.g. `custom_banner`, `ingredient_profile`) can be 100% cloned via API. Standard system taxonomy metaobjects are managed automatically by Shopify once category taxonomy is linked.
* **Current Status:** ✅ **IDENTIFIED & ARCHITECTED**

---

### 6. ⚙️ Online Store > Preferences Page
* **Observation:**  
  Homepage title, meta description, and social sharing image in *Online Store > Preferences* were empty on new store.
* **Root Cause in Shopify Platform:**  
  **Shopify does NOT provide any public REST or GraphQL API mutation to modify the "Online Store > Preferences" homepage SEO inputs.**  
  *(Even Matrixify, Duplify, and Cart2Cart cannot modify this page via API due to Shopify's platform lockdown).*
* **How Merchants / SaaS Handle It:**  
  1. **Theme Liquid Level (Best Practice):** Homepage SEO title and meta description are rendered dynamically in `layout/theme.liquid` or `snippets/seo.liquid`.
  2. **Manual Copy:** Copying the 2 lines of text (Homepage title and meta description) takes 30 seconds once during initial store setup.
* **Current Status:** ✅ **EXPLAINED & THEME-COMPATIBLE**

---

### 7. 🏷️ Product Taxonomy / Category (`category`)
* **Resolution:** All 7 products assigned to official standard taxonomy categories (`hb-1-9-6-5`, `hb-1-9-6`, `hb-1-9-6-4`).
* **Current Status:** ✅ **100% RESOLVED**

---

### 8. ⚖️ Physical Shipping Weight (100g vs 0g)
* **Resolution:** All inventory items updated to `100.0 g` (`GRAMS`).
* **Current Status:** ✅ **100% RESOLVED**

---

### 9. 📢 Sales Channels & Analytics
* **Channels:** `Online Store` channel is 100% active. Third-party channels (Meta, TikTok) activate automatically when their respective apps are installed.
* **Analytics:** Now that orders `#1001`, `#1002`, and `#1003` are live in the database, Shopify's analytics engine will begin calculating sell-through rates and reports.
* **Current Status:** ✅ **100% READY**

---

## 🏆 Summary Table: What Was Missing vs What Is Fixed

| Area | Before | Now | How it was fixed |
|---|:---:|:---:|---|
| **Inventory Screen** | ❌ No inventory found | ✅ **All 7 products & SKUs listed** | Enabled `tracked: true`, set stock 97-99 & SKUs |
| **Customers** | ❌ 0 customers | ✅ **2 customers live** | Migrated via GraphQL `customerCreate` |
| **Orders** | ❌ 0 orders | ✅ **3 orders live** | Migrated via Admin REST API (`#1001, #1002, #1003`) |
| **Catalogs** | ❌ 0 catalogs | ✅ **TibbeShifa Pakistan Active** | Created via GraphQL `catalogCreate` |
| **Categories** | ❌ Empty | ✅ **Standard Taxonomy Set** | Linked `hb-1-9-6-5`, `hb-1-9-6-4`, `hb-1-9-6` |
| **Weight** | ❌ 0.0g | ✅ **100.0g** | Set inside `inventoryItem.measurement.weight` |
| **Metaobjects** | ⚠️ System-managed | ℹ️ **Documented** | Reserved `shopify--` taxonomy namespace explained |
| **Preferences** | ⚠️ Admin-locked | ℹ️ **Documented** | Shopify API restriction explained (Handled in Theme) |
