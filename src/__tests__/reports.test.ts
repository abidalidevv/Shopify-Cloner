/**
 * Unit tests for Phase 7 Acceptance Report and Section 6 Manual Checklist.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { generateAcceptanceReport } from "../reports/acceptance-report.js";
import { generateManualChecklist } from "../reports/manual-checklist.js";

const TEST_REPORTS_DIR = "test-reports-unit";

describe("Phase 7 & Section 6 Reports", () => {
  beforeEach(() => {
    if (fs.existsSync(TEST_REPORTS_DIR)) {
      fs.rmSync(TEST_REPORTS_DIR, { recursive: true, force: true });
    }
  });

  afterEach(() => {
    if (fs.existsSync(TEST_REPORTS_DIR)) {
      fs.rmSync(TEST_REPORTS_DIR, { recursive: true, force: true });
    }
  });

  it("generateAcceptanceReport produces MATCHED status when parity is reached", () => {
    const sourceCounts = {
      products: 7,
      collections: 7,
      pages: 11,
      menus: 3,
      metaobjects: 12,
      redirects: 1,
      files: 523,
      translations: 42,
      orders: 3,
      customers: 2,
    };

    const destCounts = {
      products: 7,
      collections: 7,
      pages: 11,
      menus: 3,
      metaobjects: 12,
      redirects: 1,
      files: 523,
      translations: 42,
      orders: 0,
      customers: 0,
    };

    const summary = generateAcceptanceReport(
      sourceCounts,
      destCounts,
      "ph0igg-jv.myshopify.com",
      "dest.myshopify.com",
      TEST_REPORTS_DIR
    );

    expect(summary.overallStatus).toBe("ACCEPTED");
    expect(summary.sourceStore).toBe("ph0igg-jv.myshopify.com");
    expect(summary.destStore).toBe("dest.myshopify.com");

    const jsonPath = path.join(TEST_REPORTS_DIR, "10-acceptance-report.json");
    const mdPath = path.join(TEST_REPORTS_DIR, "10-acceptance-report.md");

    expect(fs.existsSync(jsonPath)).toBe(true);
    expect(fs.existsSync(mdPath)).toBe(true);

    const json = JSON.parse(fs.readFileSync(jsonPath, "utf8")) as { overallStatus: string };
    expect(json.overallStatus).toBe("ACCEPTED");

    const md = fs.readFileSync(mdPath, "utf8");
    expect(md).toContain("ph0igg-jv.myshopify.com");
    expect(md).toContain("✅ MATCHED");
    expect(md).toContain("ℹ️ ARCHIVE_ONLY");
  });

  it("generateAcceptanceReport flags ACTION_REQUIRED when destination is missing items", () => {
    const sourceCounts = { products: 7, pages: 11 };
    const destCounts = { products: 5, pages: 11 };

    const summary = generateAcceptanceReport(
      sourceCounts,
      destCounts,
      "ph0igg-jv.myshopify.com",
      "dest.myshopify.com",
      TEST_REPORTS_DIR
    );

    expect(summary.overallStatus).toBe("ACTION_REQUIRED");
    const productRow = summary.rows.find((r) => r.resource === "Products");
    expect(productRow?.status).toBe("MISSING");
    expect(productRow?.notes).toContain("Missing 2 items");
  });

  it("generateManualChecklist writes manual-checklist.md with essential action items", () => {
    generateManualChecklist(TEST_REPORTS_DIR);

    const checklistPath = path.join(TEST_REPORTS_DIR, "manual-checklist.md");
    expect(fs.existsSync(checklistPath)).toBe(true);

    const content = fs.readFileSync(checklistPath, "utf8");
    expect(content).toContain("Cash on Delivery (COD)");
    expect(content).toContain("COD King");
    expect(content).toContain("Judge.me Product Reviews");
    expect(content).toContain("Custom Product Templates Verification (All 7 Products)");
    expect(content).toContain("Final Domain Transfer Plan");
    expect(content).toContain("tibbeshifa.com");
  });
});
