/**
 * CLI Runner for Phase 5b: Destination Compatibility & Collision Matrix.
 *
 * Usage:
 *   npm run compat
 */

import { loadConfig } from "./config.js";
import { resolveAccessToken } from "./auth.js";
import { createDestClient } from "./client.js";
import {
  detectCollisions,
  generateCapabilityMatrixReport,
} from "./destination/compatibility-matrix.js";

async function main(): Promise<void> {
  console.log("\n=================================================================");
  console.log(" TibbeShifa Migrator — Phase 5b: Destination Compatibility Matrix");
  console.log("=================================================================\n");

  const config = loadConfig();

  if (!config.destination.shop) {
    console.error("❌ Destination store not configured. Please set DEST_SHOP in .env first.");
    process.exit(1);
  }

  console.log(`Inspecting destination store: ${config.destination.shop}...`);

  try {
    const token = await resolveAccessToken(config.destination);
    const client = createDestClient(config.destination.shop, token, true /* read-only inspection */);

    const collisions = await detectCollisions(client);
    generateCapabilityMatrixReport(collisions, config.destination.shop, "reports");

    console.log("\n✅ Destination compatibility analysis complete!");
    console.log(`   - Existing products found: ${collisions.existingProductHandles.length}`);
    console.log(`   - Existing pages found:    ${collisions.existingPageHandles.length}`);
    console.log(`   - Existing files found:    ${collisions.existingFilenames.length}`);
    console.log("\nReport generated: reports/04-capability-matrix.md\n");
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("\n❌ Destination compatibility check failed:", msg);
    process.exit(1);
  }
}

void main();
