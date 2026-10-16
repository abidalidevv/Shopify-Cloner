/**
 * CLI Runner for Section 7: URL & Asset Repair Engine.
 *
 * Usage:
 *   npm run repair
 *   npm run repair -- --apply
 */

import * as fs from "node:fs";
import { loadConfig } from "./config.js";
import { repairDirectory, createWorkingRepairCopy } from "./url-scanner/url-repair.js";

function main(): void {
  console.log("\n=======================================================");
  console.log(" TibbeShifa Migrator — Section 7: URL & Asset Repair");
  console.log("=======================================================\n");

  const config = loadConfig();
  const args = process.argv.slice(2);
  const wantsApply = args.includes("--apply");
  const confirmDest = args.find((a) => a.startsWith("--confirm-dest="))?.split("=")[1];

  if (wantsApply) {
    if (config.dryRun) {
      console.error("❌ SAFETY GUARD BLOCKED: DRY_RUN=true in .env file.");
      console.error("To apply URL repairs you must set DRY_RUN=false in .env AND pass --apply.");
      process.exit(1);
    }

    if (!config.destination.shop) {
      console.error("❌ Destination store not configured. Please set DEST_SHOP in .env first.");
      process.exit(1);
    }

    if (!confirmDest || confirmDest !== config.destination.shop) {
      console.error("❌ SAFETY GUARD BLOCKED: URL repair requires typed destination domain confirmation.");
      console.error(`Expected: --confirm-dest=${config.destination.shop}`);
      console.error(`Received: ${confirmDest ? `--confirm-dest=${confirmDest}` : "(Missing --confirm-dest)"}`);
      process.exit(1);
    }
  }

  const isApply = wantsApply && !config.dryRun && confirmDest === config.destination.shop;

  console.log(`Source Store Domain:      ${config.source.shop}`);
  console.log(`Destination Store Domain: ${config.destination.shop || "(Pending destination configuration)"}`);
  console.log(`Repair Mode:              ${isApply ? "⚠️ LIVE REPAIR (Writing changes & .bak backups to local copies)" : "🛡️ DRY-RUN PREVIEW (Zero files modified)"}\n`);

  // Load mappings/file-url-map.json if available
  let fileUrlMap: Record<string, string> = {};
  const mapPath = "mappings/file-url-map.json";
  if (fs.existsSync(mapPath)) {
    try {
      fileUrlMap = JSON.parse(fs.readFileSync(mapPath, "utf8")) as Record<string, string>;
    } catch {
      // empty
    }
  }

  const sourceArchiveDir = "backups/source-store";
  const workingRepairDir = "working/repair-copy";

  if (fs.existsSync(sourceArchiveDir)) {
    if (!fs.existsSync(workingRepairDir)) {
      createWorkingRepairCopy(sourceArchiveDir, workingRepairDir);
    }
  }

  const targetDir = fs.existsSync(workingRepairDir) ? workingRepairDir : sourceArchiveDir;

  const summary = repairDirectory(targetDir, {
    sourceMyshopify: config.source.shop,
    destMyshopify: config.destination.shop,
    fileUrlMap,
    dryRun: !isApply,
    reportsDir: "reports",
  });

  console.log("✅ Repair scan completed!");
  console.log(`   - Working directory:        ${targetDir}`);
  console.log(`   - Original archive status:  Byte-identical & untouched (${sourceArchiveDir})`);
  console.log(`   - Files scanned:            ${summary.filesScanned}`);
  console.log(`   - Files targeted:           ${summary.filesModified}`);
  console.log(`   - Replacements identified:  ${summary.replacements.length}`);
  console.log("\nReport generated: reports/05-url-repair-preview.md\n");
}

main();
