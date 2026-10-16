/**
 * Cursor-based pagination helper.
 *
 * Fetches all pages of a Shopify GraphQL connection and yields nodes.
 * Handles the standard Shopify edges/pageInfo/endCursor pattern.
 *
 * Goal file §4: "Full pagination everywhere; no arbitrary item limits."
 */

import { GraphQLClient } from "./client.js";
import { logger } from "./logger.js";

export interface PageInfo {
  hasNextPage: boolean;
  endCursor: string | null;
}

export interface Edge<T> {
  node: T;
  cursor?: string;
}

export interface Connection<T> {
  edges: Edge<T>[];
  pageInfo: PageInfo;
}

/**
 * Fetches ALL nodes from a paginated Shopify GraphQL connection.
 *
 * @param client   - The GraphQL client to use.
 * @param query    - A query string that accepts $first and $after variables
 *                   and returns a connection with edges.node and pageInfo.
 * @param getConnection - Extracts the Connection from the query response data.
 * @param pageSize - Nodes per page (max 250 for most resources).
 * @returns Array of all nodes.
 */
export async function fetchAllPages<TData, TNode>(
  client: GraphQLClient,
  query: string,
  getConnection: (data: TData) => Connection<TNode>,
  pageSize = 100,
  extraVariables?: Record<string, unknown>
): Promise<TNode[]> {
  const nodes: TNode[] = [];
  let cursor: string | null = null;
  let page = 0;

  while (true) {
    page++;
    const data = await client.query<TData>(query, {
      first: pageSize,
      after: cursor,
      ...(extraVariables ?? {}),
    });

    const connection = getConnection(data);
    for (const edge of connection.edges) {
      nodes.push(edge.node);
    }

    logger.debug(`pagination: page ${page}, fetched ${connection.edges.length} items`, {
      total: nodes.length,
      hasNextPage: connection.pageInfo.hasNextPage,
    });

    if (!connection.pageInfo.hasNextPage) break;
    cursor = connection.pageInfo.endCursor;
    if (cursor === null) break;
  }

  return nodes;
}
