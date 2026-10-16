/**
 * Tests for Phase 5 URL & Reference Scanner.
 *
 * Verifies:
 * 1. classifyReference accurately classifies all 5 reference types.
 * 2. scanTextForReferences extracts URLs and applies classifications.
 * 3. scanBackupDirectory and generateUrlScanReport produce structured Markdown analysis.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import {
  classifyReference,
  scanTextForReferences,
  scanBackupDirectory,
  generateUrlScanReport,
} from "../url-scanner/url-scanner.js";

const TEST_SCAN_DIR = "test-scan-backup";
const TEST_REPORTS_DIR = "test-scan-reports";

describe("classifyReference", () => {
  const CUSTOM = "tibbeshifa.com";
  const MYSHOPIFY = "tibbeshifa.myshopify.com";

  it("classifies shopify:// protocol links", () => {
    const res = classifyReference("shopify://shop_images/banner.webp", CUSTOM, MYSHOPIFY);
    expect(res.type).toBe("SHOPIFY_PROTOCOL");
    expect(res.action).toBe("preserve_handle_or_filename");
  });

  it("classifies old CDN links", () => {
    const res = classifyReference("https://cdn.shopify.com/s/files/1/0001/files/herb.jpg", CUSTOM, MYSHOPIFY);
    expect(res.type).toBe("OLD_CDN");
    expect(res.action).toBe("remap_to_dest_file");
  });

  it("classifies old myshopify domain URLs", () => {
    const res = classifyReference("https://tibbeshifa.myshopify.com/products/item-1", CUSTOM, MYSHOPIFY);
    expect(res.type).toBe("OLD_MYSHOPIFY");
    expect(res.action).toBe("remap_to_dest_shop");
  });

  it("classifies custom live domain URLs", () => {
    const res = classifyReference("https://tibbeshifa.com/pages/about-us", CUSTOM, MYSHOPIFY);
    expect(res.type).toBe("CUSTOM_DOMAIN");
    expect(res.action).toBe("keep_on_domain_transfer");
  });

  it("classifies WhatsApp and social links as third party to keep untouched", () => {
    const res = classifyReference("https://wa.me/923001234567?text=order", CUSTOM, MYSHOPIFY);
    expect(res.type).toBe("THIRD_PARTY");
    expect(res.action).toBe("keep_untouched");
  });

  it("scanTextForReferences extracts and classifies all URLs found in rich HTML", () => {
    const html = `<p>Visit <a href="https://tibbeshifa.com/about">Us</a> or <a href="shopify://pages/faq">FAQ</a></p>`;
    const matches = scanTextForReferences(html, "pages/body", CUSTOM, MYSHOPIFY);
    expect(matches).toHaveLength(2);
    expect(matches[0]?.type).toBe("CUSTOM_DOMAIN");
    expect(matches[1]?.type).toBe("SHOPIFY_PROTOCOL");
  });
});

describe("scanBackupDirectory and report generation", () => {
  beforeEach(() => {
    if (fs.existsSync(TEST_SCAN_DIR)) fs.rmSync(TEST_SCAN_DIR, { recursive: true, force: true });
    if (fs.existsSync(TEST_REPORTS_DIR)) fs.rmSync(TEST_REPORTS_DIR, { recursive: true, force: true });
  });

  afterEach(() => {
    if (fs.existsSync(TEST_SCAN_DIR)) fs.rmSync(TEST_SCAN_DIR, { recursive: true, force: true });
    if (fs.existsSync(TEST_REPORTS_DIR)) fs.rmSync(TEST_REPORTS_DIR, { recursive: true, force: true });
  });

  it("scans mock files and generates 03-url-scan.md", () => {
    const jsonDir = path.join(TEST_SCAN_DIR, "json");
    const themeDir = path.join(TEST_SCAN_DIR, "theme", "sections");
    fs.mkdirSync(jsonDir, { recursive: true });
    fs.mkdirSync(themeDir, { recursive: true });

    // Mock product JSON containing CDN image and WhatsApp link
    fs.writeFileSync(
      path.join(jsonDir, "products.json"),
      JSON.stringify([
        {
          handle: "oil-1",
          descriptionHtml: '<p>Buy now: <a href="https://wa.me/923001234567">WhatsApp</a></p><img src="https://cdn.shopify.com/s/files/1/0001/files/oil.png">',
        },
      ]),
      "utf8"
    );

    // Mock theme section containing shopify:// image
    fs.writeFileSync(
      path.join(themeDir, "header.liquid"),
      `<div><img src="shopify://shop_images/logo.png" /> <a href="https://tibbeshifa.myshopify.com/contact">Contact</a></div>`,
      "utf8"
    );

    const summary = scanBackupDirectory(TEST_SCAN_DIR, "tibbeshifa.com", "tibbeshifa.myshopify.com");

    expect(summary.totalReferences).toBe(4);
    expect(summary.byType.THIRD_PARTY).toBe(1);
    expect(summary.byType.OLD_CDN).toBe(1);
    expect(summary.byType.SHOPIFY_PROTOCOL).toBe(1);
    expect(summary.byType.OLD_MYSHOPIFY).toBe(1);

    generateUrlScanReport(summary, TEST_REPORTS_DIR);

    const reportPath = path.join(TEST_REPORTS_DIR, "03-url-scan.md");
    expect(fs.existsSync(reportPath)).toBe(true);
    const md = fs.readFileSync(reportPath, "utf8");
    expect(md).toContain("URL and Reference Analysis Report");
    expect(md).toContain("OLD_CDN");
    expect(md).toContain("SHOPIFY_PROTOCOL");
  });
});
