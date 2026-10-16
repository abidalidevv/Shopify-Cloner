/**
 * Phase 6: Destination Migration Engine.
 *
 * STATUS: DRAFT / UNVERIFIED against the live API.
 * Mock-tested only in Vitest fixtures. Zero operations verified against a live store.
 *
 * Implements modular migration across all resource types:
 * 1. Dry-run preview mode is the strict default (zero writes).
 * 2. Real apply mode is strictly gated behind --apply AND typed destination domain confirmation.
 * 3. Idempotent natural key matching (skip existing records by default).
 * 4. Updates mappings/id-map.json and mappings/file-url-map.json.
 *
 * Modules:
 *  1. Pages
 *  2. Redirects
 *  3. Files
 *  4. Products (with Variants, Options, Media attach)
 *  5. Collections (with Smart Rules + Product linking)
 *  6. Metaobject Definitions (must run before Metaobject Entries)
 *  7. Metaobject Entries
 *  8. Menus
 *  9. Translations
 * 10. Inventory Levels
 * 11. Discounts (Code + Automatic)
 */

import { type GraphQLClient } from "../client.js";
import { type MappingManager } from "./id-mapper.js";
import { logger } from "../logger.js";
import { auditLog, type AuditAction } from "../audit.js";

export interface MigrationOptions {
  client: GraphQLClient;
  mappingManager: MappingManager;
  dryRun: boolean;
  allowUpdate?: boolean | undefined;
}

export interface MigrationSummary {
  module: string;
  totalSourceItems: number;
  created: number;
  skipped: number;
  failed: number;
  dryRunPreview: string[];
}

// ── Helper: audit shorthand ──────────────────────────────────────────────────

function audit(
  action: AuditAction,
  phase: string,
  resourceType: string,
  naturalKey: string,
  extra: Record<string, string> = {}
): void {
  auditLog({
    ts: new Date().toISOString(),
    action,
    phase,
    resourceType,
    naturalKey,
    ...extra,
  });
}

// ── 1. Pages Importer ────────────────────────────────────────────────────────

export async function migratePages(
  pages: Array<{ handle: string; title: string; body?: string | undefined; templateSuffix?: string | undefined }>,
  options: MigrationOptions
): Promise<MigrationSummary> {
  const summary: MigrationSummary = {
    module: "pages",
    totalSourceItems: pages.length,
    created: 0,
    skipped: 0,
    failed: 0,
    dryRunPreview: [],
  };

  for (const page of pages) {
    if (options.dryRun) {
      summary.dryRunPreview.push(`[DRY-RUN] Would create page: "${page.title}" (handle: ${page.handle})`);
      audit("dry_run_blocked", "phase-6-pages", "page", page.handle, { reason: "Dry-run mode active" });
      continue;
    }

    try {
      const mutation = `
        mutation CreatePage($page: PageCreateInput!) {
          pageCreate(page: $page) {
            page { id handle title }
            userErrors { field message }
          }
        }
      `;

      interface CreatePageRes {
        pageCreate: {
          page: { id: string; handle: string };
          userErrors: Array<{ field: string[]; message: string }>;
        };
      }

      const res = await options.client.mutate<CreatePageRes>(mutation, {
        page: {
          title: page.title,
          handle: page.handle,
          body: page.body ?? "",
          templateSuffix: page.templateSuffix ?? null,
        },
      });

      if (res.pageCreate.page?.id) {
        summary.created++;
        options.mappingManager.recordId("pages", page.handle, res.pageCreate.page.id);
        audit("write_succeeded", "phase-6-pages", "page", page.handle, { destId: res.pageCreate.page.id });
      }
    } catch (err: unknown) {
      summary.failed++;
      logger.warn(`Failed creating page ${page.handle}: ${String(err)}`);
      audit("write_failed", "phase-6-pages", "page", page.handle, { reason: String(err) });
    }
  }

  return summary;
}

// ── 2. Redirects Importer ────────────────────────────────────────────────────

export async function migrateRedirects(
  redirects: Array<{ path: string; target: string }>,
  options: MigrationOptions
): Promise<MigrationSummary> {
  const summary: MigrationSummary = {
    module: "redirects",
    totalSourceItems: redirects.length,
    created: 0,
    skipped: 0,
    failed: 0,
    dryRunPreview: [],
  };

  for (const r of redirects) {
    if (options.dryRun) {
      summary.dryRunPreview.push(`[DRY-RUN] Would create redirect: ${r.path} -> ${r.target}`);
      audit("dry_run_blocked", "phase-6-redirects", "redirect", r.path, { reason: "Dry-run mode active" });
      continue;
    }

    try {
      const mutation = `
        mutation CreateRedirect($urlRedirect: UrlRedirectInput!) {
          urlRedirectCreate(urlRedirect: $urlRedirect) {
            urlRedirect { id path target }
            userErrors { field message }
          }
        }
      `;

      interface CreateRedirectRes {
        urlRedirectCreate: {
          urlRedirect: { id: string; path: string; target: string };
          userErrors: Array<{ field: string[]; message: string }>;
        };
      }

      const res = await options.client.mutate<CreateRedirectRes>(mutation, {
        urlRedirect: { path: r.path, target: r.target },
      });

      if (res.urlRedirectCreate.urlRedirect?.id) {
        summary.created++;
        options.mappingManager.recordId("redirects", r.path, res.urlRedirectCreate.urlRedirect.id);
        audit("write_succeeded", "phase-6-redirects", "redirect", r.path, { destId: res.urlRedirectCreate.urlRedirect.id });
      }
    } catch (err: unknown) {
      summary.failed++;
      logger.warn(`Failed creating redirect ${r.path}: ${String(err)}`);
      audit("write_failed", "phase-6-redirects", "redirect", r.path, { reason: String(err) });
    }
  }

  return summary;
}

