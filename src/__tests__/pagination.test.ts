/**
 * Tests for the cursor pagination helper.
 *
 * Verifies:
 * 1. Fetches all pages when hasNextPage is true across multiple pages.
 * 2. Stops correctly when hasNextPage is false.
 * 3. Passes correct $after cursor on subsequent pages.
 * 4. Returns all nodes combined from all pages.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { fetchAllPages, type Connection } from "../pagination.js";
import { createSourceClient } from "../client.js";
import { SHOPIFY_API_VERSION } from "../constants.js";

// ── Helpers ───────────────────────────────────────────────────────────────────

interface PageNode {
  id: string;
  title: string;
}

interface PageData {
  products: Connection<PageNode>;
}

function makePageResponse(
  nodes: PageNode[],
  hasNextPage: boolean,
  endCursor: string | null
): object {
  return {
    data: {
      products: {
        edges: nodes.map((n) => ({ node: n })),
        pageInfo: { hasNextPage, endCursor },
      },
    },
  };
}

type FetchMock = ReturnType<typeof vi.fn>;

function makeFetch(...pages: object[]): FetchMock {
  let callCount = 0;
  return vi.fn().mockImplementation(() => {
    const page = pages[callCount++];
    return Promise.resolve({
      ok: true,
      headers: { get: (h: string) => (h === "X-Shopify-API-Version" ? SHOPIFY_API_VERSION : null) },
      json: () => Promise.resolve(page),
      text: () => Promise.resolve(""),
    });
  });
}

const QUERY = `query ($first: Int!, $after: String) {
  products(first: $first, after: $after) {
    edges { node { id title } }
    pageInfo { hasNextPage endCursor }
  }
}`;

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("fetchAllPages", () => {
  let originalFetch: typeof global.fetch;

  beforeEach(() => {
    originalFetch = global.fetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("returns all nodes from a single page", async () => {
    const nodes = [
      { id: "1", title: "Product A" },
      { id: "2", title: "Product B" },
    ];
    global.fetch = makeFetch(
      makePageResponse(nodes, false, null)
    ) as unknown as typeof fetch;

    const client = createSourceClient("test.myshopify.com", "token", false);
    const result = await fetchAllPages<PageData, PageNode>(
      client,
      QUERY,
      (d) => d.products
    );

    expect(result).toHaveLength(2);
    expect(result[0]?.id).toBe("1");
    expect(result[1]?.title).toBe("Product B");
  });

  it("fetches multiple pages and combines all nodes", async () => {
    global.fetch = makeFetch(
      makePageResponse([{ id: "1", title: "A" }], true, "cursor-1"),
      makePageResponse([{ id: "2", title: "B" }], true, "cursor-2"),
      makePageResponse([{ id: "3", title: "C" }], false, null)
    ) as unknown as typeof fetch;

    const client = createSourceClient("test.myshopify.com", "token", false);
    const result = await fetchAllPages<PageData, PageNode>(
      client,
      QUERY,
      (d) => d.products,
      1 // pageSize=1 to force 3 pages
    );

    expect(result).toHaveLength(3);
    expect(result.map((n) => n.id)).toEqual(["1", "2", "3"]);
  });

  it("calls fetch with the correct cursor on page 2+", async () => {
    const mockFetch = makeFetch(
      makePageResponse([{ id: "1", title: "A" }], true, "abc123"),
      makePageResponse([{ id: "2", title: "B" }], false, null)
    );
    global.fetch = mockFetch as unknown as typeof fetch;

    const client = createSourceClient("test.myshopify.com", "token", false);
    await fetchAllPages<PageData, PageNode>(client, QUERY, (d) => d.products);

    expect(mockFetch).toHaveBeenCalledTimes(2);
    // Second call should pass after: "abc123"
    const secondCallBody = JSON.parse(
      (mockFetch.mock.calls[1] as [string, { body: string }])[1].body
    ) as { variables: { after: string } };
    expect(secondCallBody.variables.after).toBe("abc123");
  });

  it("returns an empty array for an empty connection", async () => {
    global.fetch = makeFetch(makePageResponse([], false, null)) as unknown as typeof fetch;

    const client = createSourceClient("test.myshopify.com", "token", false);
    const result = await fetchAllPages<PageData, PageNode>(
      client,
      QUERY,
      (d) => d.products
    );

    expect(result).toHaveLength(0);
  });
});
