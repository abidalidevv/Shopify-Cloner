/**
 * CLI Runner for Phase 4: Lossless Backup Engine.
 *
 * Usage:
 *   npm run backup
 */

import { loadConfig } from "./config.js";
import { resolveAccessToken } from "./auth.js";
import { createSourceClient } from "./client.js";
import { runBackupEngine } from "./backup/backup-engine.js";

async function main(): Promise<void> {
  console.log("\n=======================================================");
  console.log(" TibbeShifa Migrator — Phase 4: Lossless Backup Engine");
  console.log("=======================================================\n");

  const config = loadConfig();
  console.log(`Starting backup for source store: ${config.source.shop}...`);

  try {
    const token = await resolveAccessToken(config.source);
    const client = createSourceClient(config.source.shop, token, false);

    const verification = await runBackupEngine({
      client,
      shop: config.source.shop,
      backupDir: "backups/source-store",
      reportsDir: "reports",
    });

    console.log("\n✅ Backup completed and verified!");
    console.log(`   - JSON record categories: ${verification.jsonFiles.length}`);
    console.log(`   - Media files verified:    ${verification.mediaFiles.verifiedOnDisk} / ${verification.mediaFiles.totalManifest}`);
    console.log(`   - Missing on disk:         ${verification.mediaFiles.missingOnDisk}`);
    console.log(`   - Hash mismatches:         ${verification.mediaFiles.hashMismatch}`);
    console.log("\nReports generated in ./reports/:");
    console.log("   - reports/02-backup-verification.md\n");
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("\n❌ Backup failed:", msg);
    process.exit(1);
  }
}

void main();