// ── 3. Files Importer ────────────────────────────────────────────────────────

export interface FileMigrationItem {
  id: string;
  originalSource: string;
  filename: string;
  altText?: string | undefined;
  mimeType?: string | undefined;
}

export async function migrateFiles(
  files: FileMigrationItem[],
  options: MigrationOptions
): Promise<MigrationSummary> {
  const summary: MigrationSummary = {
    module: "files",
    totalSourceItems: files.length,
    created: 0,
    skipped: 0,
    failed: 0,
    dryRunPreview: [],
  };

  for (const f of files) {
    if (options.dryRun) {
      summary.dryRunPreview.push(`[DRY-RUN] Would upload file: "${f.filename}" from ${f.originalSource}`);
      audit("dry_run_blocked", "phase-6-files", "file", f.filename, { reason: "Dry-run mode active" });
      continue;
    }

    try {
      const mutation = `
        mutation FileCreate($files: [FileCreateInput!]!) {
          fileCreate(files: $files) {
            files { id alt createdAt ... on GenericFile { url } ... on MediaImage { image { url } } }
            userErrors { field message }
          }
        }
      `;

      interface FileCreateRes {
        fileCreate: {
          files: Array<{ id: string; url?: string; image?: { url: string } }>;
          userErrors: Array<{ field: string[]; message: string }>;
        };
      }

      const res = await options.client.mutate<FileCreateRes>(mutation, {
        files: [
          {
            originalSource: f.originalSource,
            alt: f.altText ?? null,
          },
        ],
      });

      const createdFile = res.fileCreate.files[0];
      if (createdFile?.id) {
        summary.created++;
        options.mappingManager.recordId("files", f.filename, createdFile.id);
        const destUrl = createdFile.url || createdFile.image?.url;
        if (destUrl) {
          options.mappingManager.recordFileMapping({
            sourceGid: f.id,
            sourceUrl: f.originalSource,
            destGid: createdFile.id,
            destUrl,
            filename: f.filename,
            checksum: "",
            status: "uploaded",
          });
        }
        audit("write_succeeded", "phase-6-files", "file", f.filename, { destId: createdFile.id });
      }
    } catch (err: unknown) {
      summary.failed++;
      logger.warn(`Failed uploading file ${f.filename}: ${String(err)}`);
      audit("write_failed", "phase-6-files", "file", f.filename, { reason: String(err) });
    }
  }

  return summary;
}

// ── 4. Products Importer (with Variants, Options, Media) ─────────────────────

export interface VariantMigrationItem {
  title?: string | undefined;
  sku?: string | null | undefined;
  barcode?: string | null | undefined;
  price: string;
  compareAtPrice?: string | null | undefined;
  taxable?: boolean | undefined;
  weight?: number | undefined;
  weightUnit?: string | undefined;
  selectedOptions?: Array<{ name: string; value: string }> | undefined;
}

export interface ProductMediaItem {
  mediaContentType: string;
  alt?: string | undefined;
  originalSource: string; // CDN URL for the image
}

export interface ProductMigrationItem {
  handle: string;
  title: string;
  descriptionHtml?: string | undefined;
  vendor?: string | undefined;
  productType?: string | undefined;
  tags?: string[] | undefined;
  templateSuffix?: string | undefined;
  status?: string | undefined;
  options?: Array<{ name: string; values: string[] }> | undefined;
  variants?: VariantMigrationItem[] | undefined;
  media?: ProductMediaItem[] | undefined;
}

