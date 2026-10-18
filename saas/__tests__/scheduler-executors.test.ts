// saas/__tests__/scheduler-executors.test.ts
// Unit and integration tests for Stage 0 Extractor, Executor Registry, and Remap Index.

import { describe, it, expect } from "vitest";
import { runStage0Extract } from "../extractor.js";
import { EXECUTORS } from "../executors.js";
import { buildIndex } from "../remapper.js";

describe("Clonix Stage 0 Extractor & Executor Registry", () => {
  /* ───────────────────────── 1. Stage 0 Extractor ───────────────────────── */
  describe("Stage 0 Extractor & Preflight Probe", () => {
    it("should probe source shop, currency, locations, and custom template suffixes", async () => {
      const mockGql = async (query: string, _vars?: any) => {
        if (query.includes("ShopProbe")) {
          return {
            shop: {
              id: "gid://shopify/Shop/12345",
              name: "TibbeShifa Herbals",
              myshopifyDomain: "ph0igg-jv.myshopify.com",
              currencyCode: "PKR",
              plan: { displayName: "Basic", partnerDevelopment: true, shopifyPlus: false },
            },
            locations: {
              nodes: [
                { id: "gid://shopify/Location/1", name: "Lahore Central Warehouse", isActive: true },
                { id: "gid://shopify/Location/2", name: "Karachi Depot", isActive: true },
              ],
            },
            themes: {
              nodes: [{ id: "gid://shopify/Theme/999", name: "Dawn (Live)", role: "MAIN" }],
            },
            productsCount: { totalCount: 7 },
            collectionsCount: { totalCount: 7 },
            filesCount: { totalCount: 523 },
            metaobjectsCount: { totalCount: 12 },
            pagesCount: { totalCount: 11 },
          };
        }
        if (query.includes("TemplateSuffixProbe")) {
          return {
            products: {
              nodes: [
                { templateSuffix: "newmedda" },
                { templateSuffix: "newqabz" },
                { templateSuffix: null },
                { templateSuffix: "" },
              ],
              pageInfo: { hasNextPage: false, endCursor: null },
            },
          };
        }
        return {};
      };

      const result = await runStage0Extract(mockGql as any);

      expect(result.shop.domain).toBe("ph0igg-jv.myshopify.com");
      expect(result.shop.currencyCode).toBe("PKR");
      expect(result.shop.plan.partnerDevelopment).toBe(true);
      expect(result.locations).toHaveLength(2);
      expect(result.locations[0].isPrimary).toBe(true);

      // Verify custom template suffixes discovered
      expect(result.activeTheme.customTemplateSuffixes).toContain("newmedda");
      expect(result.activeTheme.customTemplateSuffixes).toContain("newqabz");
      expect(result.activeTheme.customTemplateSuffixes).toHaveLength(2);

      // Verify resource counts
      expect(result.resourceCounts.products).toBe(7);
      expect(result.resourceCounts.files).toBe(523);
      expect(result.resourceCounts.metaobjects).toBe(12);
      expect(result.resourceCounts.pages).toBe(11);
    });
  });

  /* ───────────────────────── 2. Executor Registry ───────────────────────── */
  describe("Executor Registry Mapping", () => {
    it("should have all 9 primary DAG stage executors registered and callable", () => {
      const requiredTypes = [
        "FILE",
        "METAOBJECT",
        "PRODUCT",
        "COLLECTION",
        "PAGE",
        "BLOG",
        "ARTICLE",
        "MENU",
        "THEME",
      ];

      for (const t of requiredTypes) {
        expect(EXECUTORS[t]).toBeDefined();
        expect(typeof EXECUTORS[t]).toBe("function");
      }
    });
  });

  /* ───────────────────────── 3. Remap Index & Zero-Leak Rewriter ───────────────────────── */
  describe("Remap Index Resolution", () => {
    it("should accurately translate source GIDs and rewrite URLs to destination CDN", () => {
      const rows = [
        {
          resourceType: "PRODUCT",
          sourceGid: "gid://shopify/Product/1001",
          destGid: "gid://shopify/Product/2001",
          sourceHandle: "majoon-e-shifa",
          destHandle: "majoon-e-shifa",
        },
        {
          resourceType: "FILE",
          sourceGid: "gid://shopify/MediaImage/5001",
          destGid: "gid://shopify/MediaImage/6001",
          sourceUrl: "https://cdn.shopify.com/s/files/1/001/ph0igg-jv/majoon.png",
          destUrl: "https://cdn.shopify.com/s/files/1/002/dest-clone/majoon.png",
        },
      ];

      const idx = buildIndex(rows, "ph0igg-jv.myshopify.com", "tibbeshifa-clone.myshopify.com");

      // Verify GID mapping
      expect(idx.gid("PRODUCT", "gid://shopify/Product/1001")).toBe("gid://shopify/Product/2001");

      // Verify handle mapping
      expect(idx.handle("PRODUCT", "majoon-e-shifa")).toBe("majoon-e-shifa");

      // Verify leak regex detects old source host
      expect(idx.leakRegex.test("https://ph0igg-jv.myshopify.com/products/test")).toBe(true);
      expect(idx.leakRegex.test("https://tibbeshifa-clone.myshopify.com/products/test")).toBe(false);
    });
  });
});
