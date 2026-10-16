/**
 * Media Downloader with SHA-256 Checksums and Resume Support.
 *
 * Downloads actual media files (not just URLs) to:
 * backups/source-store/media/{category}/
 *
 * Enforces:
 * - SHA-256 checksum computation for every file
 * - Resumable downloads (skips already verified files)
 * - Retries on transient network errors
 * - Writes manifests/media-manifest.json
 */

import * as fs from "node:fs";
import * as path from "node:path";
import * as crypto from "node:crypto";
import { withRetry } from "../retry.js";
import { logger } from "../logger.js";

export interface MediaItem {
  id: string;
  filename: string;
  url: string;
  category: "products" | "collections" | "files" | "theme-assets" | "other";
  mimeType?: string | undefined;
  altText?: string | undefined;
  fileSize?: number | undefined;
}

export interface MediaManifestEntry {
  id: string;
  filename: string;
  category: string;
  url: string;
  localPath: string;
  mimeType?: string | undefined;
  altText?: string | undefined;
  sizeBytes: number;
  sha256: string;
  status: "verified" | "failed" | "skipped";
  downloadedAt: string;
}

export function computeSha256(filePath: string): string {
  const buffer = fs.readFileSync(filePath);
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

export function sanitizeFilename(name: string): string {
  return name.replace(/[/\\?%*:|"<>]/g, "_").trim();
}

/**
 * Downloads a single media file to the destination path.
 * Retries on transient network failures.
 */
export async function downloadMediaFile(
  item: MediaItem,
  destDir: string,
  existingManifest?: Map<string, MediaManifestEntry>
): Promise<MediaManifestEntry> {
  const categoryDir = path.join(destDir, item.category);
  fs.mkdirSync(categoryDir, { recursive: true });

  const safeFilename = sanitizeFilename(item.filename);
  const localPath = path.join(categoryDir, safeFilename);

  // Resume check: If file exists and is in manifest, verify hash
  if (fs.existsSync(localPath) && existingManifest?.has(item.id)) {
    const prev = existingManifest.get(item.id)!;
    const currentHash = computeSha256(localPath);
    if (currentHash === prev.sha256) {
      return {
        ...prev,
        status: "verified",
      };
    }
  }

  // Download with retry
  try {
    await withRetry(
      `download:${safeFilename}`,
      async () => {
        const response = await fetch(item.url);
        if (!response.ok) {
          const err = new Error(`HTTP ${response.status} downloading ${item.url}`) as Error & { status: number };
          err.status = response.status;
          throw err;
        }
        const arrayBuffer = await response.arrayBuffer();
        fs.writeFileSync(localPath, Buffer.from(arrayBuffer));
      },
      { maxAttempts: 3, baseDelayMs: 500 }
    );

    const stats = fs.statSync(localPath);
    const sha256 = computeSha256(localPath);

    return {
      id: item.id,
      filename: safeFilename,
      category: item.category,
      url: item.url,
      localPath,
      mimeType: item.mimeType,
      altText: item.altText,
      sizeBytes: stats.size,
      sha256,
      status: "verified",
      downloadedAt: new Date().toISOString(),
    };
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    logger.warn(`Failed downloading media ${item.filename}: ${errorMsg}`);
    return {
      id: item.id,
      filename: safeFilename,
      category: item.category,
      url: item.url,
      localPath,
      mimeType: item.mimeType,
      altText: item.altText,
      sizeBytes: 0,
      sha256: "",
      status: "failed",
      downloadedAt: new Date().toISOString(),
    };
  }
}