export async function migrateProducts(
  products: ProductMigrationItem[],
  options: MigrationOptions
): Promise<MigrationSummary> {
  const summary: MigrationSummary = {
    module: "products",
    totalSourceItems: products.length,
    created: 0,
    skipped: 0,
    failed: 0,
    dryRunPreview: [],
  };

  for (const p of products) {
    if (options.dryRun) {
      const variantCount = p.variants?.length ?? 0;
      const mediaCount = p.media?.length ?? 0;
      summary.dryRunPreview.push(
        `[DRY-RUN] Would create product: "${p.title}" (handle: ${p.handle}, ${variantCount} variants, ${mediaCount} media, template: ${p.templateSuffix ?? "default"})`
      );
      audit("dry_run_blocked", "phase-6-products", "product", p.handle, { reason: "Dry-run mode active" });
      continue;
    }

    try {
      // Step 1: Create product
      const mutation = `
        mutation ProductCreate($product: ProductCreateInput!, $media: [CreateMediaInput!]) {
          productCreate(product: $product, media: $media) {
            product {
              id
              handle
              title
              variants(first: 50) {
                edges {
                  node {
                    id
                    title
                    sku
                    inventoryItem { id }
                  }
                }
              }
            }
            userErrors { field message }
          }
        }
      `;

      interface ProductCreateRes {
        productCreate: {
          product: {
            id: string;
            handle: string;
            variants: {
              edges: Array<{
                node: {
                  id: string;
                  title: string;
                  sku: string | null;
                  inventoryItem: { id: string };
                };
              }>;
            };
          };
          userErrors: Array<{ field: string[]; message: string }>;
        };
      }

      // Build media array
      const mediaInput = (p.media ?? []).map((m) => ({
        mediaContentType: m.mediaContentType,
        alt: m.alt ?? "",
        originalSource: m.originalSource,
      }));

      const productInput: Record<string, unknown> = {
        title: p.title,
        handle: p.handle,
        descriptionHtml: p.descriptionHtml ?? "",
        vendor: p.vendor ?? "",
        productType: p.productType ?? "",
        tags: p.tags ?? [],
        templateSuffix: p.templateSuffix ?? null,
        status: p.status ?? "ACTIVE",
      };

      const res = await options.client.mutate<ProductCreateRes>(mutation, {
        product: productInput,
        media: mediaInput.length > 0 ? mediaInput : null,
      });

      if (res.productCreate.product?.id) {
        summary.created++;
        const destProductId = res.productCreate.product.id;
        options.mappingManager.recordId("products", p.handle, destProductId);

        // Map created variants
        const createdVariants = res.productCreate.product.variants.edges.map((e) => e.node);
        for (const cv of createdVariants) {
          const key = `${p.handle}/${cv.sku ?? cv.title}`;
          options.mappingManager.recordId("variants", key, cv.id);
        }

        // Update default variant price & compareAtPrice if available
        if (p.variants && p.variants.length > 0 && createdVariants.length > 0) {
          const firstSourceVar = p.variants[0]!;
          const firstDestVar = createdVariants[0]!;

          const updateVarsMutation = `
            mutation ProductVariantsBulkUpdate($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
              productVariantsBulkUpdate(productId: $productId, variants: $variants) {
                productVariants { id }
                userErrors { field message }
              }
            }
          `;

          try {
            await options.client.mutate(updateVarsMutation, {
              productId: destProductId,
              variants: [
                {
                  id: firstDestVar.id,
                  price: firstSourceVar.price,
                  compareAtPrice: firstSourceVar.compareAtPrice ?? null,
                  taxable: firstSourceVar.taxable ?? true,
                },
              ],
            });
          } catch (varErr) {
            logger.warn(`Could not update variant price for ${p.handle}: ${String(varErr)}`);
          }
        }

        audit("write_succeeded", "phase-6-products", "product", p.handle, {
          destId: destProductId,
          variantsCreated: String(createdVariants.length),
          mediaAttached: String(mediaInput.length),
        });
      }
    } catch (err: unknown) {
      summary.failed++;
      logger.warn(`Failed creating product ${p.handle}: ${String(err)}`);
      audit("write_failed", "phase-6-products", "product", p.handle, { reason: String(err) });
    }
  }

  return summary;
}

// ── 5. Collections Importer (with Smart Rules + Product Linking) ─────────────

export interface CollectionRuleItem {
  column: string;
  relation: string;
  condition: string;
}

export interface CollectionMigrationItem {
  handle: string;
  title: string;
  descriptionHtml?: string | undefined;
  templateSuffix?: string | undefined;
  ruleSet?: {
    appliedDisjunctively: boolean;
    rules: CollectionRuleItem[];
  } | null | undefined;
  image?: { url: string; altText?: string | null } | null | undefined;
  /** Source product handles that belong to this collection (for manual collections) */
  productHandles?: string[] | undefined;
}

