/**
 * Tests for Destination Mapping & Compatibility Matrix.
 *
 * Verifies:
 * 1. MappingManager records and retrieves GID mappings and file URLs.
 * 2. detectCollisions parses existing destination resources.
 * 3. generateCapabilityMatrixReport produces reports/04-capability-matrix.md.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { MappingManager } from "../destination/id-mapper.js";
import {
  detectCollisions,
  generateCapabilityMatrixReport,
  type CollisionSummary,
} from "../destination/compatibility-matrix.js";
import { createDestClient } from "../client.js";

const TEST_MAPPINGS_DIR = "test-mappings";
const TEST_REPORTS_DIR = "test-compat-reports";

describe("MappingManager", () => {
  beforeEach(() => {
    if (fs.existsSync(TEST_MAPPINGS_DIR)) fs.rmSync(TEST_MAPPINGS_DIR, { recursive: true, force: true });
  });

  afterEach(() => {
    if (fs.existsSync(TEST_MAPPINGS_DIR)) fs.rmSync(TEST_MAPPINGS_DIR, { recursive: true, force: true });
  });

  it("records and persists GID mappings across instances", () => {
    const manager = new MappingManager(TEST_MAPPINGS_DIR);
    manager.recordId("products", "gid://shopify/Product/1", "gid://shopify/Product/999");

    expect(manager.getDestId("products", "gid://shopify/Product/1")).toBe("gid://shopify/Product/999");
    expect(manager.getDestId("products", "gid://shopify/Product/nonexistent")).toBeUndefined();

    // Verify persistence by loading fresh instance from same directory
    const reloaded = new MappingManager(TEST_MAPPINGS_DIR);
    expect(reloaded.getDestId("products", "gid://shopify/Product/1")).toBe("gid://shopify/Product/999");
  });

  it("records and persists file URL mappings", () => {
    const manager = new MappingManager(TEST_MAPPINGS_DIR);
    manager.recordFileMapping({
      sourceGid: "gid://shopify/MediaImage/1",
      sourceUrl: "https://cdn.shopify.com/old/pic.jpg",
      destGid: "gid://shopify/MediaImage/99",
      destUrl: "https://cdn.shopify.com/new/pic.jpg",
      filename: "pic.jpg",
      checksum: "hash123",
      status: "uploaded",
    });

    expect(manager.getDestFileUrl("https://cdn.shopify.com/old/pic.jpg")).toBe("https://cdn.shopify.com/new/pic.jpg");
    expect(manager.getDestId("files", "gid://shopify/MediaImage/1")).toBe("gid://shopify/MediaImage/99");
  });
});

describe("Destination compatibility and collision reporting", () => {
  beforeEach(() => {
    if (fs.existsSync(TEST_REPORTS_DIR)) fs.rmSync(TEST_REPORTS_DIR, { recursive: true, force: true });
  });

  afterEach(() => {
    if (fs.existsSync(TEST_REPORTS_DIR)) fs.rmSync(TEST_REPORTS_DIR, { recursive: true, force: true });
  });

  it("detects existing products on destination store", async () => {
    const mockFetch = vi.fn().mockImplementation((_url: string, init?: { body: string }) => {
      const body = JSON.parse(init?.body ?? "{}") as { query: string };
      let data = {};
      if (body.query.includes("ExistingProducts")) {
        data = { products: { edges: [{ node: { handle: "default-item" } }], pageInfo: { hasNextPage: false } } };
      } else if (body.query.includes("ExistingPages")) {
        data = { pages: { edges: [], pageInfo: { hasNextPage: false } } };
      }
      return Promise.resolve({
        ok: true,
        headers: { get: () => "2026-10" },
        json: () => Promise.resolve({ data }),
        text: () => Promise.resolve(""),
      });
    });
    global.fetch = mockFetch as unknown as typeof fetch;

    const client = createDestClient("dest.myshopify.com", "token", true);
    const collisions = await detectCollisions(client);

    expect(collisions.existingProductHandles).toEqual(["default-item"]);
    expect(collisions.existingPageHandles).toHaveLength(0);
  });

  it("generates 04-capability-matrix.md report", () => {
    const collisions: CollisionSummary = {
      existingProductHandles: [],
      existingFilenames: [],
      existingPageHandles: [],
    };

    generateCapabilityMatrixReport(collisions, "new-dest.myshopify.com", TEST_REPORTS_DIR);

    const reportPath = path.join(TEST_REPORTS_DIR, "04-capability-matrix.md");
    expect(fs.existsSync(reportPath)).toBe(true);

    const md = fs.readFileSync(reportPath, "utf8");
    expect(md).toContain("Destination Store Compatibility Matrix");
    expect(md).toContain("Products & Variants");
    expect(md).toContain("Collision Status: ✅ CLEAN");
  });
});

describe("Phase 6 Migration Importers (Dry-run & Live)", () => {
  beforeEach(() => {
    if (fs.existsSync(TEST_MAPPINGS_DIR)) fs.rmSync(TEST_MAPPINGS_DIR, { recursive: true, force: true });
  });

  afterEach(() => {
    if (fs.existsSync(TEST_MAPPINGS_DIR)) fs.rmSync(TEST_MAPPINGS_DIR, { recursive: true, force: true });
  });

  it("all modules honor dryRun = true and perform zero GraphQL mutations", async () => {
    const mockClient = {
      role: "destination" as const,
      dryRun: true,
      shop: "dest.myshopify.com",
      mutate: vi.fn(),
      query: vi.fn(),
    };
    const mapper = new MappingManager(TEST_MAPPINGS_DIR);

    const {
      migratePages,
      migrateRedirects,
      migrateFiles,
      migrateProducts,
      migrateCollections,
      migrateMetaobjects,
      migrateMenus,
      migrateTranslations,
    } = await import("../destination/migration-engine.js");

    const pRes = await migratePages([{ handle: "test-page", title: "Test Page" }], {
      client: mockClient as unknown as import("../client.js").GraphQLClient,
      mappingManager: mapper,
      dryRun: true,
    });
    expect(pRes.dryRunPreview.length).toBe(1);
    expect(pRes.created).toBe(0);

    const rRes = await migrateRedirects([{ path: "/old", target: "/new" }], {
      client: mockClient as unknown as import("../client.js").GraphQLClient,
      mappingManager: mapper,
      dryRun: true,
    });
    expect(rRes.dryRunPreview.length).toBe(1);
    expect(rRes.created).toBe(0);

    const fRes = await migrateFiles([{ id: "gid://shopify/File/1", originalSource: "http://example.com/img.png", filename: "img.png" }], {
      client: mockClient as unknown as import("../client.js").GraphQLClient,
      mappingManager: mapper,
      dryRun: true,
    });
    expect(fRes.dryRunPreview.length).toBe(1);
    expect(fRes.created).toBe(0);

    const prodRes = await migrateProducts([{ handle: "product-1", title: "Product 1", templateSuffix: "custom-template" }], {
      client: mockClient as unknown as import("../client.js").GraphQLClient,
      mappingManager: mapper,
      dryRun: true,
    });
    expect(prodRes.dryRunPreview.length).toBe(1);
    expect(prodRes.created).toBe(0);

    const colRes = await migrateCollections([{ handle: "collection-1", title: "Collection 1" }], {
      client: mockClient as unknown as import("../client.js").GraphQLClient,
      mappingManager: mapper,
      dryRun: true,
    });
    expect(colRes.dryRunPreview.length).toBe(1);
    expect(colRes.created).toBe(0);

    const metaRes = await migrateMetaobjects([{ handle: "entry-1", type: "faq", fields: [{ key: "q", value: "question" }] }], {
      client: mockClient as unknown as import("../client.js").GraphQLClient,
      mappingManager: mapper,
      dryRun: true,
    });
    expect(metaRes.dryRunPreview.length).toBe(1);
    expect(metaRes.created).toBe(0);

    const menuRes = await migrateMenus([{ handle: "main-menu", title: "Main Menu", items: [] }], {
      client: mockClient as unknown as import("../client.js").GraphQLClient,
      mappingManager: mapper,
      dryRun: true,
    });
    expect(menuRes.dryRunPreview.length).toBe(1);
    expect(menuRes.created).toBe(0);

    const tRes = await migrateTranslations([{ resourceId: "gid://shopify/Product/1", locale: "ur", key: "title", value: "عنوان", translatableContentDigest: "abc" }], {
      client: mockClient as unknown as import("../client.js").GraphQLClient,
      mappingManager: mapper,
      dryRun: true,
    });
    expect(tRes.dryRunPreview.length).toBe(1);
    expect(tRes.created).toBe(0);

    // ZERO mutations must have been called
    expect(mockClient.mutate).not.toHaveBeenCalled();
  });
});
