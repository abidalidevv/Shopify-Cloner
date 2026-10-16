/**
 * Section 7: URL & Asset Repair Engine.
 *
 * STATUS: DRAFT / UNVERIFIED against live store.
 * Mock-tested only in Vitest fixtures. Zero operations verified against a live store.
 *
 * Implements context-aware replacement:
 * 1. Works exclusively on local backup copies or destination data (never touches source store).
 * 2. Rewrites old CDN URLs and old myshopify domain in JSON templates, theme assets, and HTML content.
 * 3. Preserves shopify://, WhatsApp, and third-party URLs untouched.
 * 4. Generates a preview diff report (reports/05-url-repair-preview.md).
 * 5. Saves reversible patches (.bak / patch history) before applying.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { logger } from "../logger.js";

export interface RepairOptions {
  sourceMyshopify: string;
  destMyshopify: string;
  fileUrlMap: Record<string, string>; // oldUrl -> newUrl
  dryRun: boolean;
  reportsDir?: string | undefined;
}

export interface ReplacementRecord {
  file: string;
  original: string;
  replacement: string;
}

export interface RepairSummary {
  timestamp: string;
  filesScanned: number;
  filesModified: number;
  replacements: ReplacementRecord[];
}

/** Recursively replaces string values inside parsed JSON objects */
export function replaceInJsonObject(
  obj: unknown,
  replacer: (val: string) => string
): { modified: boolean; result: unknown } {
  let anyModified = false;

  function traverse(node: unknown): unknown {
    if (typeof node === "string") {
      const rep = replacer(node);
      if (rep !== node) {
        anyModified = true;
        return rep;
      }
      return node;
    }
    if (Array.isArray(node)) {
      return node.map((item) => traverse(item));
    }
    if (node !== null && typeof node === "object") {
      const updated: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(node)) {
        updated[k] = traverse(v);
      }
      return updated;
    }
    return node;
  }

  const result = traverse(obj);
  return { modified: anyModified, result };
}

/**
 * Repairs references across a directory (e.g. pulled theme, pages JSON, settings).
 */
export function repairDirectory(dirPath: string, options: RepairOptions): RepairSummary {
  const summary: RepairSummary = {
    timestamp: new Date().toISOString(),
    filesScanned: 0,
    filesModified: 0,
    replacements: [],
  };

  if (!fs.existsSync(dirPath)) {
    return summary;
  }

  function getReplacer(relPath: string): (val: string) => string {
    return (val: string): string => {
      let current = val;

      // 1. Remap old CDN URLs
      for (const [oldUrl, newUrl] of Object.entries(options.fileUrlMap)) {
        if (current.includes(oldUrl)) {
          summary.replacements.push({
            file: relPath,
            original: oldUrl,
            replacement: newUrl,
          });
          current = current.split(oldUrl).join(newUrl);
        }
      }

      // 2. Remap old myshopify domain
      if (options.sourceMyshopify && options.destMyshopify && current.includes(options.sourceMyshopify)) {
        summary.replacements.push({
          file: relPath,
          original: options.sourceMyshopify,
          replacement: options.destMyshopify,
        });
        current = current.split(options.sourceMyshopify).join(options.destMyshopify);
      }

      return current;
    };
  }

  function walk(currentDir: string): void {
    const entries = fs.readdirSync(currentDir, { withFileTypes: true });
    for (const ent of entries) {
      const fullPath = path.join(currentDir, ent.name);
      if (ent.isDirectory()) {
        walk(fullPath);
      } else if (ent.isFile()) {
        const ext = path.extname(ent.name).toLowerCase();
        if ([".json", ".liquid", ".html", ".css", ".js"].includes(ext)) {
          summary.filesScanned++;
          const content = fs.readFileSync(fullPath, "utf8");
          const rel = path.relative(dirPath, fullPath);
          const replacer = getReplacer(rel);

          if (ext === ".json") {
            try {
              const parsed = JSON.parse(content) as unknown;
              const { modified, result } = replaceInJsonObject(parsed, replacer);
              if (modified) {
                summary.filesModified++;
                if (!options.dryRun) {
                  // Save backup patch
                  fs.writeFileSync(`${fullPath}.bak`, content, "utf8");
                  fs.writeFileSync(fullPath, JSON.stringify(result, null, 2), "utf8");
                }
              }
            } catch {
              // Not valid JSON, skip
            }
          } else {
            // Text files (Liquid, HTML, CSS, JS)
            const updated = replacer(content);
            if (updated !== content) {
              summary.filesModified++;
              if (!options.dryRun) {
                fs.writeFileSync(`${fullPath}.bak`, content, "utf8");
                fs.writeFileSync(fullPath, updated, "utf8");
              }
            }
          }
        }
      }
    }
  }

  walk(dirPath);

  // Generate Preview Report
  const reportsDir = options.reportsDir ?? "reports";
  fs.mkdirSync(reportsDir, { recursive: true });

  let md = `# URL and Asset Repair Report (Section 7)\n\n`;
  md += `- **Timestamp:** ${summary.timestamp}\n`;
  md += `- **Mode:** ${options.dryRun ? "🛡️ DRY-RUN PREVIEW (Zero files modified)" : "⚠️ LIVE REPAIR (Patches applied, .bak saved)"}\n`;
  md += `- **Files Scanned:** ${summary.filesScanned}\n`;
  md += `- **Files Flagged for Modification:** ${summary.filesModified}\n`;
  md += `- **Total Replacements Planned:** ${summary.replacements.length}\n\n`;

  md += `## Replacement Preview Diff\n\n`;
  if (summary.replacements.length === 0) {
    md += `✅ No old CDN or old myshopify domain references found in targeted directory.\n`;
  } else {
    md += `| File | Target (Old URL/Domain) | Replacement (New Destination URL) |\n`;
    md += `|---|---|---|\n`;
    for (const r of summary.replacements.slice(0, 100)) {
      md += `| \`${r.file}\` | \`${r.original}\` | \`${r.replacement}\` |\n`;
    }
  }

  fs.writeFileSync(path.join(reportsDir, "05-url-repair-preview.md"), md, "utf8");
  logger.info(`URL repair report generated at ${path.join(reportsDir, "05-url-repair-preview.md")}`);

  return summary;
}

/**
 * Copies the source backup archive to a separate working directory (e.g. working/repair-copy/).
 * Guarantees that backups/source-store remains 100% byte-identical and untouched.
 */
export function createWorkingRepairCopy(
  sourceBackupDir = "backups/source-store",
  workingCopyDir = "working/repair-copy"
): void {
  if (!fs.existsSync(sourceBackupDir)) {
    throw new Error(`Source backup directory '${sourceBackupDir}' does not exist.`);
  }
  fs.mkdirSync(workingCopyDir, { recursive: true });
  fs.cpSync(sourceBackupDir, workingCopyDir, { recursive: true });
  logger.info(`Created working repair copy at '${workingCopyDir}'. Original backup '${sourceBackupDir}' is untouched.`);
}