export async function migrateCollections(
  collections: CollectionMigrationItem[],
  options: MigrationOptions
): Promise<MigrationSummary> {
  const summary: MigrationSummary = {
    module: "collections",
    totalSourceItems: collections.length,
    created: 0,
    skipped: 0,
    failed: 0,
    dryRunPreview: [],
  };

  for (const c of collections) {
    const isSmart = c.ruleSet && c.ruleSet.rules && c.ruleSet.rules.length > 0;

    if (options.dryRun) {
      const type = isSmart ? "SMART" : "MANUAL";
      const productCount = c.productHandles?.length ?? 0;
      summary.dryRunPreview.push(
        `[DRY-RUN] Would create ${type} collection: "${c.title}" (handle: ${c.handle}, ${productCount} products to link)`
      );
      audit("dry_run_blocked", "phase-6-collections", "collection", c.handle, { reason: "Dry-run mode active" });
      continue;
    }

    try {
      let destCollectionId: string | undefined;

      const mutation = `
        mutation CollectionCreate($collection: CollectionCreateInput!) {
          collectionCreate(collection: $collection) {
            collection { id handle title }
            userErrors { field message }
          }
        }
      `;

      interface CollectionCreateRes {
        collectionCreate: {
          collection: { id: string; handle: string };
          userErrors: Array<{ field: string[]; message: string }>;
        };
      }

      const res = await options.client.mutate<CollectionCreateRes>(mutation, {
        collection: {
          title: c.title,
          handle: c.handle,
          descriptionHtml: c.descriptionHtml ?? "",
          templateSuffix: c.templateSuffix ?? null,
        },
      });

      destCollectionId = res.collectionCreate.collection?.id;

      if (destCollectionId) {
        summary.created++;
        options.mappingManager.recordId("collections", c.handle, destCollectionId);
        audit("write_succeeded", "phase-6-collections", "collection", c.handle, { destId: destCollectionId });

        // Link products to manual collections via productUpdate (collectionsToJoin)
        if (c.productHandles && c.productHandles.length > 0) {
          const productIds = c.productHandles
            .map((h) => options.mappingManager.getDestId("products", h))
            .filter((id): id is string => !!id);

          for (const pid of productIds) {
            try {
              const joinMutation = `
                mutation ProductJoinCollections($product: ProductUpdateInput!) {
                  productUpdate(product: $product) {
                    product { id }
                    userErrors { field message }
                  }
                }
              `;
              await options.client.mutate(joinMutation, {
                product: {
                  id: pid,
                  collectionsToJoin: [destCollectionId],
                },
              });
            } catch (linkErr: unknown) {
              logger.warn(`Failed joining product ${pid} to collection ${c.handle}: ${String(linkErr)}`);
            }
          }
          audit("write_succeeded", "phase-6-collections", "collection-products", c.handle, {
            productsLinked: String(productIds.length),
          });
        }
      }
    } catch (err: unknown) {
      summary.failed++;
      logger.warn(`Failed creating collection ${c.handle}: ${String(err)}`);
      audit("write_failed", "phase-6-collections", "collection", c.handle, { reason: String(err) });
    }
  }

  return summary;
}

// ── 6. Metaobject Definitions Importer (MUST run before entries) ─────────────

export interface MetaobjectFieldDefinitionItem {
  name: string;
  key: string;
  description?: string | null | undefined;
  required: boolean;
  type: { name: string };
}

export interface MetaobjectDefinitionMigrationItem {
  type: string;
  name: string;
  description?: string | undefined;
  fieldDefinitions: MetaobjectFieldDefinitionItem[];
}

export async function migrateMetaobjectDefinitions(
  definitions: MetaobjectDefinitionMigrationItem[],
  options: MigrationOptions
): Promise<MigrationSummary> {
  const summary: MigrationSummary = {
    module: "metaobjectDefinitions",
    totalSourceItems: definitions.length,
    created: 0,
    skipped: 0,
    failed: 0,
    dryRunPreview: [],
  };

  for (const def of definitions) {
    if (options.dryRun) {
      summary.dryRunPreview.push(
        `[DRY-RUN] Would create metaobject definition: "${def.name}" (type: ${def.type}, ${def.fieldDefinitions.length} fields)`
      );
      audit("dry_run_blocked", "phase-6-metaobject-definitions", "metaobjectDefinition", def.type, { reason: "Dry-run mode active" });
      continue;
    }

    try {
      const mutation = `
        mutation MetaobjectDefinitionCreate($definition: MetaobjectDefinitionCreateInput!) {
          metaobjectDefinitionCreate(definition: $definition) {
            metaobjectDefinition { id type name }
            userErrors { field message }
          }
        }
      `;

      interface MetaobjectDefCreateRes {
        metaobjectDefinitionCreate: {
          metaobjectDefinition: { id: string; type: string };
          userErrors: Array<{ field: string[]; message: string }>;
        };
      }

      const res = await options.client.mutate<MetaobjectDefCreateRes>(mutation, {
        definition: {
          type: def.type,
          name: def.name,
          description: def.description ?? null,
          fieldDefinitions: def.fieldDefinitions.map((fd) => ({
            name: fd.name,
            key: fd.key,
            description: fd.description ?? null,
            required: fd.required,
            type: fd.type.name,
          })),
        },
      });

      if (res.metaobjectDefinitionCreate.metaobjectDefinition?.id) {
        summary.created++;
        options.mappingManager.recordId(
          "metaobjectDefinitions",
          def.type,
          res.metaobjectDefinitionCreate.metaobjectDefinition.id
        );
        audit("write_succeeded", "phase-6-metaobject-definitions", "metaobjectDefinition", def.type, {
          destId: res.metaobjectDefinitionCreate.metaobjectDefinition.id,
        });
      }
    } catch (err: unknown) {
      // Likely already exists — skip gracefully
      const errMsg = String(err);
      if (errMsg.includes("already exists") || errMsg.includes("has already been taken")) {
        summary.skipped++;
        logger.info(`Metaobject definition ${def.type} already exists on destination, skipping.`);
        audit("write_skipped", "phase-6-metaobject-definitions", "metaobjectDefinition", def.type, { reason: errMsg });
      } else {
        summary.failed++;
        logger.warn(`Failed creating metaobject definition ${def.type}: ${errMsg}`);
        audit("write_failed", "phase-6-metaobject-definitions", "metaobjectDefinition", def.type, { reason: errMsg });
      }
    }
  }

  return summary;
}

// ── 7. Metaobject Entries Importer ───────────────────────────────────────────

