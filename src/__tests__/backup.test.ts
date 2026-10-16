/**
 * Tests for Phase 4 Backup Engine.
 *
 * Verifies:
 * 1. computeSha256 produces exact cryptographic hashes.
 * 2. downloadMediaFile downloads and generates manifest entry with SHA-256.
 * 3. downloadMediaFile skips redownload if hash matches existing manifest.
 * 4. verifyBackup validates JSON integrity and SHA-256 checksums, and outputs report.
 * 5. ensureBackupDirectories creates full standardized folder hierarchy.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import {
  computeSha256,
  downloadMediaFile,
  type MediaItem,
  type MediaManifestEntry,
} from "../backup/media-downloader.js";
import { verifyBackup } from "../backup/verify-backup.js";
import { ensureBackupDirectories } from "../backup/backup-engine.js";

const TEST_BACKUP_DIR = "test-backup-root";
const TEST_REPORTS_DIR = "test-backup-reports";

describe("media downloader & SHA-256 hashing", () => {
  beforeEach(() => {
    if (fs.existsSync(TEST_BACKUP_DIR)) {
      fs.rmSync(TEST_BACKUP_DIR, { recursive: true, force: true });
    }
  });

  afterEach(() => {
    if (fs.existsSync(TEST_BACKUP_DIR)) {
      fs.rmSync(TEST_BACKUP_DIR, { recursive: true, force: true });
    }
  });

  it("computes exact sha256 of file content", () => {
    fs.mkdirSync(TEST_BACKUP_DIR, { recursive: true });
    const filePath = path.join(TEST_BACKUP_DIR, "test.txt");
    const content = "hello tibbeshifa";
    fs.writeFileSync(filePath, content, "utf8");

    const expectedHash = "fd1d95fad54de4f8e16d66dbdfb2c36afb0c4ea4a5e253d0eba90e5f1a6c9ef1";
    const hash = computeSha256(filePath);
    expect(hash).toBe(expectedHash);
  });

  it("downloads media file and computes SHA-256 manifest entry", async () => {
    const mockData = Buffer.from("image binary data");
    const mockSlice = mockData.buffer.slice(mockData.byteOffset, mockData.byteOffset + mockData.byteLength);
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      arrayBuffer: () => Promise.resolve(mockSlice),
    });
    global.fetch = mockFetch as unknown as typeof fetch;

    const item: MediaItem = {
      id: "gid://shopify/MediaImage/100",
      filename: "product_hero.webp",
      url: "https://cdn.shopify.com/files/product_hero.webp",
      category: "products",
      mimeType: "image/webp",
    };

    const entry = await downloadMediaFile(item, TEST_BACKUP_DIR);
    expect(entry.status).toBe("verified");
    expect(entry.filename).toBe("product_hero.webp");
    expect(entry.sizeBytes).toBe(mockData.length);
    expect(entry.sha256).toBe(computeSha256(entry.localPath));
    expect(fs.existsSync(entry.localPath)).toBe(true);
  });

  it("resumes and skips downloading if existing file has matching SHA-256", async () => {
    const existingFileDir = path.join(TEST_BACKUP_DIR, "products");
    fs.mkdirSync(existingFileDir, { recursive: true });
    const localPath = path.join(existingFileDir, "product_hero.webp");
    fs.writeFileSync(localPath, "already downloaded content");

    const hash = computeSha256(localPath);
    const existingManifest = new Map<string, MediaManifestEntry>([
      [
        "gid://shopify/MediaImage/100",
        {
          id: "gid://shopify/MediaImage/100",
          filename: "product_hero.webp",
          category: "products",
          url: "https://cdn.shopify.com/files/product_hero.webp",
          localPath,
          sizeBytes: 26,
          sha256: hash,
          status: "verified",
          downloadedAt: new Date().toISOString(),
        },
      ],
    ]);

    const mockFetch = vi.fn();
    global.fetch = mockFetch;

    const item: MediaItem = {
      id: "gid://shopify/MediaImage/100",
      filename: "product_hero.webp",
      url: "https://cdn.shopify.com/files/product_hero.webp",
      category: "products",
    };

    const entry = await downloadMediaFile(item, TEST_BACKUP_DIR, existingManifest);
    expect(entry.status).toBe("verified");
    // fetch should NOT be called because file already exists and hash matches!
    expect(mockFetch).not.toHaveBeenCalled();
  });
});

describe("verifyBackup", () => {
  beforeEach(() => {
    if (fs.existsSync(TEST_BACKUP_DIR)) {
      fs.rmSync(TEST_BACKUP_DIR, { recursive: true, force: true });
    }
    if (fs.existsSync(TEST_REPORTS_DIR)) {
      fs.rmSync(TEST_REPORTS_DIR, { recursive: true, force: true });
    }
  });

  afterEach(() => {
    if (fs.existsSync(TEST_BACKUP_DIR)) {
      fs.rmSync(TEST_BACKUP_DIR, { recursive: true, force: true });
    }
    if (fs.existsSync(TEST_REPORTS_DIR)) {
      fs.rmSync(TEST_REPORTS_DIR, { recursive: true, force: true });
    }
  });

  it("validates JSON integrity and media manifest hashes", () => {
    ensureBackupDirectories(TEST_BACKUP_DIR);

    // Write valid products JSON
    const productsPath = path.join(TEST_BACKUP_DIR, "json", "products.json");
    fs.writeFileSync(productsPath, JSON.stringify([{ id: "p1" }, { id: "p2" }]), "utf8");

    // Write media file and manifest
    const mediaPath = path.join(TEST_BACKUP_DIR, "media", "products", "item.jpg");
    fs.writeFileSync(mediaPath, "test media content", "utf8");
    const hash = computeSha256(mediaPath);

    const manifestEntry: MediaManifestEntry = {
      id: "m1",
      filename: "item.jpg",
      category: "products",
      url: "https://cdn.shopify.com/item.jpg",
      localPath: mediaPath,
      sizeBytes: 18,
      sha256: hash,
      status: "verified",
      downloadedAt: new Date().toISOString(),
    };
    fs.writeFileSync(
      path.join(TEST_BACKUP_DIR, "manifests", "media-manifest.json"),
      JSON.stringify([manifestEntry]),
      "utf8"
    );

    const result = verifyBackup(TEST_BACKUP_DIR, TEST_REPORTS_DIR);

    expect(result.jsonFiles[0]?.name).toBe("products");
    expect(result.jsonFiles[0]?.recordCount).toBe(2);
    expect(result.jsonFiles[0]?.validJson).toBe(true);
    expect(result.mediaFiles.verifiedOnDisk).toBe(1);
    expect(result.mediaFiles.hashMismatch).toBe(0);
    expect(result.mismatches).toHaveLength(0);

    // Verify markdown report
    const reportPath = path.join(TEST_REPORTS_DIR, "02-backup-verification.md");
    expect(fs.existsSync(reportPath)).toBe(true);
    const md = fs.readFileSync(reportPath, "utf8");
    expect(md).toContain("Overall Status: ✅ PASSED");
  });
});
