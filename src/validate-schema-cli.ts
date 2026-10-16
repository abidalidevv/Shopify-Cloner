/**
 * CLI Runner for Schema Validation.
 *
 * Checks all Phase 6 mutations against destination store Admin API (2026-10).
 *
 * Usage:
 *   npm run validate-schema
 */

import { loadConfig } from "./config.js";
import { resolveAccessToken } from "./auth.js";
import { createDestClient } from "./client.js";
import { validateDestinationSchema } from "./destination/schema-validator.js";

async function main(): Promise<void> {
  console.log("\n=======================================================");
  console.log(" TibbeShifa Migrator — Schema Validation (2026-10)");
  console.log("=======================================================\n");

  const config = loadConfig();

  if (!config.destination.shop) {
    console.error("❌ Destination store not configured. Please set DEST_SHOP in .env first.");
    process.exit(1);
  }

  console.log(`Connecting read-only to destination store: ${config.destination.shop}...`);

  try {
    const token = await resolveAccessToken(config.destination);
    const client = createDestClient(config.destination.shop, token, true /* dry-run / read-only */);

    const summary = await validateDestinationSchema(client, config.destination.shop, "reports");

    console.log("\nValidation Summary:");
    for (const r of summary.results) {
      console.log(`   - ${r.mutation.padEnd(22)}: ${r.existsInSchema && r.argValid ? "✅ VALID" : "❌ INVALID"}`);
    }

    if (summary.allValid) {
      console.log("\n✅ All GraphQL mutations exist and match 2026-10 schema.");
      console.log("Checkpoint saved to checkpoints/schema-validated.json.");
      console.log("Report saved to reports/06-schema-validation.md\n");
    } else {
      console.error("\n❌ Schema validation failed. Review reports/06-schema-validation.md\n");
      process.exit(1);
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("\n❌ Schema validation failed:", msg);
    process.exit(1);
  }
}

void main();