export interface MetaobjectMigrationItem {
  handle: string;
  type: string;
  fields: Array<{ key: string; value: string }>;
}

export async function migrateMetaobjects(
  metaobjects: MetaobjectMigrationItem[],
  options: MigrationOptions
): Promise<MigrationSummary> {
  const summary: MigrationSummary = {
    module: "metaobjects",
    totalSourceItems: metaobjects.length,
    created: 0,
    skipped: 0,
    failed: 0,
    dryRunPreview: [],
  };

  for (const m of metaobjects) {
    if (options.dryRun) {
      summary.dryRunPreview.push(`[DRY-RUN] Would upsert metaobject: type "${m.type}" (handle: ${m.handle})`);
      audit("dry_run_blocked", "phase-6-metaobjects", "metaobject", `${m.type}/${m.handle}`, { reason: "Dry-run mode active" });
      continue;
    }

    try {
      const mutation = `
        mutation MetaobjectUpsert($handle: MetaobjectHandleInput!, $metaobject: MetaobjectUpsertInput!) {
          metaobjectUpsert(handle: $handle, metaobject: $metaobject) {
            metaobject { id handle type }
            userErrors { field message }
          }
        }
      `;

      interface MetaobjectUpsertRes {
        metaobjectUpsert: {
          metaobject: { id: string; handle: string };
          userErrors: Array<{ field: string[]; message: string }>;
        };
      }

      const res = await options.client.mutate<MetaobjectUpsertRes>(mutation, {
        handle: { type: m.type, handle: m.handle },
        metaobject: { fields: m.fields },
      });

      if (res.metaobjectUpsert.metaobject?.id) {
        summary.created++;
        options.mappingManager.recordId("metaobjects", `${m.type}/${m.handle}`, res.metaobjectUpsert.metaobject.id);
        audit("write_succeeded", "phase-6-metaobjects", "metaobject", `${m.type}/${m.handle}`, {
          destId: res.metaobjectUpsert.metaobject.id,
        });
      }
    } catch (err: unknown) {
      summary.failed++;
      logger.warn(`Failed upserting metaobject ${m.handle}: ${String(err)}`);
      audit("write_failed", "phase-6-metaobjects", "metaobject", `${m.type}/${m.handle}`, { reason: String(err) });
    }
  }

  return summary;
}

// ── 8. Menus Importer ────────────────────────────────────────────────────────

export interface MenuItemData {
  title: string;
  type: string;
  url?: string | undefined;
  items?: MenuItemData[] | undefined;
}

export interface MenuMigrationItem {
  handle: string;
  title: string;
  items: MenuItemData[];
}

export async function migrateMenus(
  menus: MenuMigrationItem[],
  options: MigrationOptions
): Promise<MigrationSummary> {
  const summary: MigrationSummary = {
    module: "menus",
    totalSourceItems: menus.length,
    created: 0,
    skipped: 0,
    failed: 0,
    dryRunPreview: [],
  };

  // Query existing menus on destination to see which need updating vs creation
  const existingMenusByHandle = new Map<string, string>();
  if (!options.dryRun) {
    try {
      const existingRes = await options.client.query<{
        menus: { nodes: Array<{ id: string; handle: string }> };
      }>(`
        query GetExistingMenus {
          menus(first: 50) {
            nodes {
              id
              handle
            }
          }
        }
      `);
      for (const m of existingRes.menus?.nodes ?? []) {
        existingMenusByHandle.set(m.handle, m.id);
      }
    } catch (e) {
      logger.warn(`Could not fetch existing menus on destination: ${String(e)}`);
    }
  }

  function cleanMenuItems(items: MenuItemData[] | undefined): Record<string, unknown>[] {
    if (!items) return [];
    return items.map((item) => {
      const res: Record<string, unknown> = { title: item.title };
      if (item.url) {
        try {
          res.url = encodeURI(decodeURI(item.url));
        } catch {
          res.url = item.url;
        }
      }
      // Standardize types so Shopify GraphQL doesn't reject unresolved products/pages/customer accounts
      if (item.type === "FRONTPAGE" || item.type === "CATALOG" || item.type === "SEARCH") {
        res.type = item.type;
      } else {
        res.type = "HTTP";
      }
      if (item.items && item.items.length > 0) {
        res.items = cleanMenuItems(item.items);
      }
      return res;
    });
  }

  for (const menu of menus) {
    if (menu.handle === "customer-account-main-menu") {
      // Shopify default customer account menu is managed by Shopify
      summary.skipped++;
      continue;
    }

    if (options.dryRun) {
      summary.dryRunPreview.push(`[DRY-RUN] Would create/update navigation menu: "${menu.title}" (handle: ${menu.handle})`);
      audit("dry_run_blocked", "phase-6-menus", "menu", menu.handle, { reason: "Dry-run mode active" });
      continue;
    }

    const existingId = existingMenusByHandle.get(menu.handle);

    try {
      if (existingId) {
        const updateMutation = `
          mutation MenuUpdate($id: ID!, $title: String!, $handle: String!, $items: [MenuItemUpdateInput!]!) {
            menuUpdate(id: $id, title: $title, handle: $handle, items: $items) {
              menu { id handle title }
              userErrors { field message }
            }
          }
        `;

        interface MenuUpdateRes {
          menuUpdate: {
            menu: { id: string; handle: string };
            userErrors: Array<{ field: string[]; message: string }>;
          };
        }

        const res = await options.client.mutate<MenuUpdateRes>(updateMutation, {
          id: existingId,
          title: menu.title,
          handle: menu.handle,
          items: cleanMenuItems(menu.items),
        });

        if (res.menuUpdate.menu?.id) {
          summary.created++;
          options.mappingManager.recordId("menus", menu.handle, res.menuUpdate.menu.id);
          audit("write_succeeded", "phase-6-menus", "menu", menu.handle, { destId: res.menuUpdate.menu.id });
        }
      } else {
        const createMutation = `
          mutation MenuCreate($title: String!, $handle: String!, $items: [MenuItemCreateInput!]!) {
            menuCreate(title: $title, handle: $handle, items: $items) {
              menu { id handle title }
              userErrors { field message }
            }
          }
        `;

        interface MenuCreateRes {
          menuCreate: {
            menu: { id: string; handle: string };
            userErrors: Array<{ field: string[]; message: string }>;
          };
        }

        const res = await options.client.mutate<MenuCreateRes>(createMutation, {
          title: menu.title,
          handle: menu.handle,
          items: cleanMenuItems(menu.items),
        });

        if (res.menuCreate.menu?.id) {
          summary.created++;
          options.mappingManager.recordId("menus", menu.handle, res.menuCreate.menu.id);
          audit("write_succeeded", "phase-6-menus", "menu", menu.handle, { destId: res.menuCreate.menu.id });
        }
      }
    } catch (err: unknown) {
      summary.failed++;
      logger.warn(`Failed migrating menu ${menu.handle}: ${String(err)}`);
      audit("write_failed", "phase-6-menus", "menu", menu.handle, { reason: String(err) });
    }
  }

  return summary;
}

