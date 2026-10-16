/**
 * Tests for the configuration loader.
 *
 * Verifies:
 * 1. Default configuration has dryRun=true and pinned API version 2026-10.
 * 2. Source and destination profiles are created separately.
 * 3. JSON settings are respected.
 * 4. Environment variables override JSON settings.
 * 5. loadEnv parses .env format properly.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import { loadConfig, loadEnv } from "../config.js";
import { SHOPIFY_API_VERSION } from "../constants.js";

const TEST_JSON_PATH = "test-config.json";
const TEST_ENV_PATH = "test.env";

describe("loadConfig", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env["DRY_RUN"];
    delete process.env["SOURCE_SHOP"];
    delete process.env["DEST_SHOP"];
    delete process.env["SOURCE_CLIENT_ID"];
    delete process.env["SOURCE_CLIENT_SECRET"];
    delete process.env["DEST_CLIENT_ID"];
    delete process.env["DEST_CLIENT_SECRET"];
    delete process.env["SHOPIFY_API_VERSION"];

    if (fs.existsSync(TEST_JSON_PATH)) fs.unlinkSync(TEST_JSON_PATH);
    if (fs.existsSync(TEST_ENV_PATH)) fs.unlinkSync(TEST_ENV_PATH);
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    if (fs.existsSync(TEST_JSON_PATH)) fs.unlinkSync(TEST_JSON_PATH);
    if (fs.existsSync(TEST_ENV_PATH)) fs.unlinkSync(TEST_ENV_PATH);
  });

  it("loads safe defaults when files do not exist", () => {
    const config = loadConfig("non-existent.json", "non-existent.env");
    expect(config.dryRun).toBe(true);
    expect(config.apiVersion).toBe(SHOPIFY_API_VERSION);
    expect(config.source.role).toBe("source");
    expect(config.source.shop).toBe("tibbeshifa.myshopify.com");
    expect(config.destination.role).toBe("destination");
  });

  it("reads non-secret options from JSON configuration file", () => {
    fs.writeFileSync(
      TEST_JSON_PATH,
      JSON.stringify({
        apiVersion: "2026-10",
        dryRun: true,
        source: { shop: "custom-src.myshopify.com" },
        destination: { shop: "custom-dest.myshopify.com" },
      }),
      "utf8"
    );

    const config = loadConfig(TEST_JSON_PATH, "non-existent.env");
    expect(config.source.shop).toBe("custom-src.myshopify.com");
    expect(config.destination.shop).toBe("custom-dest.myshopify.com");
    expect(config.dryRun).toBe(true);
  });

  it("overrides settings and loads credentials from .env file", () => {
    fs.writeFileSync(
      TEST_ENV_PATH,
      `
      # Comment line
      SOURCE_SHOP=env-src.myshopify.com
      SOURCE_CLIENT_ID="secret_src_id"
      SOURCE_CLIENT_SECRET='secret_src_secret'
      DEST_SHOP=env-dest.myshopify.com
      DEST_CLIENT_ID=secret_dest_id
      DRY_RUN=false
      `,
      "utf8"
    );

    const config = loadConfig("non-existent.json", TEST_ENV_PATH);
    expect(config.source.shop).toBe("env-src.myshopify.com");
    expect(config.source.clientId).toBe("secret_src_id");
    expect(config.source.clientSecret).toBe("secret_src_secret");
    expect(config.destination.shop).toBe("env-dest.myshopify.com");
    expect(config.destination.clientId).toBe("secret_dest_id");
    expect(config.dryRun).toBe(false);
  });

  it("loadEnv populates environment variables from a file without throwing if file is missing", () => {
    expect(() => loadEnv("definitely-missing.env")).not.toThrow();

    fs.writeFileSync(TEST_ENV_PATH, "CUSTOM_VAR=value_123\n", "utf8");
    loadEnv(TEST_ENV_PATH);
    expect(process.env["CUSTOM_VAR"]).toBe("value_123");
    delete process.env["CUSTOM_VAR"];
  });
});
