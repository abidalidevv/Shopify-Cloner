/**
 * Tests for the guarded GraphQL client.
 *
 * Verifies:
 * 1. Source-role client throws WriteBlockedError on any mutation.
 * 2. Dry-run client (destination role) throws WriteBlockedError on mutations.
 * 3. A destination client with dryRun=false DOES call fetch (write allowed).
 * 4. query() on a mutation document throws immediately (misuse guard).
 * 5. API version mismatch throws ApiVersionMismatchError.
 * 6. HTTP 200 with userErrors is treated as a failure (not success).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  WriteBlockedError,
  ApiVersionMismatchError,
  GraphQLResponseError,
  createSourceClient,
  createDestClient,
  isMutation,
} from "../client.js";
import { SHOPIFY_API_VERSION } from "../constants.js";

// ── Fake fetch ────────────────────────────────────────────────────────────────

type FetchMock = ReturnType<typeof vi.fn>;

function makeFetchOk(data: unknown, apiVersion = SHOPIFY_API_VERSION): FetchMock {
  return vi.fn().mockResolvedValue({
    ok: true,
    headers: { get: (h: string) => (h === "X-Shopify-API-Version" ? apiVersion : null) },
    json: async () => ({ data }),
    text: async () => "",
  });
}

function makeFetchWithUserErrors(userErrors: { message: string }[]): FetchMock {
  return vi.fn().mockResolvedValue({
    ok: true,
    headers: { get: () => SHOPIFY_API_VERSION },
    json: async () => ({
      data: { someCreate: { result: null, userErrors } },
    }),
    text: async () => "",
  });
}

function makeFetchVersionMismatch(badVersion: string): FetchMock {
  return vi.fn().mockResolvedValue({
    ok: true,
    headers: { get: (h: string) => (h === "X-Shopify-API-Version" ? badVersion : null) },
    json: async () => ({ data: {} }),
    text: async () => "",
  });
}

const QUERY = `query { shop { name } }`;
const MUTATION = `mutation productCreate($input: ProductInput!) {
  productCreate(input: $input) {
    product { id }
    userErrors { field message }
  }
}`;

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("GraphQLClient — write-guard", () => {
  let originalFetch: typeof global.fetch;

  beforeEach(() => {
    originalFetch = global.fetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("source-role client BLOCKS mutations and throws WriteBlockedError", async () => {
    const client = createSourceClient("test.myshopify.com", "shpat_secret", false);
    // fetch should NEVER be called — the guard fires before network
    global.fetch = vi.fn();

    await expect(client.mutate(MUTATION, {})).rejects.toThrow(WriteBlockedError);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("source-role write-block error message mentions 'source store is read-only'", async () => {
    const client = createSourceClient("test.myshopify.com", "shpat_secret", false);
    global.fetch = vi.fn();

    await expect(client.mutate(MUTATION, {})).rejects.toThrow(/source store is read-only/i);
  });

  it("destination client with dryRun=true BLOCKS mutations and throws WriteBlockedError", async () => {
    const client = createDestClient("dest.myshopify.com", "shpat_secret", true /* dryRun */);
    global.fetch = vi.fn();

    await expect(client.mutate(MUTATION, {})).rejects.toThrow(WriteBlockedError);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("destination client with dryRun=true error message mentions 'dry-run'", async () => {
    const client = createDestClient("dest.myshopify.com", "shpat_secret", true);
    global.fetch = vi.fn();

    await expect(client.mutate(MUTATION, {})).rejects.toThrow(/dry-run/i);
  });

  it("destination client with dryRun=false ALLOWS mutations (calls fetch)", async () => {
    const mockFetch = makeFetchOk({ productCreate: { product: { id: "gid://shopify/Product/1" }, userErrors: [] } });
    global.fetch = mockFetch;

    const client = createDestClient("dest.myshopify.com", "shpat_secret", false /* dryRun */);
    await client.mutate(MUTATION, { input: {} });

    expect(mockFetch).toHaveBeenCalledOnce();
  });

  it("query() rejects a mutation document to prevent misuse", async () => {
    const client = createDestClient("dest.myshopify.com", "shpat_secret", false);
    global.fetch = vi.fn();

    await expect(client.query(MUTATION, {})).rejects.toThrow(
      /received a mutation document/i
    );
    expect(global.fetch).not.toHaveBeenCalled();
  });
});

describe("GraphQLClient — API version check", () => {
  let originalFetch: typeof global.fetch;

  beforeEach(() => {
    originalFetch = global.fetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("throws ApiVersionMismatchError when Shopify returns a different API version", async () => {
    global.fetch = makeFetchVersionMismatch("2025-01"); // wrong version

    const client = createSourceClient("test.myshopify.com", "shpat_secret", false);
    await expect(client.query(QUERY)).rejects.toThrow(ApiVersionMismatchError);
  });

  it("succeeds when Shopify returns the pinned API version", async () => {
    global.fetch = makeFetchOk({ shop: { name: "TibbeShifa" } });

    const client = createSourceClient("test.myshopify.com", "shpat_secret", false);
    const data = await client.query<{ shop: { name: string } }>(QUERY);
    expect(data.shop.name).toBe("TibbeShifa");
  });

  it("succeeds when X-Shopify-API-Version header is absent (pre-2026 behaviour)", async () => {
    // If header is absent, we cannot check — do not fail
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      headers: { get: () => null }, // header absent
      json: async () => ({ data: { shop: { name: "Test" } } }),
      text: async () => "",
    });
    global.fetch = mockFetch;

    const client = createSourceClient("test.myshopify.com", "shpat_secret", false);
    const data = await client.query<{ shop: { name: string } }>(QUERY);
    expect(data.shop.name).toBe("Test");
  });
});

