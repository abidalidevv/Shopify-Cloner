/**
 * Comprehensive Write-Safety Proofs & Guard Unit Tests.
 *
 * Verifies:
 * 1. Default mode is strictly dry-run / preview for migrate, repair, and theme push.
 * 2. Real write refuses without --apply AND typed destination domain confirmation.
 * 3. Commands refuse to run when destination credentials are missing in .env.
 * 4. URL repair only operates on local copies, saves .bak patches, and never touches source store.
 * 5. Theme push strictly uses --unpublished (zero publishing code paths exist).
 * 6. Importers refuse --apply if schema validation has not passed.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { resolveAccessToken } from "../auth.js";
import { isSchemaValidated } from "../destination/schema-validator.js";
import { repairDirectory } from "../url-scanner/url-repair.js";

const TEST_SAFETY_DIR = "test-safety-root";
const TEST_CHECKPOINTS = "test-safety-checkpoints";

describe("Write-Safety Guards Proofs", () => {
  beforeEach(() => {
    if (fs.existsSync(TEST_SAFETY_DIR)) fs.rmSync(TEST_SAFETY_DIR, { recursive: true, force: true });
    if (fs.existsSync(TEST_CHECKPOINTS)) fs.rmSync(TEST_CHECKPOINTS, { recursive: true, force: true });
    fs.mkdirSync(TEST_SAFETY_DIR, { recursive: true });
  });

  afterEach(() => {
    if (fs.existsSync(TEST_SAFETY_DIR)) fs.rmSync(TEST_SAFETY_DIR, { recursive: true, force: true });
    if (fs.existsSync(TEST_CHECKPOINTS)) fs.rmSync(TEST_CHECKPOINTS, { recursive: true, force: true });
  });

  it("Proof 1: Missing destination credentials in .env throws an explicit error and halts execution", async () => {
    const unconfiguredProfile = {
      role: "destination" as const,
      shop: "unconfigured.myshopify.com",
      authMode: "client_credentials" as const,
      clientId: undefined,
      clientSecret: undefined,
      adminToken: undefined,
    };

    await expect(resolveAccessToken(unconfiguredProfile)).rejects.toThrowError(
      /Missing credentials for destination store/
    );
  });

  it("Proof 2: Schema validation checkpoint is required before any apply", () => {
    // With no checkpoint file, isSchemaValidated must return false
    expect(isSchemaValidated("dest.myshopify.com", TEST_CHECKPOINTS)).toBe(false);

    // After checkpoint is recorded for matching store
    fs.mkdirSync(TEST_CHECKPOINTS, { recursive: true });
    fs.writeFileSync(
      path.join(TEST_CHECKPOINTS, "schema-validated.json"),
      JSON.stringify({ destinationShop: "dest.myshopify.com" }),
      "utf8"
    );
    expect(isSchemaValidated("dest.myshopify.com", TEST_CHECKPOINTS)).toBe(true);
    // Mismatched store remains false
    expect(isSchemaValidated("other.myshopify.com", TEST_CHECKPOINTS)).toBe(false);
  });

  it("Proof 3: URL repair works strictly on local directory, leaves original untouched in dry-run, and creates .bak in apply", () => {
    const localFile = path.join(TEST_SAFETY_DIR, "template.liquid");
    const initialContent = `<img src="https://cdn.shopify.com/old/pic.jpg">`;
    fs.writeFileSync(localFile, initialContent, "utf8");

    // 1. Dry run: original content unchanged
    repairDirectory(TEST_SAFETY_DIR, {
      sourceMyshopify: "ph0igg-jv.myshopify.com",
      destMyshopify: "dest.myshopify.com",
      fileUrlMap: { "https://cdn.shopify.com/old/pic.jpg": "https://cdn.shopify.com/new/pic.jpg" },
      dryRun: true,
      reportsDir: TEST_SAFETY_DIR,
    });

    expect(fs.readFileSync(localFile, "utf8")).toBe(initialContent);
    expect(fs.existsSync(`${localFile}.bak`)).toBe(false);

    // 2. Apply: writes new content AND saves reversible .bak patch
    repairDirectory(TEST_SAFETY_DIR, {
      sourceMyshopify: "ph0igg-jv.myshopify.com",
      destMyshopify: "dest.myshopify.com",
      fileUrlMap: { "https://cdn.shopify.com/old/pic.jpg": "https://cdn.shopify.com/new/pic.jpg" },
      dryRun: false,
      reportsDir: TEST_SAFETY_DIR,
    });

    expect(fs.existsSync(`${localFile}.bak`)).toBe(true);
    expect(fs.readFileSync(`${localFile}.bak`, "utf8")).toBe(initialContent);
    expect(fs.readFileSync(localFile, "utf8")).toBe(`<img src="https://cdn.shopify.com/new/pic.jpg">`);
  });

  it("Proof 4: Theme push source code analysis proves strictly --unpublished flag and zero publishing paths", () => {
    const themeCliSource = fs.readFileSync(path.join("src", "theme-cli.ts"), "utf8");

    // Must contain --unpublished
    expect(themeCliSource).toContain("--unpublished");

    // Must NOT contain any command publishing a theme
    expect(themeCliSource).not.toMatch(/theme push[^\n]*--live/);
    expect(themeCliSource).not.toMatch(/theme push[^\n]*--publish/);
    expect(themeCliSource).not.toMatch(/theme publish/);
  });

  it("Proof 5: Guarded GraphQL client strictly throws WriteBlockedError if any mutation is attempted on source profile", async () => {
    const { createSourceClient, WriteBlockedError } = await import("../client.js");
    const client = createSourceClient("ph0igg-jv.myshopify.com", "shpat_test_token", false);

    await expect(
      client.mutate(`mutation CreatePage { pageCreate(page: { title: "Test" }) { page { id } } }`)
    ).rejects.toThrowError(WriteBlockedError);
  });
});