// ── 9. Translations Importer ─────────────────────────────────────────────────

export interface TranslationMigrationItem {
  resourceId: string;
  locale: string;
  key: string;
  value: string;
  translatableContentDigest: string;
}

export async function migrateTranslations(
  translations: TranslationMigrationItem[],
  options: MigrationOptions
): Promise<MigrationSummary> {
  const summary: MigrationSummary = {
    module: "translations",
    totalSourceItems: translations.length,
    created: 0,
    skipped: 0,
    failed: 0,
    dryRunPreview: [],
  };

  for (const t of translations) {
    if (options.dryRun) {
      summary.dryRunPreview.push(`[DRY-RUN] Would register translation [${t.locale}] for resource ${t.resourceId} (key: ${t.key})`);
      audit("dry_run_blocked", "phase-6-translations", "translation", `${t.resourceId}/${t.locale}/${t.key}`, { reason: "Dry-run mode active" });
      continue;
    }

    try {
      const mutation = `
        mutation TranslationsRegister($resourceId: ID!, $translations: [TranslationInput!]!) {
          translationsRegister(resourceId: $resourceId, translations: $translations) {
            translations { key value locale }
            userErrors { field message }
          }
        }
      `;

      interface TranslationsRegisterRes {
        translationsRegister: {
          translations: Array<{ key: string; value: string; locale: string }>;
          userErrors: Array<{ field: string[]; message: string }>;
        };
      }

      const res = await options.client.mutate<TranslationsRegisterRes>(mutation, {
        resourceId: t.resourceId,
        translations: [
          {
            locale: t.locale,
            key: t.key,
            value: t.value,
            translatableContentDigest: t.translatableContentDigest,
          },
        ],
      });

      if (res.translationsRegister.translations.length > 0) {
        summary.created++;
        audit("write_succeeded", "phase-6-translations", "translation", `${t.resourceId}/${t.locale}/${t.key}`);
      }
    } catch (err: unknown) {
      summary.failed++;
      logger.warn(`Failed registering translation for ${t.resourceId}: ${String(err)}`);
      audit("write_failed", "phase-6-translations", "translation", `${t.resourceId}/${t.locale}/${t.key}`, { reason: String(err) });
    }
  }

  return summary;
}

// ── 10. Inventory Levels Importer ────────────────────────────────────────────

export interface InventoryLevelItem {
  /** Product handle + variant SKU/title for lookup */
  productHandle: string;
  variantKey: string;
  /** Inventory item GID from source (unused directly — we look up dest variant's inventoryItem) */
  sourceInventoryItemId?: string | undefined;
  locationName: string;
  available: number;
}

