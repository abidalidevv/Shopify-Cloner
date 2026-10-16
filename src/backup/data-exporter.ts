/**
 * Data Exporter for Shopify Resources.
 *
 * Exports resource records into:
 * - backups/source-store/json/{resource}.json
 * - backups/source-store/jsonl/{resource}.jsonl
 *
 * Preserves source GIDs, handles, full metadata, and options.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { type GraphQLClient } from "../client.js";
import { fetchAllPages, type Connection } from "../pagination.js";
import { logger } from "../logger.js";

// Comprehensive GraphQL Queries for Full Data Export
export const EXPORT_QUERIES = {
  products: `
    query ExportProducts($first: Int!, $after: String) {
      products(first: $first, after: $after) {
        edges {
          node {
            id
            handle
            title
            descriptionHtml
            vendor
            productType
            status
            tags
            templateSuffix
            options { id name values position }
            variants(first: 20) {
              edges {
                node {
                  id
                  title
                  sku
                  barcode
                  price
                  compareAtPrice
                  taxable
                  inventoryItem {
                    id
                    measurement {
                      weight {
                        value
                        unit
                      }
                    }
                    inventoryLevels(first: 5) {
                      edges {
                        node {
                          location { id name }
                          quantities(names: ["available"]) { name quantity }
                        }
                      }
                    }
                  }
                  selectedOptions { name value }
                }
              }
            }
            media(first: 25) {
              edges {
                node {
                  id
                  mediaContentType
                  alt
                  ... on MediaImage {
                    image { url width height }
                  }
                }
              }
            }
            metafields(first: 25) {
              edges {
                node {
                  id
                  namespace
                  key
                  value
                  type
                }
              }
            }
            collections(first: 10) {
              edges {
                node {
                  id
                  handle
                }
              }
            }
          }
        }
        pageInfo { hasNextPage endCursor }
      }
    }
  `,
  collections: `
    query ExportCollections($first: Int!, $after: String) {
      collections(first: $first, after: $after) {
        edges {
          node {
            id
            handle
            title
            descriptionHtml
            templateSuffix
            ruleSet {
              appliedDisjunctively
              rules { column relation condition }
            }
            image { url altText width height }
          }
        }
        pageInfo { hasNextPage endCursor }
      }
    }
  `,
  pages: `
    query ExportPages($first: Int!, $after: String) {
      pages(first: $first, after: $after) {
        edges {
          node {
            id
            handle
            title
            body
            templateSuffix
            createdAt
            updatedAt
          }
        }
        pageInfo { hasNextPage endCursor }
      }
    }
  `,
  menus: `
    query ExportMenus($first: Int!, $after: String) {
      menus(first: $first, after: $after) {
        edges {
          node {
            id
            handle
            title
            items {
              id
              title
              url
              type
              items {
                id
                title
                url
                type
              }
            }
          }
        }
        pageInfo { hasNextPage endCursor }
      }
    }
  `,
  metaobjects: `
    query ExportMetaobjects($first: Int!, $after: String) {
      metaobjects(first: $first, after: $after) {
        edges {
          node {
            id
            handle
            type
            displayName
            fields { key value type }
          }
        }
        pageInfo { hasNextPage endCursor }
      }
    }
  `,
  metaobjectDefinitions: `
    query ExportMetaobjectDefinitions($first: Int!, $after: String) {
      metaobjectDefinitions(first: $first, after: $after) {
        edges {
          node {
            id
            type
            name
            description
            fieldDefinitions {
              name
              key
              description
              required
              type { name }
            }
          }
        }
        pageInfo { hasNextPage endCursor }
      }
    }
  `,
  redirects: `
    query ExportRedirects($first: Int!, $after: String) {
      urlRedirects(first: $first, after: $after) {
        edges {
          node {
            id
            path
            target
          }
        }
        pageInfo { hasNextPage endCursor }
      }
    }
  `,
  files: `
    query ExportFiles($first: Int!, $after: String) {
      files(first: $first, after: $after) {
        edges {
          node {
            id
            alt
            createdAt
            ... on GenericFile { mimeType originalFileSize url }
            ... on MediaImage { image { url width height } }
            ... on Video { duration originalSource { url } }
          }
        }
        pageInfo { hasNextPage endCursor }
      }
    }
  `,
  customers: `
    query ExportCustomers($first: Int!, $after: String) {
      customers(first: $first, after: $after) {
        edges {
          node {
            id
            displayName
            email
            phone
            numberOfOrders
            tags
            note
          }
        }
        pageInfo { hasNextPage endCursor }
      }
    }
  `,
  orders: `
    query ExportOrders($first: Int!, $after: String) {
      orders(first: $first, after: $after) {
        edges {
          node {
            id
            name
            createdAt
            displayFinancialStatus
            displayFulfillmentStatus
            totalPriceSet { shopMoney { amount currencyCode } }
            subtotalPriceSet { shopMoney { amount currencyCode } }
            lineItems(first: 50) {
              edges {
                node {
                  id
                  title
                  quantity
                  originalUnitPriceSet { shopMoney { amount currencyCode } }
                }
              }
            }
          }
        }
        pageInfo { hasNextPage endCursor }
      }
    }
  `,
  discounts: `
    query ExportDiscounts($first: Int!, $after: String) {
      discountNodes(first: $first, after: $after) {
        edges {
          node {
            id
            discount {
              __typename
              ... on DiscountCodeBasic {
                title
                status
                startsAt
                endsAt
                appliesOncePerCustomer
                usageLimit
                codes(first: 5) {
                  edges {
                    node { code }
                  }
                }
                customerGets {
                  value {
                    ... on DiscountPercentage { percentage }
                    ... on DiscountAmount { amount { amount currencyCode } }
                  }
                  items {
                    ... on AllDiscountItems { allItems }
                  }
                }
                customerSelection {
                  ... on DiscountCustomerAll { allCustomers }
                }
              }
              ... on DiscountCodeFreeShipping {
                title
                status
                summary
                startsAt
                endsAt
                appliesOncePerCustomer
                usageLimit
                codes(first: 5) {
                  edges {
                    node { code }
                  }
                }
              }
              ... on DiscountAutomaticBasic {
                title
                status
                startsAt
                endsAt
                customerGets {
                  value {
                    ... on DiscountPercentage { percentage }
                    ... on DiscountAmount { amount { amount currencyCode } }
                  }
                  items {
                    ... on AllDiscountItems { allItems }
                  }
                }
              }
              ... on DiscountAutomaticFreeShipping {
                title
                status
                summary
                startsAt
                endsAt
              }
            }
          }
        }
        pageInfo { hasNextPage endCursor }
      }
    }
  `,
};

export async function exportResource<TNode>(
  client: GraphQLClient,
  resourceName: string,
  query: string,
  getConnection: (data: unknown) => Connection<TNode>,
  destDir: string,
  pageSize = 50
): Promise<TNode[]> {
  const jsonDir = path.join(destDir, "json");
  const jsonlDir = path.join(destDir, "jsonl");
  fs.mkdirSync(jsonDir, { recursive: true });
  fs.mkdirSync(jsonlDir, { recursive: true });

  logger.info(`Exporting ${resourceName}...`);
  try {
    const nodes = await fetchAllPages<unknown, TNode>(client, query, getConnection, pageSize);

    // Save formatted JSON
    const jsonPath = path.join(jsonDir, `${resourceName}.json`);
    fs.writeFileSync(jsonPath, JSON.stringify(nodes, null, 2), "utf8");

    // Save JSONL (one JSON object per line)
    const jsonlPath = path.join(jsonlDir, `${resourceName}.jsonl`);
    const jsonlContent = nodes.map((n) => JSON.stringify(n)).join("\n");
    fs.writeFileSync(jsonlPath, jsonlContent ? `${jsonlContent}\n` : "", "utf8");

    logger.info(`Successfully exported ${nodes.length} ${resourceName} records.`);
    return nodes;
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    logger.warn(`Could not export ${resourceName}: ${errorMsg}`);
    return [];
  }
}

export async function exportMetaobjects(
  client: GraphQLClient,
  destDir: string
): Promise<unknown[]> {
  const jsonDir = path.join(destDir, "json");
  const jsonlDir = path.join(destDir, "jsonl");
  fs.mkdirSync(jsonDir, { recursive: true });
  fs.mkdirSync(jsonlDir, { recursive: true });

  logger.info("Exporting metaobjects...");
  try {
    const defsPath = path.join(jsonDir, "metaobjectDefinitions.json");
    let types: string[] = [];
    if (fs.existsSync(defsPath)) {
      const defs = JSON.parse(fs.readFileSync(defsPath, "utf8")) as Array<{ type: string }>;
      types = defs.map((d) => d.type);
    } else {
      const defNodes = await fetchAllPages<unknown, { type: string }>(
        client,
        EXPORT_QUERIES.metaobjectDefinitions,
        (d: unknown) => (d as Record<string, Connection<{ type: string }>>)["metaobjectDefinitions"]!,
        50
      );
      types = defNodes.map((d) => d.type);
    }

    const ENTRY_QUERY = `
      query ExportMetaobjectsByType($type: String!, $first: Int!, $after: String) {
        metaobjects(type: $type, first: $first, after: $after) {
          edges {
            node {
              id
              handle
              type
              displayName
              fields { key value type }
            }
          }
          pageInfo { hasNextPage endCursor }
        }
      }
    `;

    const allEntries: unknown[] = [];
    for (const type of types) {
      const entries = await fetchAllPages<unknown, unknown>(
        client,
        ENTRY_QUERY,
        (d: unknown) => (d as Record<string, Connection<unknown>>)["metaobjects"]!,
        50,
        { type }
      );
      allEntries.push(...entries);
    }

    // Save formatted JSON
    fs.writeFileSync(path.join(jsonDir, "metaobjects.json"), JSON.stringify(allEntries, null, 2), "utf8");

    // Save JSONL
    const jsonlContent = allEntries.map((n) => JSON.stringify(n)).join("\n");
    fs.writeFileSync(path.join(jsonlDir, "metaobjects.jsonl"), jsonlContent ? `${jsonlContent}\n` : "", "utf8");

    logger.info(`Successfully exported ${allEntries.length} metaobject records across ${types.length} definitions.`);
    return allEntries;
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    logger.warn(`Could not export metaobjects: ${errorMsg}`);
    return [];
  }
}
