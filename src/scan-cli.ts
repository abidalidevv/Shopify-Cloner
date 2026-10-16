/**
 * CLI Runner for Phase 5: URL & Reference Scanner.
 *
 * Usage:
 *   npm run scan
 */

import { loadConfig } from "./config.js";
import { scanBackupDirectory, generateUrlScanReport } from "./url-scanner/url-scanner.js";

function main(): void {
  console.log("\n=======================================================");
  console.log(" TibbeShifa Migrator — Phase 5: URL & Reference Scanner");
  console.log("=======================================================\n");

  const config = loadConfig();
  const sourceMyshopify = config.source.shop;
  const customDomain = "tibbeshifa.com";

  console.log(`Scanning backup directory for references pointing to:`);
  console.log(`   - Custom domain:     ${customDomain}`);
  console.log(`   - myshopify domain:  ${sourceMyshopify}\n`);

  try {
    const summary = scanBackupDirectory("backups/source-store", customDomain, sourceMyshopify);
    generateUrlScanReport(summary, "reports");

    console.log("\n✅ URL scan complete! Summary:");
    console.log(`   - Total references detected: ${summary.totalReferences}`);
    console.log(`   - OLD_CDN URLs:              ${summary.byType.OLD_CDN}`);
    console.log(`   - OLD_MYSHOPIFY URLs:        ${summary.byType.OLD_MYSHOPIFY}`);
    console.log(`   - SHOPIFY_PROTOCOL links:    ${summary.byType.SHOPIFY_PROTOCOL}`);
    console.log(`   - CUSTOM_DOMAIN links:       ${summary.byType.CUSTOM_DOMAIN}`);
    console.log(`   - THIRD_PARTY (WhatsApp):    ${summary.byType.THIRD_PARTY}`);
    console.log("\nReport generated: reports/03-url-scan.md\n");
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("\n❌ URL scan failed:", msg);
    process.exit(1);
  }
}

main();