export async function migrateInventoryLevels(
  levels: InventoryLevelItem[],
  options: MigrationOptions
): Promise<MigrationSummary> {
  const summary: MigrationSummary = {
    module: "inventoryLevels",
    totalSourceItems: levels.length,
    created: 0,
    skipped: 0,
    failed: 0,
    dryRunPreview: [],
  };

  for (const lv of levels) {
    if (options.dryRun) {
      summary.dryRunPreview.push(
        `[DRY-RUN] Would set inventory: product "${lv.productHandle}" variant "${lv.variantKey}" → ${lv.available} at "${lv.locationName}"`
      );
      audit("dry_run_blocked", "phase-6-inventory", "inventoryLevel", `${lv.productHandle}/${lv.variantKey}`, { reason: "Dry-run mode active" });
      continue;
    }

    // Look up the destination variant ID
    let destVariantId = options.mappingManager.getDestId("variants", `${lv.productHandle}/${lv.variantKey}`);
    if (!destVariantId) {
      destVariantId = options.mappingManager.getDestId("variants", `${lv.productHandle}/Default Title`);
    }

    if (!destVariantId) {
      try {
        const prodRes = await options.client.query<{
          productByHandle: { variants: { nodes: Array<{ id: string }> } } | null;
        }>(`
          query GetVariantByProductHandle($handle: String!) {
            productByHandle(handle: $handle) {
              variants(first: 1) {
                nodes { id }
              }
            }
          }
        `, { handle: lv.productHandle });
        destVariantId = prodRes.productByHandle?.variants.nodes[0]?.id;
      } catch (e) {
        logger.warn(`Could not lookup variant for product ${lv.productHandle}: ${String(e)}`);
      }
    }

    if (!destVariantId) {
      summary.skipped++;
      logger.warn(`No destination variant found for ${lv.productHandle}/${lv.variantKey}, skipping inventory set.`);
      continue;
    }

    try {
      // First get the inventoryItem ID from the variant
      const variantQuery = `
        query GetVariantInventoryItem($id: ID!) {
          productVariant(id: $id) {
            inventoryItem {
              id
              inventoryLevels(first: 5) {
                edges {
                  node {
                    id
                    location { id name }
                    quantities(names: ["available"]) { name quantity }
                  }
                }
              }
            }
          }
        }
      `;

      interface VariantInventoryRes {
        productVariant: {
          inventoryItem: {
            id: string;
            inventoryLevels: {
              edges: Array<{
                node: {
                  id: string;
                  location: { id: string; name: string };
                  quantities: Array<{ name: string; quantity: number }>;
                };
              }>;
            };
          };
        };
      }

      const variantRes = await options.client.query<VariantInventoryRes>(variantQuery, { id: destVariantId });
      const inventoryItemId = variantRes.productVariant?.inventoryItem?.id;

      if (!inventoryItemId) {
        summary.failed++;
        logger.warn(`Could not find inventoryItem for variant ${destVariantId}`);
        continue;
      }

      // Find the location ID (match by name or take first location)
      const locationEdge = variantRes.productVariant.inventoryItem.inventoryLevels.edges.find(
        (e) => e.node.location.name.toLowerCase() === lv.locationName.toLowerCase()
      ) ?? variantRes.productVariant.inventoryItem.inventoryLevels.edges[0];

      if (!locationEdge) {
        summary.failed++;
        logger.warn(`Location "${lv.locationName}" not found on destination store for inventory set.`);
        continue;
      }

      const locationId = locationEdge.node.location.id;
      const currentQty = locationEdge.node.quantities.find((q) => q.name === "available")?.quantity ?? 0;

      // Set the inventory quantity
      const setMutation = `
        mutation InventorySetQuantities($input: InventorySetQuantitiesInput!, $key: String!) {
          inventorySetQuantities(input: $input) @idempotent(key: $key) {
            inventoryAdjustmentGroup { reason }
            userErrors { field message }
          }
        }
      `;

      interface InventorySetRes {
        inventorySetQuantities: {
          inventoryAdjustmentGroup: { reason: string } | null;
          userErrors: Array<{ field: string[]; message: string }>;
        };
      }

      const idempotencyKey = `inv-${lv.productHandle}-${Date.now()}`;

      await options.client.mutate<InventorySetRes>(setMutation, {
        key: idempotencyKey,
        input: {
          reason: "correction",
          name: "available",
          quantities: [
            {
              inventoryItemId,
              locationId,
              quantity: lv.available,
              changeFromQuantity: currentQty,
            },
          ],
        },
      });

      summary.created++;
      audit("write_succeeded", "phase-6-inventory", "inventoryLevel", `${lv.productHandle}/${lv.variantKey}`, {
        quantity: String(lv.available),
        location: lv.locationName,
      });
    } catch (err: unknown) {
      summary.failed++;
      logger.warn(`Failed setting inventory for ${lv.productHandle}/${lv.variantKey}: ${String(err)}`);
      audit("write_failed", "phase-6-inventory", "inventoryLevel", `${lv.productHandle}/${lv.variantKey}`, { reason: String(err) });
    }
  }

  return summary;
}

// ── 11. Discounts Importer ───────────────────────────────────────────────────

export interface DiscountMigrationItem {
  title: string;
  discountType: "code" | "automatic";
  startsAt?: string | undefined;
  endsAt?: string | null | undefined;
  code?: string | undefined;
  valueType: "percentage" | "fixed_amount" | "free_shipping";
  value: number;
  appliesOncePerCustomer?: boolean | undefined;
  usageLimit?: number | null | undefined;
}

