/**
 * Persistent ID and URL Mapping Manager.
 *
 * Maintains:
 * - mappings/id-map.json: Maps source GIDs to destination GIDs per resource type
 * - mappings/file-url-map.json: Maps old source CDN URLs to new destination CDN URLs
 *
 * Goal file §Phase 6: "Maintain mappings/id-map.json (source GID to destination GID
 * per resource type). Never assume GIDs are equal across stores."
 */

import * as fs from "node:fs";
import * as path from "node:path";

export interface IdMapStore {
  products: Record<string, string>;
  variants: Record<string, string>;
  collections: Record<string, string>;
  files: Record<string, string>;
  pages: Record<string, string>;
  menus: Record<string, string>;
  metaobjects: Record<string, string>;
  metaobjectDefinitions: Record<string, string>;
  redirects: Record<string, string>;
}

export interface FileUrlMapping {
  sourceGid: string;
  sourceUrl: string;
  destGid?: string | undefined;
  destUrl?: string | undefined;
  filename: string;
  checksum: string;
  status: "pending" | "uploaded" | "verified" | "failed";
}

export class MappingManager {
  private idMap: IdMapStore;
  private fileUrlMap: Record<string, FileUrlMapping>;
  private readonly mappingsDir: string;

  constructor(mappingsDir = "mappings") {
    this.mappingsDir = mappingsDir;
    this.idMap = {
      products: {},
      variants: {},
      collections: {},
      files: {},
      pages: {},
      menus: {},
      metaobjects: {},
      metaobjectDefinitions: {},
      redirects: {},
    };
    this.fileUrlMap = {};
    this.load();
  }

  private load(): void {
    const idMapPath = path.join(this.mappingsDir, "id-map.json");
    if (fs.existsSync(idMapPath)) {
      try {
        this.idMap = JSON.parse(fs.readFileSync(idMapPath, "utf8"));
      } catch {
        // Keep initial empty structure
      }
    }

    const fileMapPath = path.join(this.mappingsDir, "file-url-map.json");
    if (fs.existsSync(fileMapPath)) {
      try {
        this.fileUrlMap = JSON.parse(fs.readFileSync(fileMapPath, "utf8"));
      } catch {
        // Keep initial empty structure
      }
    }
  }

  public save(): void {
    fs.mkdirSync(this.mappingsDir, { recursive: true });
    fs.writeFileSync(
      path.join(this.mappingsDir, "id-map.json"),
      JSON.stringify(this.idMap, null, 2),
      "utf8"
    );
    fs.writeFileSync(
      path.join(this.mappingsDir, "file-url-map.json"),
      JSON.stringify(this.fileUrlMap, null, 2),
      "utf8"
    );
  }

  public recordId(
    resource: keyof IdMapStore,
    sourceGid: string,
    destGid: string
  ): void {
    this.idMap[resource][sourceGid] = destGid;
    this.save();
  }

  public getDestId(resource: keyof IdMapStore, sourceGid: string): string | undefined {
    return this.idMap[resource][sourceGid];
  }

  public recordFileMapping(mapping: FileUrlMapping): void {
    this.fileUrlMap[mapping.sourceUrl] = mapping;
    if (mapping.destGid) {
      this.idMap.files[mapping.sourceGid] = mapping.destGid;
    }
    this.save();
  }

  public getDestFileUrl(sourceUrl: string): string | undefined {
    return this.fileUrlMap[sourceUrl]?.destUrl;
  }

  public getAllIdMappings(): IdMapStore {
    return this.idMap;
  }

  public getAllFileMappings(): Record<string, FileUrlMapping> {
    return this.fileUrlMap;
  }
}
