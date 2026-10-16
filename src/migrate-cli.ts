/**
 * CLI Runner for Phase 6: Destination Migration Modules.
 *
 * Usage:
 *   npm run migrate -- --module=pages
 *   npm run migrate -- --module=products
 *   npm run migrate -- --module=all
 *   npm run migrate -- --module=all --apply
 *   npm run migrate -- --module=all --apply --canary
 *
 * Migration order (all mode):
 *   1. Files
 *   2. Metaobject Definitions (must come before entries)
 *   3. Products (with variants + media)
 *   4. Collections (with smart rules + product linking)
 *   5. Metaobject Entries
 *   6. Pages
 *   7. Redirects
 *   8. Menus
 *   9. Translations
 *  10. Inventory Levels
 *  11. Discounts
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { loadConfig } from "./config.js";
import { resolveAccessToken } from "./auth.js";
import { createDestClient } from "./client.js";
import { MappingManager } from "./destination/id-mapper.js";
import {
  migratePages,
  migrateRedirects,
  migrateFiles,
  migrateProducts,
  migrateCollections,
  migrateMetaobjectDefinitions,
  migrateMetaobjects,
  migrateMenus,
  migrateTranslations,
  migrateInventoryLevels,
  migrateDiscounts,
  type MigrationSummary,
  type ProductMigrationItem,
  type InventoryLevelItem,
  type CollectionMigrationItem,
} from "./destination/migration-engine.js";
import { isSchemaValidated } from "./destination/schema-validator.js";

async function main(): Promise<void> {
  console.log("\n=======================================================");
  console.log(" TibbeShifa Migrator — Phase 6: Migration Modules");
  console.log("=======================================================\n");

  const config = loadConfig();
  const args = process.argv.slice(2);
  const wantsApply = args.includes("--apply");
  const moduleArg = args.find((a) => a.startsWith("--module="))?.split("=")[1] ?? "all";
  const confirmDestArg = args.find((a) => a.startsWith("--confirm-dest="))?.split("=")[1];
  const isCanary = args.includes("--canary");

  if (!config.destination.shop) {
    console.error("❌ Destination store not configured. Please set DEST_SHOP in .env first.");
    process.exit(1);
  }

  // Strict Write-Safety Guards
  if (wantsApply) {
    if (config.dryRun) {
      console.error("❌ SAFETY GUARD BLOCKED: DRY_RUN=true is set in your .env file.");
      console.error("To perform real writes you must set DRY_RUN=false in .env AND pass --apply.");
      process.exit(1);
    }

    if (!confirmDestArg || confirmDestArg !== config.destination.shop) {
      console.error(`❌ SAFETY GUARD BLOCKED: Real write requires explicit typed confirmation of the destination domain.`);
      console.error(`Expected: --confirm-dest=${config.destination.shop}`);
      console.error(`Received: ${confirmDestArg ? `--confirm-dest=${confirmDestArg}` : "(Missing --confirm-dest)"}`);
      process.exit(1);
    }

    if (!isSchemaValidated(config.destination.shop)) {
      console.error(`❌ SAFETY GUARD BLOCKED: Importers cannot run --apply until schema validation passes.`);
      console.error(`Please run 'npm run validate-schema' first to verify all GraphQL documents against live 2026-10 schema.`);
      process.exit(1);
    }
  }

  const isApply = wantsApply && !config.dryRun && confirmDestArg === config.destination.shop;

  console.log(`Target destination: ${config.destination.shop}`);
  console.log(`Mode:               ${isApply ? "⚠️ LIVE APPLY (WRITES ENABLED)" : "🛡️ DRY-RUN PREVIEW (ZERO WRITES)"}`);
  console.log(`Canary Mode:        ${isCanary ? "🐤 ACTIVE (1 item canary test, halts for approval)" : "Off"}`);
  console.log(`Module:             ${moduleArg}\n`);

  try {
    const token = await resolveAccessToken(config.destination);
    const client = createDestClient(config.destination.shop, token, !isApply);
    const mapper = new MappingManager();
    const options = { client, mappingManager: mapper, dryRun: !isApply };

    const backupDir = "backups/source-store/json";

    function loadBackupJson<T>(filename: string): T[] {
      const full = path.join(backupDir, filename);
      if (fs.existsSync(full)) {
        try {
          const items = JSON.parse(fs.readFileSync(full, "utf8")) as T[];
          return isCanary ? items.slice(0, 1) : items;
        } catch {
          return [];
        }
      }
      return [];
    }

    const summaries: MigrationSummary[] = [];

    // ── 1. Files ─────────────────────────────────────────────────────────────
    if (moduleArg === "files" || moduleArg === "all") {
      console.log("--- [1/11] Executing Files Module ---");
      const files = loadBackupJson<{ id: string; url?: string; filename?: string; alt?: string; image?: { url?: string } }>("files.json").map((f) => ({
        id: f.id,
        originalSource: f.url || f.image?.url || "",
        filename: f.filename ?? `${f.id.split("/").pop()}.jpg`,
        altText: f.alt,
      }));
      summaries.push(await migrateFiles(files, options));
    }

    // ── 2. Metaobject Definitions (MUST come before entries) ─────────────────
    if (moduleArg === "metaobjectDefinitions" || moduleArg === "all") {
      console.log("--- [2/11] Executing Metaobject Definitions Module ---");
      const defs = loadBackupJson<{
        type: string;
        name: string;
        description?: string;
        fieldDefinitions: Array<{
          name: string;
          key: string;
          description?: string | null;
          required: boolean;
          type: { name: string };
        }>;
      }>("metaobjectDefinitions.json");
      summaries.push(await migrateMetaobjectDefinitions(defs, options));
    }

    // ── 3. Products (with variants + media) ──────────────────────────────────
    if (moduleArg === "products" || moduleArg === "all") {
      console.log("--- [3/11] Executing Products Module (with Variants & Media) ---");

      interface BackupProduct {
        handle: string;
        title: string;
        descriptionHtml?: string;
        vendor?: string;
        productType?: string;
        status?: string;
        tags?: string[];
        templateSuffix?: string;
        options?: Array<{ name: string; values: string[]; position?: number }>;
        variants?: {
          edges?: Array<{
            node: {
              id: string;
              title?: string;
              sku?: string | null;
              barcode?: string | null;
              price: string;
              compareAtPrice?: string | null;
              taxable?: boolean;
              inventoryItem?: {
                id?: string;
                measurement?: {
                  weight?: { value: number; unit: string };
                };
                inventoryLevels?: {
                  edges?: Array<{
                    node: {
                      location: { id: string; name: string };
                      quantities?: Array<{ name: string; quantity: number }>;
                    };
                  }>;
                };
              };
              selectedOptions?: Array<{ name: string; value: string }>;
            };
          }>;
        };
        media?: {
          edges?: Array<{
            node: {
              id: string;
              mediaContentType: string;
              alt?: string;
              image?: { url: string };
            };
          }>;
        };
        collections?: {
          edges?: Array<{
            node: { id: string; handle: string };
          }>;
        };
      }

      const rawProducts = loadBackupJson<BackupProduct>("products.json");

      // Build product-to-collection mapping for later use
      const collectionProductMap = new Map<string, string[]>();
      for (const rp of rawProducts) {
        const colEdges = rp.collections?.edges ?? [];
        for (const ce of colEdges) {
          const handle = ce.node.handle;
          if (!collectionProductMap.has(handle)) {
            collectionProductMap.set(handle, []);
          }
          collectionProductMap.get(handle)!.push(rp.handle);
        }
      }

      // Store the collection mapping in a temp file for the collections step
      const collMapPath = path.join(backupDir, "_collection-product-map.json");
      fs.writeFileSync(collMapPath, JSON.stringify(Object.fromEntries(collectionProductMap), null, 2), "utf8");

      // Transform backup format into migration format
      const products: ProductMigrationItem[] = rawProducts.map((rp) => {
        const variantEdges = rp.variants?.edges ?? [];
        return {
          handle: rp.handle,
          title: rp.title,
          descriptionHtml: rp.descriptionHtml,
          vendor: rp.vendor,
          productType: rp.productType,
          status: rp.status,
          tags: rp.tags,
          templateSuffix: rp.templateSuffix,
          options: rp.options?.map((o) => ({ name: o.name, values: o.values })),
          variants: variantEdges.map((ve) => ({
            title: ve.node.title,
            sku: ve.node.sku,
            barcode: ve.node.barcode,
            price: ve.node.price,
            compareAtPrice: ve.node.compareAtPrice,
            taxable: ve.node.taxable,
            weight: ve.node.inventoryItem?.measurement?.weight?.value,
            weightUnit: ve.node.inventoryItem?.measurement?.weight?.unit,
            selectedOptions: ve.node.selectedOptions,
          })),
          media: (rp.media?.edges ?? [])
            .filter((me) => me.node.image?.url)
            .map((me) => ({
              mediaContentType: me.node.mediaContentType,
              alt: me.node.alt,
              originalSource: me.node.image!.url,
            })),
        };
      });

      summaries.push(await migrateProducts(products, options));

      // ── Collect inventory levels from backup for later ──
      const inventoryLevels: InventoryLevelItem[] = [];
      for (const rp of rawProducts) {
        for (const ve of rp.variants?.edges ?? []) {
          const invLevels = ve.node.inventoryItem?.inventoryLevels?.edges ?? [];
          for (const il of invLevels) {
            const availQty = il.node.quantities?.find((q) => q.name === "available");
            if (availQty !== undefined) {
              inventoryLevels.push({
                productHandle: rp.handle,
                variantKey: ve.node.sku ?? ve.node.title ?? "Default Title",
                sourceInventoryItemId: ve.node.inventoryItem?.id,
                locationName: il.node.location.name,
                available: availQty.quantity,
              });
            }
          }
        }
      }
      // Save for inventory step
      const invLevelsPath = path.join(backupDir, "_inventory-levels.json");
      fs.writeFileSync(invLevelsPath, JSON.stringify(inventoryLevels, null, 2), "utf8");
    }

    // ── 4. Collections (with smart rules + product linking) ──────────────────
    if (moduleArg === "collections" || moduleArg === "all") {
      console.log("--- [4/11] Executing Collections Module (with Smart Rules & Product Linking) ---");

      // Load collection-product mapping
      const collMapPath = path.join(backupDir, "_collection-product-map.json");
      let collProductMap: Record<string, string[]> = {};
      if (fs.existsSync(collMapPath)) {
        try {
          collProductMap = JSON.parse(fs.readFileSync(collMapPath, "utf8")) as Record<string, string[]>;
        } catch {
          // empty
        }
      }

      const collections = loadBackupJson<{
        handle: string;
        title: string;
        descriptionHtml?: string;
        templateSuffix?: string | null;
        ruleSet?: {
          appliedDisjunctively: boolean;
          rules: Array<{ column: string; relation: string; condition: string }>;
        } | null;
        image?: { url: string; altText?: string | null } | null;
      }>("collections.json").map((c): CollectionMigrationItem => ({
        ...c,
        templateSuffix: c.templateSuffix ?? undefined,
        ruleSet: c.ruleSet ?? undefined,
        image: c.image ?? undefined,
        productHandles: collProductMap[c.handle] ?? [],
      }));

      summaries.push(await migrateCollections(collections, options));
    }

    // ── 5. Metaobject Entries ─────────────────────────────────────────────────
    if (moduleArg === "metaobjects" || moduleArg === "all") {
      console.log("--- [5/11] Executing Metaobject Entries Module ---");
      const metaobjects = loadBackupJson<{ handle: string; type: string; fields: Array<{ key: string; value: string }> }>("metaobjects.json");
      summaries.push(await migrateMetaobjects(metaobjects, options));
    }

    // ── 6. Pages ─────────────────────────────────────────────────────────────
    if (moduleArg === "pages" || moduleArg === "all") {
      console.log("--- [6/11] Executing Pages Module ---");
      const pages = loadBackupJson<{ handle: string; title: string; body?: string; templateSuffix?: string }>("pages.json");
      summaries.push(await migratePages(pages, options));
    }

    // ── 7. Redirects ─────────────────────────────────────────────────────────
    if (moduleArg === "redirects" || moduleArg === "all") {
      console.log("--- [7/11] Executing Redirects Module ---");
      const redirects = loadBackupJson<{ path: string; target: string }>("redirects.json");
      summaries.push(await migrateRedirects(redirects, options));
    }

    // ── 8. Menus ─────────────────────────────────────────────────────────────
    if (moduleArg === "menus" || moduleArg === "all") {
      console.log("--- [8/11] Executing Menus Module ---");
      const menus = loadBackupJson<{ handle: string; title: string; items: [] }>("menus.json");
      summaries.push(await migrateMenus(menus, options));
    }

    // ── 9. Translations ──────────────────────────────────────────────────────
    if (moduleArg === "translations" || moduleArg === "all") {
      console.log("--- [9/11] Executing Translations Module ---");
      const translations = loadBackupJson<{ resourceId: string; locale: string; key: string; value: string; translatableContentDigest: string }>("translations.json");
      summaries.push(await migrateTranslations(translations, options));
    }

    // ── 10. Inventory Levels ─────────────────────────────────────────────────
    if (moduleArg === "inventoryLevels" || moduleArg === "inventory" || moduleArg === "all") {
      console.log("--- [10/11] Executing Inventory Levels Module ---");
      const invLevelsPath = path.join(backupDir, "_inventory-levels.json");
      let inventoryLevels: InventoryLevelItem[] = [];
      if (fs.existsSync(invLevelsPath)) {
        try {
          inventoryLevels = JSON.parse(fs.readFileSync(invLevelsPath, "utf8")) as InventoryLevelItem[];
        } catch {
          // empty
        }
      }
      if (isCanary) inventoryLevels = inventoryLevels.slice(0, 1);
      summaries.push(await migrateInventoryLevels(inventoryLevels, options));
    }

    // ── 11. Discounts ────────────────────────────────────────────────────────
    if (moduleArg === "discounts" || moduleArg === "all") {
      console.log("--- [11/11] Executing Discounts Module ---");
      const discounts = loadBackupJson<{
        id: string;
        discount: {
          __typename?: string;
          title?: string;
          status?: string;
          startsAt?: string;
          endsAt?: string | null;
          appliesOncePerCustomer?: boolean;
          usageLimit?: number | null;
          codes?: { edges?: Array<{ node: { code: string } }> };
          customerGets?: {
            value?: {
              percentage?: number;
              amount?: { amount: string; currencyCode: string };
            };
          };
        };
      }>("discounts.json").filter((d) => d.discount?.title).map((d) => {
        const disc = d.discount;
        const hasCode = "codes" in disc && (disc.codes?.edges?.length ?? 0) > 0;
        const isFreeShipping = disc.__typename === "DiscountCodeFreeShipping" || disc.__typename === "DiscountAutomaticFreeShipping";
        const percentage = disc.customerGets?.value?.percentage;
        const amount = disc.customerGets?.value?.amount?.amount;

        return {
          title: disc.title!,
          discountType: (hasCode ? "code" : "automatic") as "code" | "automatic",
          startsAt: disc.startsAt,
          endsAt: disc.endsAt,
          code: hasCode && disc.codes?.edges?.[0]?.node?.code ? disc.codes.edges[0].node.code : undefined,
          valueType: (isFreeShipping ? "free_shipping" : percentage !== undefined ? "percentage" : "fixed_amount") as "percentage" | "fixed_amount" | "free_shipping",
          value: isFreeShipping ? 0 : (percentage !== undefined ? percentage * 100 : parseFloat(amount ?? "0")),
          appliesOncePerCustomer: disc.appliesOncePerCustomer,
          usageLimit: disc.usageLimit,
        };
      });
      summaries.push(await migrateDiscounts(discounts, options));
    }

    console.log("\n=======================================================");
    console.log(" Migration Execution Summary");
    console.log("=======================================================");
    for (const s of summaries) {
      console.log(`[${s.module.toUpperCase()}]: ${s.created} created, ${s.skipped} skipped, ${s.failed} failed (${s.totalSourceItems} source items).`);
      if (s.dryRunPreview.length > 0) {
        s.dryRunPreview.slice(0, 3).forEach((p) => console.log(`   ${p}`));
        if (s.dryRunPreview.length > 3) console.log(`   ... and ${s.dryRunPreview.length - 3} more planned items.`);
      }
    }
    console.log("\n✅ Migration run complete.\n");
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("\n❌ Migration failed:", msg);
    process.exit(1);
  }
}

void main();
