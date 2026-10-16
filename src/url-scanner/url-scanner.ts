/**
 * Phase 5: URL and Reference Scanner.
 *
 * Scans backup data and theme files for old store references:
 * 1. Custom domain links (e.g. tibbeshifa.com)
 * 2. Old myshopify domains (e.g. *.myshopify.com)
 * 3. Shopify CDN media URLs (e.g. cdn.shopify.com/s/files/...)
 * 4. Shopify protocol links (shopify://shop_images/..., shopify://products/...)
 * 5. Third-party integrations (WhatsApp, social media)
 *
 * Produces reports/03-url-scan.md with exact locations and replacement plans.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { logger } from "../logger.js";

export type ReferenceType =
  | "CUSTOM_DOMAIN"
  | "OLD_MYSHOPIFY"
  | "OLD_CDN"
  | "SHOPIFY_PROTOCOL"
  | "THIRD_PARTY"
  | "INTERNAL_PATH";

export interface ReferenceMatch {
  location: string;
  fieldPath?: string | undefined;
  type: ReferenceType;
  rawUrl: string;
  action: "keep_on_domain_transfer" | "remap_to_dest_file" | "remap_to_dest_shop" | "preserve_handle_or_filename" | "keep_untouched";
  notes?: string | undefined;
}

export interface ScanSummary {
  timestamp: string;
  sourceDomain: string;
  sourceMyshopify: string;
  totalReferences: number;
  byType: Record<ReferenceType, number>;
  matches: ReferenceMatch[];
}

export function classifyReference(
  rawUrl: string,
  sourceCustomDomain: string,
  sourceMyshopifyDomain: string
): { type: ReferenceType; action: ReferenceMatch["action"]; notes?: string } {
  if (rawUrl.startsWith("shopify://")) {
    return {
      type: "SHOPIFY_PROTOCOL",
      action: "preserve_handle_or_filename",
      notes: "Resolves automatically in destination by matching exact filename or handle.",
    };
  }

  if (rawUrl.includes("cdn.shopify.com/s/files/")) {
    return {
      type: "OLD_CDN",
      action: "remap_to_dest_file",
      notes: "Must be mapped to new destination file CDN URL via file-url-map.json.",
    };
  }

  if (sourceMyshopifyDomain && rawUrl.includes(sourceMyshopifyDomain)) {
    return {
      type: "OLD_MYSHOPIFY",
      action: "remap_to_dest_shop",
      notes: "Must be replaced with destination store domain or relative handle.",
    };
  }

  if (sourceCustomDomain && rawUrl.includes(sourceCustomDomain)) {
    return {
      type: "CUSTOM_DOMAIN",
      action: "keep_on_domain_transfer",
      notes: "Will continue working after custom domain is transferred to new store.",
    };
  }

  if (
    rawUrl.includes("wa.me") ||
    rawUrl.includes("whatsapp.com") ||
    rawUrl.includes("facebook.com") ||
    rawUrl.includes("instagram.com") ||
    rawUrl.includes("tiktok.com")
  ) {
    return {
      type: "THIRD_PARTY",
      action: "keep_untouched",
      notes: "External third-party integration URL; must not be altered.",
    };
  }

  return {
    type: "INTERNAL_PATH",
    action: "keep_on_domain_transfer",
  };
}

const URL_FINDER_REGEX = /(?:https?:\/\/[^\s"'<>]+|shopify:\/\/[^\s"'<>]+)/g;

export function scanTextForReferences(
  text: string,
  location: string,
  sourceCustomDomain: string,
  sourceMyshopifyDomain: string,
  fieldPath?: string
): ReferenceMatch[] {
  const matches: ReferenceMatch[] = [];
  const found = text.match(URL_FINDER_REGEX) ?? [];

  for (const rawUrl of found) {
    const classification = classifyReference(rawUrl, sourceCustomDomain, sourceMyshopifyDomain);
    matches.push({
      location,
      fieldPath,
      type: classification.type,
      rawUrl,
      action: classification.action,
      notes: classification.notes,
    });
  }

  return matches;
}

export function scanBackupDirectory(
  backupDir: string,
  sourceCustomDomain: string,
  sourceMyshopifyDomain: string
): ScanSummary {
  logger.info(`Scanning backup in ${backupDir} for old-store URLs and references...`);

  const summary: ScanSummary = {
    timestamp: new Date().toISOString(),
    sourceDomain: sourceCustomDomain,
    sourceMyshopify: sourceMyshopifyDomain,
    totalReferences: 0,
    byType: {
      CUSTOM_DOMAIN: 0,
      OLD_MYSHOPIFY: 0,
      OLD_CDN: 0,
      SHOPIFY_PROTOCOL: 0,
      THIRD_PARTY: 0,
      INTERNAL_PATH: 0,
    },
    matches: [],
  };

  function addMatches(list: ReferenceMatch[]): void {
    for (const m of list) {
      summary.matches.push(m);
      summary.totalReferences++;
      summary.byType[m.type]++;
    }
  }

  // 1. Scan JSON backups
  const jsonDir = path.join(backupDir, "json");
  if (fs.existsSync(jsonDir)) {
    const files = fs.readdirSync(jsonDir).filter((f) => f.endsWith(".json"));
    for (const f of files) {
      const fullPath = path.join(jsonDir, f);
      const content = fs.readFileSync(fullPath, "utf8");
      addMatches(scanTextForReferences(content, `json/${f}`, sourceCustomDomain, sourceMyshopifyDomain));
    }
  }

  // 2. Scan Theme files if pulled
  const themeDir = path.join(backupDir, "theme");
  if (fs.existsSync(themeDir)) {
    function walkTheme(dir: string): void {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          walkTheme(full);
        } else if (
          entry.name.endsWith(".liquid") ||
          entry.name.endsWith(".json") ||
          entry.name.endsWith(".js") ||
          entry.name.endsWith(".css")
        ) {
          const content = fs.readFileSync(full, "utf8");
          const rel = path.relative(backupDir, full);
          addMatches(scanTextForReferences(content, rel, sourceCustomDomain, sourceMyshopifyDomain));
        }
      }
    }
    walkTheme(themeDir);
  }

  return summary;
}

export function generateUrlScanReport(summary: ScanSummary, reportsDir = "reports"): void {
  fs.mkdirSync(reportsDir, { recursive: true });

  let md = `# URL and Reference Analysis Report\n\n`;
  md += `- **Scan Timestamp:** ${summary.timestamp}\n`;
  md += `- **Source Custom Domain:** \`${summary.sourceDomain}\`\n`;
  md += `- **Source myshopify Domain:** \`${summary.sourceMyshopify}\`\n`;
  md += `- **Total References Detected:** ${summary.totalReferences}\n\n`;

  md += `## Classification Breakdown\n\n`;
  md += `| Category | Count | Plan / Remediation Strategy |\n`;
  md += `|---|---|---|\n`;
  md += `| **OLD_CDN** | ${summary.byType.OLD_CDN} | ⚠️ Must be remapped to destination files via \`file-url-map.json\`. |\n`;
  md += `| **OLD_MYSHOPIFY** | ${summary.byType.OLD_MYSHOPIFY} | ⚠️ Must be rewritten to relative paths or destination handle. |\n`;
  md += `| **SHOPIFY_PROTOCOL** | ${summary.byType.SHOPIFY_PROTOCOL} | ✅ Preserved by keeping identical filenames and handles. |\n`;
  md += `| **CUSTOM_DOMAIN** | ${summary.byType.CUSTOM_DOMAIN} | ℹ️ Will continue working once domain is moved at acceptance. |\n`;
  md += `| **THIRD_PARTY** | ${summary.byType.THIRD_PARTY} | ✅ WhatsApp / social links preserved untouched. |\n\n`;

  md += `## Detailed References Log (First 100 shown)\n\n`;
  md += `| Location | Type | Raw Reference | Planned Action |\n`;
  md += `|---|---|---|---|\n`;

  const topMatches = summary.matches.slice(0, 100);
  for (const m of topMatches) {
    const cleanUrl = m.rawUrl.length > 60 ? `${m.rawUrl.slice(0, 57)}...` : m.rawUrl;
    md += `| \`${m.location}\` | \`${m.type}\` | \`${cleanUrl}\` | ${m.action} |\n`;
  }

  if (summary.matches.length > 100) {
    md += `\n*... and ${summary.matches.length - 100} more references.*\n`;
  }

  const outPath = path.join(reportsDir, "03-url-scan.md");
  fs.writeFileSync(outPath, md, "utf8");
  logger.info(`URL scan report generated at ${outPath}`);
}