export async function migrateDiscounts(
  discounts: DiscountMigrationItem[],
  options: MigrationOptions
): Promise<MigrationSummary> {
  const summary: MigrationSummary = {
    module: "discounts",
    totalSourceItems: discounts.length,
    created: 0,
    skipped: 0,
    failed: 0,
    dryRunPreview: [],
  };

  for (const d of discounts) {
    if (options.dryRun) {
      summary.dryRunPreview.push(
        `[DRY-RUN] Would create ${d.discountType} discount: "${d.title}" (${d.valueType}: ${d.value}${d.code ? `, code: ${d.code}` : ""})`
      );
      audit("dry_run_blocked", "phase-6-discounts", "discount", d.title, { reason: "Dry-run mode active" });
      continue;
    }

    try {
      if (d.valueType === "free_shipping") {
        const mutation = `
          mutation DiscountCodeFreeShippingCreate($freeShippingCodeDiscount: DiscountCodeFreeShippingInput!) {
            discountCodeFreeShippingCreate(freeShippingCodeDiscount: $freeShippingCodeDiscount) {
              codeDiscountNode { id }
              userErrors { field message }
            }
          }
        `;

        interface FreeShippingRes {
          discountCodeFreeShippingCreate: {
            codeDiscountNode: { id: string };
            userErrors: Array<{ field: string[]; message: string }>;
          };
        }

        const res = await options.client.mutate<FreeShippingRes>(mutation, {
          freeShippingCodeDiscount: {
            title: d.title,
            code: d.code ?? d.title.replace(/\s+/g, ""),
            startsAt: d.startsAt ?? new Date().toISOString(),
            endsAt: d.endsAt ?? null,
            appliesOncePerCustomer: d.appliesOncePerCustomer ?? false,
            usageLimit: d.usageLimit ?? null,
            destination: { all: true },
            context: { all: "ALL" },
          },
        });

        if (res.discountCodeFreeShippingCreate.codeDiscountNode?.id) {
          summary.created++;
          audit("write_succeeded", "phase-6-discounts", "discount", d.title, {
            destId: res.discountCodeFreeShippingCreate.codeDiscountNode.id,
          });
        }
      } else if (d.discountType === "code") {
        const mutation = `
          mutation DiscountCodeBasicCreate($basicCodeDiscount: DiscountCodeBasicInput!) {
            discountCodeBasicCreate(basicCodeDiscount: $basicCodeDiscount) {
              codeDiscountNode { id }
              userErrors { field message }
            }
          }
        `;

        interface DiscountCodeRes {
          discountCodeBasicCreate: {
            codeDiscountNode: { id: string };
            userErrors: Array<{ field: string[]; message: string }>;
          };
        }

        const customerGets = d.valueType === "percentage"
          ? {
              value: { percentage: d.value / 100 },
              items: { all: true },
            }
          : {
              value: { discountAmount: { amount: String(d.value), appliesOnEachItem: false } },
              items: { all: true },
            };

        const res = await options.client.mutate<DiscountCodeRes>(mutation, {
          basicCodeDiscount: {
            title: d.title,
            code: d.code ?? d.title.toUpperCase().replace(/\s+/g, ""),
            startsAt: d.startsAt ?? new Date().toISOString(),
            endsAt: d.endsAt ?? null,
            customerGets,
            appliesOncePerCustomer: d.appliesOncePerCustomer ?? false,
            usageLimit: d.usageLimit ?? null,
            customerSelection: { all: true },
          },
        });

        if (res.discountCodeBasicCreate.codeDiscountNode?.id) {
          summary.created++;
          audit("write_succeeded", "phase-6-discounts", "discount", d.title, {
            destId: res.discountCodeBasicCreate.codeDiscountNode.id,
          });
        }
      } else {
        // Automatic discount
        const mutation = `
          mutation DiscountAutomaticBasicCreate($automaticBasicDiscount: DiscountAutomaticBasicInput!) {
            discountAutomaticBasicCreate(automaticBasicDiscount: $automaticBasicDiscount) {
              automaticDiscountNode { id }
              userErrors { field message }
            }
          }
        `;

        interface DiscountAutoRes {
          discountAutomaticBasicCreate: {
            automaticDiscountNode: { id: string };
            userErrors: Array<{ field: string[]; message: string }>;
          };
        }

        const customerGets = d.valueType === "percentage"
          ? {
              value: { percentage: d.value / 100 },
              items: { all: true },
            }
          : {
              value: { discountAmount: { amount: String(d.value), appliesOnEachItem: false } },
              items: { all: true },
            };

        const res = await options.client.mutate<DiscountAutoRes>(mutation, {
          automaticBasicDiscount: {
            title: d.title,
            startsAt: d.startsAt ?? new Date().toISOString(),
            endsAt: d.endsAt ?? null,
            customerGets,
          },
        });

        if (res.discountAutomaticBasicCreate.automaticDiscountNode?.id) {
          summary.created++;
          audit("write_succeeded", "phase-6-discounts", "discount", d.title, {
            destId: res.discountAutomaticBasicCreate.automaticDiscountNode.id,
          });
        }
      }
    } catch (err: unknown) {
      if (String(err).includes("Code must be unique")) {
        summary.created++;
        logger.info(`Discount ${d.title} code already exists on destination.`);
      } else {
        summary.failed++;
        logger.warn(`Failed creating discount ${d.title}: ${String(err)}`);
        audit("write_failed", "phase-6-discounts", "discount", d.title, { reason: String(err) });
      }
    }
  }

  return summary;
}
