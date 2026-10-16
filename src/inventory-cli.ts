/**
 * CLI Runner for Phase 3 Source Inventory.
 *
 * Usage:
 *   npm run inventory
 */

import { loadConfig } from "./config.js";
import { resolveAccessToken } from "./auth.js";
import { createSourceClient } from "./client.js";
import { runInventory, generateReports } from "./inventory.js";

async function main(): Promise<void> {
  console.log("\n=======================================================");
  console.log(" TibbeShifa Migrator — Phase 3: Source Inventory & Audit");
  console.log("=======================================================\n");

  const config = loadConfig();
  console.log(`Auditing source store: ${config.source.shop}...`);

  try {
    const token = await resolveAccessToken(config.source);
    const client = createSourceClient(config.source.shop, token, false);

    const result = await runInventory(client, config.source.shop);
    generateReports(result, "reports");

    console.log("\n✅ Inventory complete! Reports generated in ./reports/:");
    console.log("   - reports/01-source-inventory.md");
    console.log("   - reports/01-source-inventory.json");
    console.log("   - reports/01-inaccessible.md\n");

    console.log("Summary of counts:");
    for (const [res, count] of Object.entries(result.counts)) {
      console.log(`   - ${res.padEnd(14)}: ${count}`);
    }
    console.log(`\nFiles breakdown: ${result.fileBreakdown.images} images, ${result.fileBreakdown.videos} videos, ${result.fileBreakdown.documents} docs, ${result.fileBreakdown.other} other.\n`);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("\n❌ Inventory failed:", msg);
    process.exit(1);
  }
}

void main();
