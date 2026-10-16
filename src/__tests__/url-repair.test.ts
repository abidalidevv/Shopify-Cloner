/**
 * Unit tests for Section 7 URL repair engine.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { replaceInJsonObject, repairDirectory } from "../url-scanner/url-repair.js";

const TEST_REPAIR_DIR = "test-repair-root";
const TEST_REPORTS_DIR = "test-repair-reports";

describe("Section 7 URL Repair Engine", () => {
  beforeEach(() => {
    if (fs.existsSync(TEST_REPAIR_DIR)) fs.rmSync(TEST_REPAIR_DIR, { recursive: true, force: true });
    if (fs.existsSync(TEST_REPORTS_DIR)) fs.rmSync(TEST_REPORTS_DIR, { recursive: true, force: true });
    fs.mkdirSync(TEST_REPAIR_DIR, { recursive: true });
  });

  afterEach(() => {
    if (fs.existsSync(TEST_REPAIR_DIR)) fs.rmSync(TEST_REPAIR_DIR, { recursive: true, force: true });
    if (fs.existsSync(TEST_REPORTS_DIR)) fs.rmSync(TEST_REPORTS_DIR, { recursive: true, force: true });
  });

  it("replaceInJsonObject replaces strings inside nested JSON trees", () => {
    const input = {
      section: {
        banner: "https://cdn.shopify.com/s/files/1/001/banner.jpg",
        title: "TibbeShifa",
        items: ["https://cdn.shopify.com/s/files/1/001/thumb.jpg", "regular text"],
      },
    };

    const { modified, result } = replaceInJsonObject(input, (s) =>
      s.replace("https://cdn.shopify.com/s/files/1/001/", "https://cdn.shopify.com/s/files/1/999/")
    );

    expect(modified).toBe(true);
    const res = result as typeof input;
    expect(res.section.banner).toBe("https://cdn.shopify.com/s/files/1/999/banner.jpg");
    expect(res.section.items[0]).toBe("https://cdn.shopify.com/s/files/1/999/thumb.jpg");
    expect(res.section.items[1]).toBe("regular text");
  });

  it("repairDirectory generates preview diff and preserves files in dry-run mode", () => {
    const jsonFile = path.join(TEST_REPAIR_DIR, "settings_data.json");
    const jsonContent = JSON.stringify({
      logo: "https://cdn.shopify.com/s/files/1/001/logo.png",
      domain: "ph0igg-jv.myshopify.com",
    });
    fs.writeFileSync(jsonFile, jsonContent, "utf8");

    const summary = repairDirectory(TEST_REPAIR_DIR, {
      sourceMyshopify: "ph0igg-jv.myshopify.com",
      destMyshopify: "new-dest.myshopify.com",
      fileUrlMap: {
        "https://cdn.shopify.com/s/files/1/001/logo.png": "https://cdn.shopify.com/s/files/1/999/logo.png",
      },
      dryRun: true,
      reportsDir: TEST_REPORTS_DIR,
    });

    expect(summary.filesScanned).toBe(1);
    expect(summary.filesModified).toBe(1);
    expect(summary.replacements.length).toBe(2);

    // Dry run: original file on disk must NOT be modified
    const currentOnDisk = fs.readFileSync(jsonFile, "utf8");
    expect(currentOnDisk).toBe(jsonContent);

    // Report must be generated
    const reportPath = path.join(TEST_REPORTS_DIR, "05-url-repair-preview.md");
    expect(fs.existsSync(reportPath)).toBe(true);
  });

  it("repairDirectory writes updates and .bak files when dryRun is false", () => {
    const liquidFile = path.join(TEST_REPAIR_DIR, "header.liquid");
    const initialCode = `<a href="https://ph0igg-jv.myshopify.com">Home</a>`;
    fs.writeFileSync(liquidFile, initialCode, "utf8");

    const summary = repairDirectory(TEST_REPAIR_DIR, {
      sourceMyshopify: "ph0igg-jv.myshopify.com",
      destMyshopify: "new-dest.myshopify.com",
      fileUrlMap: {},
      dryRun: false,
      reportsDir: TEST_REPORTS_DIR,
    });

    expect(summary.filesModified).toBe(1);

    // Verify .bak created
    expect(fs.existsSync(`${liquidFile}.bak`)).toBe(true);
    expect(fs.readFileSync(`${liquidFile}.bak`, "utf8")).toBe(initialCode);

    // Verify content rewritten
    expect(fs.readFileSync(liquidFile, "utf8")).toBe(`<a href="https://new-dest.myshopify.com">Home</a>`);
  });

  it("createWorkingRepairCopy ensures original archive checksums remain 100% byte-identical after repair", async () => {
    const crypto = await import("node:crypto");
    const { createWorkingRepairCopy } = await import("../url-scanner/url-repair.js");

    const ARCHIVE_DIR = path.join(TEST_REPAIR_DIR, "source-archive");
    const WORKING_COPY_DIR = path.join(TEST_REPAIR_DIR, "working-repair-copy");

    fs.mkdirSync(ARCHIVE_DIR, { recursive: true });
    const originalFile1 = path.join(ARCHIVE_DIR, "settings.json");
    const originalFile2 = path.join(ARCHIVE_DIR, "index.liquid");

    fs.writeFileSync(originalFile1, JSON.stringify({ oldUrl: "https://cdn.shopify.com/old/img.jpg" }), "utf8");
    fs.writeFileSync(originalFile2, `<a href="https://ph0igg-jv.myshopify.com">Store</a>`, "utf8");

    // 1. Compute original checksums
    const getHash = (p: string): string =>
      crypto.createHash("sha256").update(fs.readFileSync(p)).digest("hex");

    const initialHash1 = getHash(originalFile1);
    const initialHash2 = getHash(originalFile2);

    // 2. Create working copy
    createWorkingRepairCopy(ARCHIVE_DIR, WORKING_COPY_DIR);

    // 3. Run live repair on working copy ONLY
    repairDirectory(WORKING_COPY_DIR, {
      sourceMyshopify: "ph0igg-jv.myshopify.com",
      destMyshopify: "new-dest.myshopify.com",
      fileUrlMap: { "https://cdn.shopify.com/old/img.jpg": "https://cdn.shopify.com/new/img.jpg" },
      dryRun: false,
      reportsDir: TEST_REPORTS_DIR,
    });

    // 4. Verify working copy WAS modified
    const workingFile1 = path.join(WORKING_COPY_DIR, "settings.json");
    expect(fs.readFileSync(workingFile1, "utf8")).toContain("https://cdn.shopify.com/new/img.jpg");
    expect(fs.existsSync(`${workingFile1}.bak`)).toBe(true);

    // 5. CRITICAL ASSERTION: Original archive checksums MUST be byte-identical
    const postRepairHash1 = getHash(originalFile1);
    const postRepairHash2 = getHash(originalFile2);

    expect(postRepairHash1).toBe(initialHash1);
    expect(postRepairHash2).toBe(initialHash2);

    // No .bak files created in original archive
    expect(fs.existsSync(`${originalFile1}.bak`)).toBe(false);
    expect(fs.existsSync(`${originalFile2}.bak`)).toBe(false);
  });
});