describe("GraphQLClient — HTTP 200 ≠ success", () => {
  let originalFetch: typeof global.fetch;

  beforeEach(() => {
    originalFetch = global.fetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("throws GraphQLResponseError when response contains userErrors", async () => {
    global.fetch = makeFetchWithUserErrors([{ message: "Title can't be blank" }]);

    const client = createDestClient("dest.myshopify.com", "shpat_secret", false);
    await expect(client.mutate(MUTATION, {})).rejects.toThrow(GraphQLResponseError);
  });

  it("includes the userError message in the thrown error", async () => {
    global.fetch = makeFetchWithUserErrors([{ message: "Handle is already taken" }]);

    const client = createDestClient("dest.myshopify.com", "shpat_secret", false);
    await expect(client.mutate(MUTATION, {})).rejects.toThrow(/Handle is already taken/);
  });
});

describe("GraphQLClient — tricky mutation detection & write-guard cases", () => {
  let originalFetch: typeof global.fetch;

  beforeEach(() => {
    originalFetch = global.fetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("detects mutation with leading single and multiple comments", () => {
    const doc = `# Comment line 1\n# Comment line 2\nmutation ProductCreate { productCreate { id } }`;
    expect(isMutation(doc)).toBe(true);
  });

  it("detects mutation with arbitrary leading whitespace, tabs, and newlines", () => {
    const doc = `\r\n\t   \n  mutation DoWork { something { id } }`;
    expect(isMutation(doc)).toBe(true);
  });

  it("detects named mutation operations", () => {
    const doc = `mutation MyNamedOperation($input: ProductInput!) { productCreate(input: $input) { id } }`;
    expect(isMutation(doc)).toBe(true);
  });

  it("does NOT flag a query containing 'mutation' inside a string literal", () => {
    const doc = `query SearchProducts { products(query: "tag:mutation") { edges { node { id } } } }`;
    expect(isMutation(doc)).toBe(false);
  });

  it("does NOT block a query containing 'mutation' inside a string literal on source client", async () => {
    const mockFetch = makeFetchOk({ products: { edges: [] } });
    global.fetch = mockFetch;

    const client = createSourceClient("source.myshopify.com", "token", false);
    const doc = `query SearchProducts { products(query: "tag:mutation") { edges { node { id } } } }`;

    const res = await client.query<{ products: { edges: unknown[] } }>(doc);
    expect(res.products.edges).toEqual([]);
    expect(mockFetch).toHaveBeenCalledOnce();
  });

  it("does NOT flag a query containing 'mutation' inside a block string", () => {
    const doc = `query Q { shop { description(text: """Contains the word mutation here""") } }`;
    expect(isMutation(doc)).toBe(false);
  });

  it("does NOT flag a query containing 'mutation' inside comments", () => {
    const doc = `# Note: this query avoids any mutation\n# Another mutation reference in comment\nquery GetShop { shop { name } }`;
    expect(isMutation(doc)).toBe(false);
  });

  it("does NOT block a query with 'mutation' in comments on source client", async () => {
    const mockFetch = makeFetchOk({ shop: { name: "TibbeShifa" } });
    global.fetch = mockFetch;

    const client = createSourceClient("source.myshopify.com", "token", false);
    const doc = `# This is NOT a mutation\nquery GetShop { shop { name } }`;

    const res = await client.query<{ shop: { name: string } }>(doc);
    expect(res.shop.name).toBe("TibbeShifa");
    expect(mockFetch).toHaveBeenCalledOnce();
  });

  it("does NOT flag a query containing a selection field named 'mutation'", () => {
    const doc = `query { store { mutation { status } } }`;
    expect(isMutation(doc)).toBe(false);
  });

  it("detects multiple operations when query appears first and mutation appears second", () => {
    const doc = `query Q { shop { name } }\nmutation M { productDelete(id: "1") { userErrors { message } } }`;
    expect(isMutation(doc)).toBe(true);
  });

  it("blocks multi-op document on source-role client even if attempted via query()", async () => {
    global.fetch = vi.fn();

    const client = createSourceClient("source.myshopify.com", "token", false);
    const doc = `query Q { shop { name } }\nmutation M { productDelete(id: "1") { userErrors { message } } }`;

    await expect(client.query(doc)).rejects.toThrow(WriteBlockedError);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("detects multiple operations when mutation appears first and query appears second", () => {
    const doc = `mutation M { productDelete(id: "1") { userErrors { message } } }\nquery Q { shop { name } }`;
    expect(isMutation(doc)).toBe(true);
  });
});

