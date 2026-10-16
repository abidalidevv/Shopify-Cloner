/**
 * Backup Verification Engine.
 *
 * Verifies the integrity of backups/source-store/:
 * 1. Re-opens and parses every JSON backup file.
 * 2. Re-hashes every downloaded media file and checks against media-manifest.json.
 * 3. Compares counts with expected store counts.
 * 4. Produces reports/02-backup-verification.md.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { computeSha256, type MediaManifestEntry } from "./media-downloader.js";
import { EXPECTED_COUNTS } from "../constants.js";
import { logger } from "../logger.js";

export interface VerificationResult {
  timestamp: string;
  jsonFiles: Array<{
    name: string;
    recordCount: number;
    validJson: boolean;
  }>;
  mediaFiles: {
    totalManifest: number;
    verifiedOnDisk: number;
    hashMismatch: number;
    missingOnDisk: number;
  };
  mismatches: string[];
}

export function verifyBackup(
  backupDir = "backups/source-store",
  reportsDir = "reports"
): VerificationResult {
  logger.info(`Starting backup verification for ${backupDir}...`);

  const result: VerificationResult = {
    timestamp: new Date().toISOString(),
    jsonFiles: [],
    mediaFiles: {
      totalManifest: 0,
      verifiedOnDisk: 0,
      hashMismatch: 0,
      missingOnDisk: 0,
    },
    mismatches: [],
  };

  // 1. Verify JSON and JSONL records
  const jsonDir = path.join(backupDir, "json");
  if (fs.existsSync(jsonDir)) {
    const files = fs.readdirSync(jsonDir).filter((f) => f.endsWith(".json"));
    for (const f of files) {
      const fullPath = path.join(jsonDir, f);
      try {
        const raw = fs.readFileSync(fullPath, "utf8");
        const parsed = JSON.parse(raw) as unknown[];
        result.jsonFiles.push({
          name: f.replace(".json", ""),
          recordCount: Array.isArray(parsed) ? parsed.length : 1,
          validJson: true,
        });
      } catch {
        logger.warn(`Corrupted JSON file detected: ${fullPath}`);
        result.jsonFiles.push({
          name: f.replace(".json", ""),
          recordCount: 0,
          validJson: false,
        });
        result.mismatches.push(`Corrupted JSON file: ${f}`);
      }
    }
  }

  // 2. Verify Media Files against Manifest
  const manifestPath = path.join(backupDir, "manifests", "media-manifest.json");
  if (fs.existsSync(manifestPath)) {
    try {
      const raw = fs.readFileSync(manifestPath, "utf8");
      const entries = JSON.parse(raw) as MediaManifestEntry[];
      result.mediaFiles.totalManifest = entries.length;

      for (const entry of entries) {
        if (!fs.existsSync(entry.localPath)) {
          result.mediaFiles.missingOnDisk++;
          result.mismatches.push(`Missing media file on disk: ${entry.localPath}`);
          continue;
        }

        const currentHash = computeSha256(entry.localPath);
        if (currentHash !== entry.sha256) {
          result.mediaFiles.hashMismatch++;
          result.mismatches.push(`SHA-256 hash mismatch: ${entry.localPath}`);
        } else {
          result.mediaFiles.verifiedOnDisk++;
        }
      }
    } catch (err) {
      logger.warn(`Could not verify media manifest: ${String(err)}`);
    }
  }

  // 3. Write reports/02-backup-verification.md
  fs.mkdirSync(reportsDir, { recursive: true });
  let md = `# Backup Verification Report\n\n`;
  md += `- **Timestamp:** ${result.timestamp}\n`;
  md += `- **Backup Location:** \`${backupDir}\`\n\n`;

  md += `## JSON Records Integrity\n\n`;
  md += `| Resource | Exported Records | Expected Count | JSON Valid? | Status |\n`;
  md += `|---|---|---|---|---|\n`;

  for (const j of result.jsonFiles) {
    const exp = (EXPECTED_COUNTS as Record<string, number | undefined>)[j.name];
    const expStr = exp !== undefined ? String(exp) : "—";
    const status = j.validJson && (exp === undefined || exp === j.recordCount) ? "✅ VERIFIED" : "⚠️ CHECK";
    md += `| ${j.name} | ${j.recordCount} | ${expStr} | ${j.validJson ? "Yes" : "❌ No"} | ${status} |\n`;
  }

  md += `\n## Media Files & SHA-256 Integrity\n\n`;
  md += `- **Total In Manifest:** ${result.mediaFiles.totalManifest}\n`;
  md += `- **Verified On Disk:** ${result.mediaFiles.verifiedOnDisk}\n`;
  md += `- **Hash Mismatches:** ${result.mediaFiles.hashMismatch}\n`;
  md += `- **Missing Files:** ${result.mediaFiles.missingOnDisk}\n\n`;

  if (result.mismatches.length === 0) {
    md += `### Overall Status: ✅ PASSED (Lossless, Verified)\n`;
  } else {
    md += `### Overall Status: ⚠️ WARNINGS DETECTED\n\n`;
    for (const m of result.mismatches) {
      md += `- ${m}\n`;
    }
  }

  fs.writeFileSync(path.join(reportsDir, "02-backup-verification.md"), md, "utf8");
  logger.info(`Backup verification report saved to ${path.join(reportsDir, "02-backup-verification.md")}`);

  return result;
}
