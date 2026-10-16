/**
 * Phase 3: Source Store Inventory & Audit Engine.
 *
 * Enumerates all in-scope resources from the source store using cursor pagination:
 * - Products, Collections, Customers, Orders, Discounts, Pages, Menus
 * - Metaobjects, Redirects, Files (classified by type: image/video/document/other)
 * - Locales & Policies
 *
 * Compares actual counts against EXPECTED_COUNTS and generates:
 * - reports/01-source-inventory.md
 * - reports/01-source-inventory.json
 * - reports/01-inaccessible.md
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { type GraphQLClient } from "./client.js";
import { fetchAllPages, type Connection } from "./pagination.js";
import { EXPECTED_COUNTS } from "./constants.js";
import { logger } from "./logger.js";

export interface FileClassification {
  total: number;
  images: number;
  videos: number;
  documents: number;
  other: number;
}

export interface InventoryResult {
  timestamp: string;
  shop: string;
  counts: {
    products: number;
    collections: number;
    customers: number;
    orders: number;
    discounts: number;
    pages: number;
    menus: number;
    metaobjects: number;
    redirects: number;
    files: number;
  };
  fileBreakdown: FileClassification;
  inaccessible: Array<{
    resource: string;
    error: string;
    requiredScope: string;
    remediation: string;
  }>;
}

// ── GraphQL Queries ──────────────────────────────────────────────────────────

const PRODUCTS_QUERY = `
query InventoryProducts($first: Int!, $after: String) {
  products(first: $first, after: $after) {
    edges { node { id handle title } }
    pageInfo { hasNextPage endCursor }
  }
}
`;

const COLLECTIONS_QUERY = `
query InventoryCollections($first: Int!, $after: String) {
  collections(first: $first, after: $after) {
    edges { node { id handle title } }
    pageInfo { hasNextPage endCursor }
  }
}
`;

const CUSTOMERS_QUERY = `
query InventoryCustomers($first: Int!, $after: String) {
  customers(first: $first, after: $after) {
    edges { node { id displayName } }
    pageInfo { hasNextPage endCursor }
  }
}
`;

const ORDERS_QUERY = `
query InventoryOrders($first: Int!, $after: String) {
  orders(first: $first, after: $after) {
    edges { node { id name createdAt } }
    pageInfo { hasNextPage endCursor }
  }
}
`;

const DISCOUNTS_QUERY = `
query InventoryDiscounts($first: Int!, $after: String) {
  discountNodes(first: $first, after: $after) {
    edges { node { id } }
    pageInfo { hasNextPage endCursor }
  }
}
`;

const PAGES_QUERY = `
query InventoryPages($first: Int!, $after: String) {
  pages(first: $first, after: $after) {
    edges { node { id handle title } }
    pageInfo { hasNextPage endCursor }
  }
}
`;

const MENUS_QUERY = `
query InventoryMenus($first: Int!, $after: String) {
  menus(first: $first, after: $after) {
    edges { node { id handle title } }
    pageInfo { hasNextPage endCursor }
  }
}
`;

const METAOBJECT_DEFS_QUERY = `
query InventoryMetaobjects($first: Int!, $after: String) {
  metaobjectDefinitions(first: $first, after: $after) {
    edges { node { id type name } }
    pageInfo { hasNextPage endCursor }
  }
}
`;

const REDIRECTS_QUERY = `
query InventoryRedirects($first: Int!, $after: String) {
  urlRedirects(first: $first, after: $after) {
    edges { node { id path target } }
    pageInfo { hasNextPage endCursor }
  }
}
`;

const FILES_QUERY = `
query InventoryFiles($first: Int!, $after: String) {
  files(first: $first, after: $after) {
    edges {
      node {
        id
        __typename
        alt
        createdAt
        ... on GenericFile { mimeType url }
        ... on MediaImage { image { url } }
        ... on Video { originalSource { url } }
      }
    }
    pageInfo { hasNextPage endCursor }
  }
}
`;

// ── Resource Enumerator ──────────────────────────────────────────────────────

interface RawFileNode {
  id: string;
  __typename?: string;
  mimeType?: string;
}

export function classifyFile(node: RawFileNode): "image" | "video" | "document" | "other" {
  const type = node.__typename ?? "";
  const mime = (node.mimeType ?? "").toLowerCase();

  if (type === "MediaImage" || mime.startsWith("image/")) {
    return "image";
  }
  if (type === "Video" || mime.startsWith("video/")) {
    return "video";
  }
  if (
    mime.includes("pdf") ||
    mime.includes("document") ||
    mime.includes("text") ||
    mime.includes("csv") ||
    mime.includes("sheet")
  ) {
    return "document";
  }
  return "other";
}

export async function runInventory(
  client: GraphQLClient,
  shop: string
): Promise<InventoryResult> {
  const result: InventoryResult = {
    timestamp: new Date().toISOString(),
    shop,
    counts: {
      products: 0,
      collections: 0,
      customers: 0,
      orders: 0,
      discounts: 0,
      pages: 0,
      menus: 0,
      metaobjects: 0,
      redirects: 0,
      files: 0,
    },
    fileBreakdown: {
      total: 0,
      images: 0,
      videos: 0,
      documents: 0,
      other: 0,
    },
    inaccessible: [],
  };

  async function fetchResource<TNode>(
    name: keyof typeof result.counts,
    query: string,
    getConnection: (data: unknown) => Connection<TNode>,
    scope: string
  ): Promise<TNode[]> {
    try {
      logger.info(`Auditing ${String(name)}...`);
      const nodes = await fetchAllPages<unknown, TNode>(client, query, getConnection, 50);
      result.counts[name] = nodes.length;
      return nodes;
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      logger.warn(`Could not audit ${String(name)}: ${errorMsg}`);
      result.inaccessible.push({
        resource: String(name),
        error: errorMsg,
        requiredScope: scope,
        remediation: `Grant '${scope}' scope in the Shopify Dev Dashboard app for Account A and release a version.`,
      });
      return [];
    }
  }

  // 1. Products
  await fetchResource(
    "products",
    PRODUCTS_QUERY,
    (d: unknown) => (d as { products: Connection<{ id: string }> }).products,
    "read_products"
  );

  // 2. Collections
  await fetchResource(
    "collections",
    COLLECTIONS_QUERY,
    (d: unknown) => (d as { collections: Connection<{ id: string }> }).collections,
    "read_products"
  );

  // 3. Customers
  await fetchResource(
    "customers",
    CUSTOMERS_QUERY,
    (d: unknown) => (d as { customers: Connection<{ id: string }> }).customers,
    "read_customers"
  );

  // 4. Orders
  await fetchResource(
    "orders",
    ORDERS_QUERY,
    (d: unknown) => (d as { orders: Connection<{ id: string }> }).orders,
    "read_orders, read_all_orders"
  );

  // 5. Discounts
  await fetchResource(
    "discounts",
    DISCOUNTS_QUERY,
    (d: unknown) => (d as { discountNodes: Connection<{ id: string }> }).discountNodes,
    "read_discounts"
  );

  // 6. Pages
  await fetchResource(
    "pages",
    PAGES_QUERY,
    (d: unknown) => (d as { pages: Connection<{ id: string }> }).pages,
    "read_content"
  );

  // 7. Menus
  await fetchResource(
    "menus",
    MENUS_QUERY,
    (d: unknown) => (d as { menus: Connection<{ id: string }> }).menus,
    "read_navigation"
  );

  // 8. Metaobjects (count total entries across definitions)
  try {
    logger.info("Auditing metaobjects...");
    const defNodes = await fetchAllPages<unknown, { id: string; type: string }>(
      client,
      METAOBJECT_DEFS_QUERY,
      (d: unknown) => (d as { metaobjectDefinitions: Connection<{ id: string; type: string }> }).metaobjectDefinitions,
      50
    );
    const ENTRIES_QUERY = `
      query InventoryMetaobjectEntries($type: String!, $first: Int!, $after: String) {
        metaobjects(type: $type, first: $first, after: $after) {
          edges { node { id } }
          pageInfo { hasNextPage endCursor }
        }
      }
    `;
    let totalEntries = 0;
    for (const def of defNodes) {
      const entries = await fetchAllPages<unknown, { id: string }>(
        client,
        ENTRIES_QUERY,
        (d: unknown) => (d as { metaobjects: Connection<{ id: string }> }).metaobjects,
        50,
        { type: def.type }
      );
      totalEntries += entries.length;
    }
    result.counts.metaobjects = totalEntries;
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    logger.warn(`Could not audit metaobjects: ${errorMsg}`);
    result.inaccessible.push({
      resource: "metaobjects",
      error: errorMsg,
      requiredScope: "read_metaobjects",
      remediation: "Grant 'read_metaobjects' scope in Shopify Dev Dashboard.",
    });
  }

  // 9. Redirects
  await fetchResource(
    "redirects",
    REDIRECTS_QUERY,
    (d: unknown) => (d as { urlRedirects: Connection<{ id: string }> }).urlRedirects,
    "read_content"
  );

  // 10. Files with type classification
  const fileNodes = await fetchResource<RawFileNode>(
    "files",
    FILES_QUERY,
    (d: unknown) => (d as { files: Connection<RawFileNode> }).files,
    "read_files"
  );

  result.fileBreakdown.total = fileNodes.length;
  for (const f of fileNodes) {
    const kind = classifyFile(f);
    if (kind === "image") result.fileBreakdown.images++;
    else if (kind === "video") result.fileBreakdown.videos++;
    else if (kind === "document") result.fileBreakdown.documents++;
    else result.fileBreakdown.other++;
  }

  return result;
}

// ── Report Writers ───────────────────────────────────────────────────────────

export function generateReports(result: InventoryResult, reportsDir = "reports"): void {
  fs.mkdirSync(reportsDir, { recursive: true });

  // 1. JSON Report
  fs.writeFileSync(
    path.join(reportsDir, "01-source-inventory.json"),
    JSON.stringify(result, null, 2),
    "utf8"
  );

  // 2. Markdown Report
  let md = `# Source Store Inventory & Audit Report\n\n`;
  md += `- **Store:** \`${result.shop}\`\n`;
  md += `- **Audit Timestamp:** ${result.timestamp}\n\n`;
  md += `## Resource Counts (Compared to Goal File Expectations)\n\n`;
  md += `| Resource | Expected | Actual Live Count | Status | Notes |\n`;
  md += `|---|---|---|---|---|\n`;

  const keys = Object.keys(result.counts) as Array<keyof typeof result.counts>;
  for (const k of keys) {
    const actual = result.counts[k];
    const expCount = (EXPECTED_COUNTS as Record<string, number | undefined>)[k];
    const match = expCount === undefined || expCount === actual;
    const status = match ? "✅ MATCH" : `⚠️ MISMATCH (${actual - (expCount ?? 0)})`;
    const expectedDisplay = expCount !== undefined ? String(expCount) : "—";
    const notes = k === "files" ? `${result.fileBreakdown.images} images, ${result.fileBreakdown.videos} videos, ${result.fileBreakdown.documents} docs` : "";
    md += `| ${k} | ${expectedDisplay} | ${actual} | ${status} | ${notes} |\n`;
  }

  md += `\n## Files Breakdown by Type (Expected: 523)\n\n`;
  md += `- **Images:** ${result.fileBreakdown.images}\n`;
  md += `- **Videos:** ${result.fileBreakdown.videos}\n`;
  md += `- **Documents (PDF, text, CSV):** ${result.fileBreakdown.documents}\n`;
  md += `- **Other:** ${result.fileBreakdown.other}\n`;
  md += `- **Total Files:** ${result.fileBreakdown.total}\n\n`;

  fs.writeFileSync(path.join(reportsDir, "01-source-inventory.md"), md, "utf8");

  // 3. Inaccessible Resources Report
  let inaccMd = `# Inaccessible Resources Report\n\n`;
  if (result.inaccessible.length === 0) {
    inaccMd += `✅ All tested resource scopes were successfully read by the access token. No access issues detected.\n`;
  } else {
    inaccMd += `The following resources could not be read. Please grant the specified scopes in your Dev Dashboard app:\n\n`;
    inaccMd += `| Resource | Required Scope(s) | Error Message | Action Needed |\n`;
    inaccMd += `|---|---|---|---|\n`;
    for (const item of result.inaccessible) {
      inaccMd += `| ${item.resource} | \`${item.requiredScope}\` | ${item.error.replace(/\n/g, " ")} | ${item.remediation} |\n`;
    }
  }

  fs.writeFileSync(path.join(reportsDir, "01-inaccessible.md"), inaccMd, "utf8");
}
