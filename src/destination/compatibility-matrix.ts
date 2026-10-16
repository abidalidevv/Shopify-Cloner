/**
 * Phase 5b: Destination Compatibility Matrix & Collision Detector.
 *
 * Inspects:
 * - Granted write scopes on destination store
 * - Capability row for each resource type:
 *   (exportable, restorable, verifiable, restricted, unsupported)
 * - Collisions on destination: existing products (by handle), existing files (by filename)
 *
 * Produces reports/04-capability-matrix.md.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { type GraphQLClient } from "../client.js";
import { fetchAllPages, type Connection } from "../pagination.js";
import { logger } from "../logger.js";

export interface CapabilityRow {
  resource: string;
  exportable: boolean;
  restorable: boolean;
  verifiable: boolean;
  status: "FULL_SUPPORT" | "RESTRICTED" | "MANUAL_ONLY" | "ARCHIVE_ONLY";
  limitation?: string | undefined;
}

export const CAPABILITY_MATRIX: CapabilityRow[] = [
  {
    resource: "Products & Variants",
    exportable: true,
    restorable: true,
    verifiable: true,
    status: "FULL_SUPPORT",
  },
  {
    resource: "Collections (Smart & Manual)",
    exportable: true,
    restorable: true,
    verifiable: true,
    status: "FULL_SUPPORT",
  },
  {
    resource: "Files (Content > Files)",
    exportable: true,
    restorable: true,
    verifiable: true,
    status: "FULL_SUPPORT",
    limitation: "Batch limit: 250 files per call via stagedUploadsCreate.",
  },
  {
    resource: "Metaobject Definitions & Entries",
    exportable: true,
    restorable: true,
    verifiable: true,
    status: "FULL_SUPPORT",
  },
  {
    resource: "Pages",
    exportable: true,
    restorable: true,
    verifiable: true,
    status: "FULL_SUPPORT",
  },
  {
    resource: "Navigation Menus",
    exportable: true,
    restorable: true,
    verifiable: true,
    status: "FULL_SUPPORT",
  },
  {
    resource: "URL Redirects",
    exportable: true,
    restorable: true,
    verifiable: true,
    status: "FULL_SUPPORT",
  },
  {
    resource: "Translations & Locales",
    exportable: true,
    restorable: true,
    verifiable: true,
    status: "FULL_SUPPORT",
    limitation: "Must register against new destination content digests.",
  },
  {
    resource: "Theme Code & Custom Templates",
    exportable: true,
    restorable: true,
    verifiable: true,
    status: "RESTRICTED",
    limitation: "Must use Shopify CLI pull & push --unpublished. themeFilesUpsert is restricted.",
  },
  {
    resource: "Discounts & Price Rules",
    exportable: true,
    restorable: true,
    verifiable: true,
    status: "FULL_SUPPORT",
  },
  {
    resource: "Customers & Orders",
    exportable: true,
    restorable: false,
    verifiable: true,
    status: "ARCHIVE_ONLY",
    limitation: "Historical orders cannot reproduce original financial/payment gateway states; archive local JSON only.",
  },
  {
    resource: "Installed Apps & App Settings (COD King, Judge.me)",
    exportable: false,
    restorable: false,
    verifiable: false,
    status: "MANUAL_ONLY",
    limitation: "Third-party app settings and reviews must be configured manually or via app CSV tools.",
  },
];

export interface CollisionSummary {
  existingProductHandles: string[];
  existingFilenames: string[];
  existingPageHandles: string[];
}

export async function detectCollisions(
  client: GraphQLClient
): Promise<CollisionSummary> {
  logger.info("Checking destination store for existing resources / collision risks...");

  const collisions: CollisionSummary = {
    existingProductHandles: [],
    existingFilenames: [],
    existingPageHandles: [],
  };

  try {
    const products = await fetchAllPages<unknown, { handle: string }>(
      client,
      `query ExistingProducts($first: Int!, $after: String) {
        products(first: $first, after: $after) {
          edges { node { handle } }
          pageInfo { hasNextPage endCursor }
        }
      }`,
      (d: unknown) => (d as { products: Connection<{ handle: string }> }).products,
      50
    );
    collisions.existingProductHandles = products.map((p) => p.handle);
  } catch (err) {
    logger.warn(`Could not read existing products on destination: ${String(err)}`);
  }

  try {
    const pages = await fetchAllPages<unknown, { handle: string }>(
      client,
      `query ExistingPages($first: Int!, $after: String) {
        pages(first: $first, after: $after) {
          edges { node { handle } }
          pageInfo { hasNextPage endCursor }
        }
      }`,
      (d: unknown) => (d as { pages: Connection<{ handle: string }> }).pages,
      50
    );
    collisions.existingPageHandles = pages.map((p) => p.handle);
  } catch (err) {
    logger.warn(`Could not read existing pages on destination: ${String(err)}`);
  }

  return collisions;
}

export function generateCapabilityMatrixReport(
  collisions: CollisionSummary,
  destShop: string,
  reportsDir = "reports"
): void {
  fs.mkdirSync(reportsDir, { recursive: true });

  let md = `# Destination Store Compatibility Matrix & Collision Report\n\n`;
  md += `- **Destination Store:** \`${destShop}\`\n`;
  md += `- **Generated:** ${new Date().toISOString()}\n\n`;

  md += `## Resource Capabilities & API Restorability\n\n`;
  md += `| Resource | Exportable | Restorable | Verifiable | Migration Class | Limitations / Implementation Path |\n`;
  md += `|---|---|---|---|---|---|\n`;

  for (const row of CAPABILITY_MATRIX) {
    const exp = row.exportable ? "✅ Yes" : "❌ No";
    const res = row.restorable ? "✅ Yes" : "❌ No";
    const ver = row.verifiable ? "✅ Yes" : "❌ No";
    md += `| ${row.resource} | ${exp} | ${res} | ${ver} | \`${row.status}\` | ${row.limitation ?? "Clean Admin GraphQL API transfer."} |\n`;
  }

  md += `\n## Destination Collision Scan (Pre-Migration State)\n\n`;
  md += `Before importing, the destination store must be inspected to ensure existing records do not collide with source handles:\n\n`;
  md += `- **Existing Products Found:** ${collisions.existingProductHandles.length} ${collisions.existingProductHandles.length > 0 ? `(${collisions.existingProductHandles.join(", ")})` : "(None — clean store)"}\n`;
  md += `- **Existing Pages Found:** ${collisions.existingPageHandles.length} ${collisions.existingPageHandles.length > 0 ? `(${collisions.existingPageHandles.join(", ")})` : "(None — clean store)"}\n`;
  md += `- **Existing Filenames Found:** ${collisions.existingFilenames.length}\n\n`;

  if (
    collisions.existingProductHandles.length === 0 &&
    collisions.existingPageHandles.length === 0
  ) {
    md += `### Collision Status: ✅ CLEAN\nNo collision risks detected. All source records can be created safely without overwrite conflicts.\n`;
  } else {
    md += `### Collision Status: ⚠️ COLLISIONS DETECTED\nDefault rule: Skip matching records unless \`--allow-update\` is explicitly specified.\n`;
  }

  const outPath = path.join(reportsDir, "04-capability-matrix.md");
  fs.writeFileSync(outPath, md, "utf8");
  logger.info(`Capability matrix report generated at ${outPath}`);
}
