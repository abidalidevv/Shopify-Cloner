/**
 * Tests for Phase 3 Inventory & Audit Engine.
 *
 * Verifies:
 * 1. classifyFile identifies images, videos, documents, and other.
 * 2. runInventory enumerates resources and populates counts & breakdown.
 * 3. Inaccessible scopes are captured gracefully with remediation advice.
 * 4. generateReports generates 01-source-inventory.json, 01-source-inventory.md, and 01-inaccessible.md.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { classifyFile, runInventory, generateReports } from "../inventory.js";
import { createSourceClient } from "../client.js";

const TEST_REPORTS_DIR = "test-reports";

describe("classifyFile", () => {
  it("classifies MediaImage and image mime types as image", () => {
    expect(classifyFile({ id: "1", __typename: "MediaImage" })).toBe("image");
    expect(classifyFile({ id: "2", mimeType: "image/webp" })).toBe("image");
    expect(classifyFile({ id: "3", mimeType: "IMAGE/JPEG" })).toBe("image");
  });

  it("classifies Video and video mime types as video", () => {
    expect(classifyFile({ id: "1", __typename: "Video" })).toBe("video");
    expect(classifyFile({ id: "2", mimeType: "video/mp4" })).toBe("video");
  });

  it("classifies PDFs and document types as document", () => {
    expect(classifyFile({ id: "1", mimeType: "application/pdf" })).toBe("document");
    expect(classifyFile({ id: "2", mimeType: "text/csv" })).toBe("document");
  });

  it("classifies unknown mime types as other", () => {
    expect(classifyFile({ id: "1", mimeType: "application/octet-stream" })).toBe("other");
  });
});

describe("runInventory & report generation", () => {
  let originalFetch: typeof global.fetch;

  beforeEach(() => {
    originalFetch = global.fetch;
    if (fs.existsSync(TEST_REPORTS_DIR)) {
      fs.rmSync(TEST_REPORTS_DIR, { recursive: true, force: true });
    }
  });

  afterEach(() => {
    global.fetch = originalFetch;
    if (fs.existsSync(TEST_REPORTS_DIR)) {
      fs.rmSync(TEST_REPORTS_DIR, { recursive: true, force: true });
    }
  });

  it("enumerates all resources and breaks down files", async () => {
    const mockFetch = vi.fn().mockImplementation((_url: string, init?: { body: string }) => {
      const body = JSON.parse(init?.body ?? "{}") as { query: string };
      const q = body.query;

      let data: object = {};
      if (q.includes("products(")) {
        data = { products: { edges: [{ node: { id: "p1" } }, { node: { id: "p2" } }], pageInfo: { hasNextPage: false } } };
      } else if (q.includes("collections(")) {
        data = { collections: { edges: [{ node: { id: "c1" } }], pageInfo: { hasNextPage: false } } };
      } else if (q.includes("customers(")) {
        data = { customers: { edges: [{ node: { id: "cust1" } }], pageInfo: { hasNextPage: false } } };
      } else if (q.includes("orders(")) {
        data = { orders: { edges: [{ node: { id: "o1" } }], pageInfo: { hasNextPage: false } } };
      } else if (q.includes("discountNodes(")) {
        data = { discountNodes: { edges: [], pageInfo: { hasNextPage: false } } };
      } else if (q.includes("pages(")) {
        data = { pages: { edges: [{ node: { id: "page1" } }], pageInfo: { hasNextPage: false } } };
      } else if (q.includes("menus(")) {
        data = { menus: { edges: [{ node: { id: "m1" } }], pageInfo: { hasNextPage: false } } };
      } else if (q.includes("metaobjectDefinitions(")) {
        data = { metaobjectDefinitions: { edges: [{ node: { id: "md1", type: "author" } }], pageInfo: { hasNextPage: false } } };
      } else if (q.includes("metaobjects(")) {
        data = { metaobjects: { edges: [{ node: { id: "mo1" } }], pageInfo: { hasNextPage: false } } };
      } else if (q.includes("urlRedirects(")) {
        data = { urlRedirects: { edges: [], pageInfo: { hasNextPage: false } } };
      } else if (q.includes("files(")) {
        data = {
          files: {
            edges: [
              { node: { id: "f1", __typename: "MediaImage", mimeType: "image/webp" } },
              { node: { id: "f2", mimeType: "application/pdf" } },
              { node: { id: "f3", mimeType: "video/mp4" } },
            ],
            pageInfo: { hasNextPage: false },
          },
        };
      }

      return Promise.resolve({
        ok: true,
        headers: { get: () => "2026-10" },
        json: () => Promise.resolve({ data }),
        text: () => Promise.resolve(""),
      });
    });

    global.fetch = mockFetch as unknown as typeof fetch;

    const client = createSourceClient("test.myshopify.com", "token", false);
    const result = await runInventory(client, "test.myshopify.com");

    expect(result.counts.products).toBe(2);
    expect(result.counts.collections).toBe(1);
    expect(result.counts.files).toBe(3);
    expect(result.fileBreakdown.images).toBe(1);
    expect(result.fileBreakdown.documents).toBe(1);
    expect(result.fileBreakdown.videos).toBe(1);
    expect(result.inaccessible).toHaveLength(0);

    // Verify report writing
    generateReports(result, TEST_REPORTS_DIR);

    expect(fs.existsSync(path.join(TEST_REPORTS_DIR, "01-source-inventory.json"))).toBe(true);
    expect(fs.existsSync(path.join(TEST_REPORTS_DIR, "01-source-inventory.md"))).toBe(true);
    expect(fs.existsSync(path.join(TEST_REPORTS_DIR, "01-inaccessible.md"))).toBe(true);

    const mdContent = fs.readFileSync(path.join(TEST_REPORTS_DIR, "01-source-inventory.md"), "utf8");
    expect(mdContent).toContain("Files Breakdown by Type");
    expect(mdContent).toContain("products");
  });

  it("handles inaccessible resources without crashing the audit", async () => {
    const mockFetch = vi.fn().mockImplementation((_url: string, init?: { body: string }) => {
      const body = JSON.parse(init?.body ?? "{}") as { query: string };
      if (body.query.includes("orders(")) {
        return Promise.resolve({
          ok: false,
          status: 403,
          headers: { get: () => "2026-10" },
          json: () => Promise.resolve({ errors: [{ message: "Access denied for orders" }] }),
          text: () => Promise.resolve("Access denied for orders"),
        });
      }
      return Promise.resolve({
        ok: true,
        headers: { get: () => "2026-10" },
        json: () => Promise.resolve({ data: { products: { edges: [], pageInfo: { hasNextPage: false } } } }),
        text: () => Promise.resolve(""),
      });
    });

    global.fetch = mockFetch as unknown as typeof fetch;

    const client = createSourceClient("test.myshopify.com", "token", false);
    const result = await runInventory(client, "test.myshopify.com");

    expect(result.inaccessible.length).toBeGreaterThan(0);
    const orderIssue = result.inaccessible.find((i) => i.resource === "orders");
    expect(orderIssue).toBeDefined();
    expect(orderIssue?.requiredScope).toContain("read_orders");

    generateReports(result, TEST_REPORTS_DIR);
    const inaccMd = fs.readFileSync(path.join(TEST_REPORTS_DIR, "01-inaccessible.md"), "utf8");
    expect(inaccMd).toContain("orders");
  });
});
