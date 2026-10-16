/**
 * Configuration manager.
 *
 * Merges:
 * 1. Non-secret store settings from config.json (or defaults)
 * 2. Secret credentials from .env / process.env
 *
 * Enforces:
 * - Two distinct profiles: "source" and "destination"
 * - Pinned API version (2026-10)
 * - Dry-run default: true unless explicitly overridden
 * - Secrets are kept out of committed files and logs
 */

import * as fs from "node:fs";
import { SHOPIFY_API_VERSION } from "./constants.js";
import { logger } from "./logger.js";

export type AuthMode = "client_credentials" | "auth_code";

export interface ProfileConfig {
  role: "source" | "destination";
  shop: string;
  authMode: AuthMode;
  clientId?: string | undefined;
  clientSecret?: string | undefined;
  adminToken?: string | undefined;
}

export interface AppConfig {
  apiVersion: string;
  dryRun: boolean;
  source: ProfileConfig;
  destination: ProfileConfig;
}

export interface JsonConfig {
  apiVersion?: string;
  dryRun?: boolean;
  source?: {
    shop?: string;
    authMode?: AuthMode;
  };
  destination?: {
    shop?: string;
    authMode?: AuthMode;
  };
}

/** Parses simple KEY=VALUE syntax from a .env file into process.env if not already set. */
export function loadEnv(envPath = ".env"): void {
  if (!fs.existsSync(envPath)) return;
  try {
    const content = fs.readFileSync(envPath, "utf8");
    for (const line of content.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eqIdx = trimmed.indexOf("=");
      if (eqIdx === -1) continue;
      const key = trimmed.slice(0, eqIdx).trim();
      let val = trimmed.slice(eqIdx + 1).trim();
      if (
        (val.startsWith('"') && val.endsWith('"')) ||
        (val.startsWith("'") && val.endsWith("'"))
      ) {
        val = val.slice(1, -1);
      }
      if (process.env[key] === undefined) {
        process.env[key] = val;
      }
    }
  } catch (err) {
    logger.warn(`Failed reading env file at ${envPath}`, { error: String(err) });
  }
}

/**
 * Loads and merges non-secret JSON configuration with environment secrets.
 */
export function loadConfig(jsonPath = "config.json", envPath = ".env"): AppConfig {
  loadEnv(envPath);

  let jsonConfig: JsonConfig = {};
  if (fs.existsSync(jsonPath)) {
    try {
      jsonConfig = JSON.parse(fs.readFileSync(jsonPath, "utf8")) as JsonConfig;
    } catch (err) {
      logger.warn(`Could not parse JSON config at ${jsonPath}, falling back to defaults`, {
        error: String(err),
      });
    }
  }

  const dryRunEnv = process.env["DRY_RUN"];
  const dryRun =
    dryRunEnv !== undefined
      ? dryRunEnv.toLowerCase() !== "false"
      : (jsonConfig.dryRun ?? true);

  const sourceShop =
    process.env["SOURCE_SHOP"] ||
    jsonConfig.source?.shop ||
    "tibbeshifa.myshopify.com";
  const destShop =
    process.env["DEST_SHOP"] ||
    jsonConfig.destination?.shop ||
    "";

  const sourceProfile: ProfileConfig = {
    role: "source",
    shop: sourceShop,
    authMode: jsonConfig.source?.authMode ?? "client_credentials",
    clientId: process.env["SOURCE_CLIENT_ID"] || undefined,
    clientSecret: process.env["SOURCE_CLIENT_SECRET"] || undefined,
    adminToken: process.env["SOURCE_ADMIN_TOKEN"] || undefined,
  };

  const destProfile: ProfileConfig = {
    role: "destination",
    shop: destShop,
    authMode: jsonConfig.destination?.authMode ?? "client_credentials",
    clientId: process.env["DEST_CLIENT_ID"] || undefined,
    clientSecret: process.env["DEST_CLIENT_SECRET"] || undefined,
    adminToken: process.env["DEST_ADMIN_TOKEN"] || undefined,
  };

  return {
    apiVersion:
      process.env["SHOPIFY_API_VERSION"] ||
      jsonConfig.apiVersion ||
      SHOPIFY_API_VERSION,
    dryRun,
    source: sourceProfile,
    destination: destProfile,
  };
}
