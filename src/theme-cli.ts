/**
 * Theme Manager CLI (Shopify CLI Wrapper for Phase 4 & Phase 6).
 *
 * STATUS: DRAFT / UNVERIFIED against live store.
 * Mock-tested only in Vitest fixtures. Zero operations verified against a live store.
 *
 * Implements strict compliance with TIBBESHIFA_MIGRATION_GOAL:
 * - Uses official Shopify CLI (NEVER themeFilesUpsert API).
 * - Pulls live Horizon theme to backups/source-store/theme/.
 * - Runs `shopify theme check`.
 * - Pushes to destination as --unpublished only (NEVER auto-publish).
 *
 * Usage:
 *   npm run theme -- pull
 *   npm run theme -- check
 *   npm run theme -- push
 */

import { execSync } from "node:child_process";
import * as fs from "node:fs";
import { loadConfig } from "./config.js";
import { resolveAccessToken } from "./auth.js";

async function main(): Promise<void> {
  console.log("\n=======================================================");
  console.log(" TibbeShifa Migrator — Theme Manager (Shopify CLI)");
  console.log("=======================================================\n");

  const config = loadConfig();
  const action = process.argv[2] ?? "pull";
  const themeDir = "backups/source-store/theme";

  // Check if shopify CLI is available (global or npx fallback)
  let shopifyCmd = "shopify";
  try {
    execSync("shopify version", { stdio: "ignore" });
  } catch {
    shopifyCmd = "npx --yes @shopify/cli";
  }

  if (action === "pull") {
    console.log(`Pulling live Horizon theme from source store: ${config.source.shop}...`);
    fs.mkdirSync(themeDir, { recursive: true });
    try {
      const token = await resolveAccessToken(config.source);
      const passwordArg = token ? `--password ${token}` : "";
      execSync(`${shopifyCmd} theme pull --store ${config.source.shop} --live ${passwordArg} --path ${themeDir}`, {
        stdio: "inherit",
        env: {
          ...process.env,
          ...(token ? { SHOPIFY_CLI_THEME_TOKEN: token } : {}),
        },
      });
      console.log(`\n✅ Theme pulled successfully into ${themeDir}`);
    } catch (err) {
      console.error("\n❌ Failed to pull theme via Shopify CLI:", String(err));
      process.exit(1);
    }
  } else if (action === "check") {
    console.log(`Running shopify theme check on ${themeDir}...`);
    try {
      execSync(`${shopifyCmd} theme check --path ${themeDir}`, { stdio: "inherit" });
      console.log("\n✅ Theme check passed.");
    } catch (err) {
      console.warn("\n⚠️ Theme check reported warnings/errors:", String(err));
    }
  } else if (action === "push") {
    if (!config.destination.shop) {
      console.error("❌ Destination store not configured. Please set DEST_SHOP in .env first.");
      process.exit(1);
    }

    const confirmDest = process.argv.find((a) => a.startsWith("--confirm-dest="))?.split("=")[1];
    if (!confirmDest || confirmDest !== config.destination.shop) {
      console.error("❌ SAFETY GUARD BLOCKED: Theme push requires typed destination domain confirmation.");
      console.error(`Expected: --confirm-dest=${config.destination.shop}`);
      console.error(`Received: ${confirmDest ? `--confirm-dest=${confirmDest}` : "(Missing --confirm-dest)"}`);
      process.exit(1);
    }

    console.log(`Pushing theme to destination store: ${config.destination.shop} as UNPUBLISHED...`);
    try {
      const token = await resolveAccessToken(config.destination);
      const passwordArg = token ? `--password ${token}` : "";
      execSync(
        `${shopifyCmd} theme push --store ${config.destination.shop} --unpublished --theme "Horizon-Migrated" ${passwordArg} --path ${themeDir}`,
        {
          stdio: "inherit",
          env: {
            ...process.env,
            ...(token ? { SHOPIFY_CLI_THEME_TOKEN: token } : {}),
          },
        }
      );
      console.log("\n✅ Theme pushed successfully as UNPUBLISHED.");
      console.log("⚠️ Hard Safety Rule 3 Enforced: Destination theme is NEVER published automatically.\n");
    } catch (err) {
      console.error("\n❌ Failed to push theme via Shopify CLI:", String(err));
      process.exit(1);
    }
  } else {
    console.log("Available actions: `npm run theme -- pull`, `npm run theme -- check`, `npm run theme -- push`\n");
  }
}

void main();
