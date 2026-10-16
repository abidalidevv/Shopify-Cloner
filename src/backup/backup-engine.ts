/**
 * Backup Engine Orchestrator (Phase 4).
 *
 * Lossless, resumable backup of source store:
 * 1. Exports all data records to json/ and jsonl/
 * 2. Extracts all media URLs from products, collections, files
 * 3. Downloads all media files to media/ with SHA-256 verification
 * 4. Saves media-manifest.json
 * 5. Runs verifyBackup and writes reports/02-backup-verification.md
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { type GraphQLClient } from "../client.js";
import { type Connection } from "../pagination.js";
import { EXPORT_QUERIES, exportResource, exportMetaobjects } from "./data-exporter.js";
import {
  downloadMediaFile,
  type MediaItem,
  type MediaManifestEntry,
} from "./media-downloader.js";
import { verifyBackup, type VerificationResult } from "./verify-backup.js";
import {
  loadCheckpoint,
  saveCheckpoint,
  createCheckpoint,
  markComplete,
  isStopRequested,
} from "../checkpoint.js";
import { logger } from "../logger.js";

export interface BackupEngineOptions {
  client: GraphQLClient;
  shop: string;
  backupDir?: string;
  reportsDir?: string;
}

export function ensureBackupDirectories(baseDir: string): void {
  const dirs = [
    "metadata",
    "json",
    "jsonl",
    "media/products",
    "media/collections",
    "media/files",
    "media/theme-assets",
    "media/other",
    "theme",
    "mappings",
    "manifests",
    "logs",
    "reports",
  ];
  for (const d of dirs) {
    fs.mkdirSync(path.join(baseDir, d), { recursive: true });
  }
}

export async function runBackupEngine(options: BackupEngineOptions): Promise<VerificationResult> {
  const baseDir = options.backupDir ?? "backups/source-store";
  const reportsDir = options.reportsDir ?? "reports";

  ensureBackupDirectories(baseDir);

  const checkpoint =
    loadCheckpoint<{ completedSteps: string[] }>("phase-4-backup") ??
    createCheckpoint("phase-4-backup", { completedSteps: [] });

  logger.info(`Starting Phase 4 Backup Engine for ${options.shop}...`);

  // Step 1: Export Data Records
  const resourcesToExport = [
    { name: "metaobjectDefinitions", query: EXPORT_QUERIES.metaobjectDefinitions, getter: (d: unknown): Connection<unknown> => (d as Record<string, Connection<unknown>>)["metaobjectDefinitions"]! },
    { name: "metaobjects", query: EXPORT_QUERIES.metaobjects, getter: (d: unknown): Connection<unknown> => (d as Record<string, Connection<unknown>>)["metaobjects"]! },
    { name: "products", query: EXPORT_QUERIES.products, getter: (d: unknown): Connection<unknown> => (d as Record<string, Connection<unknown>>)["products"]! },
    { name: "collections", query: EXPORT_QUERIES.collections, getter: (d: unknown): Connection<unknown> => (d as Record<string, Connection<unknown>>)["collections"]! },
    { name: "pages", query: EXPORT_QUERIES.pages, getter: (d: unknown): Connection<unknown> => (d as Record<string, Connection<unknown>>)["pages"]! },
    { name: "menus", query: EXPORT_QUERIES.menus, getter: (d: unknown): Connection<unknown> => (d as Record<string, Connection<unknown>>)["menus"]! },
    { name: "redirects", query: EXPORT_QUERIES.redirects, getter: (d: unknown): Connection<unknown> => (d as Record<string, Connection<unknown>>)["urlRedirects"]! },
    { name: "files", query: EXPORT_QUERIES.files, getter: (d: unknown): Connection<unknown> => (d as Record<string, Connection<unknown>>)["files"]! },
    { name: "customers", query: EXPORT_QUERIES.customers, getter: (d: unknown): Connection<unknown> => (d as Record<string, Connection<unknown>>)["customers"]! },
    { name: "orders", query: EXPORT_QUERIES.orders, getter: (d: unknown): Connection<unknown> => (d as Record<string, Connection<unknown>>)["orders"]! },
    { name: "discounts", query: EXPORT_QUERIES.discounts, getter: (d: unknown): Connection<unknown> => (d as Record<string, Connection<unknown>>)["discountNodes"]! },
  ];

  for (const res of resourcesToExport) {
    if (checkpoint.done.includes(`export:${res.name}`)) continue;
    if (isStopRequested()) {
      logger.warn("Stop requested during backup export. Checkpoint saved.");
      saveCheckpoint(checkpoint);
      break;
    }

    if (res.name === "metaobjects") {
      await exportMetaobjects(options.client, baseDir);
    } else {
      await exportResource(
        options.client,
        res.name,
        res.query,
        res.getter,
        baseDir,
        res.name === "products" ? 10 : 50
      );
    }
    checkpoint.done.push(`export:${res.name}`);
    saveCheckpoint(checkpoint);
  }

  // Step 2: Build Media Download Queue
  const mediaQueue: MediaItem[] = [];

  // Files
  const filesPath = path.join(baseDir, "json", "files.json");
  if (fs.existsSync(filesPath)) {
    interface FileJsonItem {
      id: string;
      url?: string;
      mimeType?: string;
      alt?: string;
      image?: { url?: string };
      originalSource?: { url?: string };
    }
    const files = JSON.parse(fs.readFileSync(filesPath, "utf8")) as FileJsonItem[];
    for (const f of files) {
      const url = f.url || f.image?.url || f.originalSource?.url;
      if (url) {
        const ext = path.extname(url.split("?")[0] || "") || ".bin";
        mediaQueue.push({
          id: f.id,
          filename: `${f.id.split("/").pop() ?? "file"}${ext}`,
          url,
          category: "files",
          mimeType: f.mimeType,
          altText: f.alt,
        });
      }
    }
  }

  // Product Media
  const productsPath = path.join(baseDir, "json", "products.json");
  if (fs.existsSync(productsPath)) {
    interface ProductJsonItem {
      handle: string;
      media?: {
        edges?: Array<{
          node: {
            id: string;
            alt?: string;
            image?: { url?: string };
          };
        }>;
      };
    }
    const products = JSON.parse(fs.readFileSync(productsPath, "utf8")) as ProductJsonItem[];
    for (const p of products) {
      const mediaList = p.media?.edges?.map((e) => e.node) ?? [];
      for (const m of mediaList) {
        const url = m.image?.url;
        if (url) {
          const ext = path.extname(url.split("?")[0] || "") || ".jpg";
          mediaQueue.push({
            id: m.id,
            filename: `${p.handle}_${m.id.split("/").pop() ?? "media"}${ext}`,
            url,
            category: "products",
            altText: m.alt,
          });
        }
      }
    }
  }

  // Step 3: Download Media with Checkpointing
  const manifestPath = path.join(baseDir, "manifests", "media-manifest.json");
  let manifestEntries: MediaManifestEntry[] = [];
  if (fs.existsSync(manifestPath)) {
    try {
      manifestEntries = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    } catch {
      manifestEntries = [];
    }
  }
  const manifestMap = new Map<string, MediaManifestEntry>(manifestEntries.map((e) => [e.id, e]));

  logger.info(`Starting download of ${mediaQueue.length} media items...`);
  for (const item of mediaQueue) {
    if (checkpoint.done.includes(`media:${item.id}`)) continue;
    if (isStopRequested()) {
      logger.warn("Stop requested during media download. Saving checkpoint.");
      saveCheckpoint(checkpoint);
      break;
    }

    const entry = await downloadMediaFile(item, path.join(baseDir, "media"), manifestMap);
    manifestMap.set(item.id, entry);
    checkpoint.done.push(`media:${item.id}`);

    // Update manifest periodically
    fs.writeFileSync(manifestPath, JSON.stringify(Array.from(manifestMap.values()), null, 2), "utf8");
    saveCheckpoint(checkpoint);
  }

  // Step 4: Verification
  const verification = verifyBackup(baseDir, reportsDir);
  markComplete(checkpoint);

  return verification;
}
