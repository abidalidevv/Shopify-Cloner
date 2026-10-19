// saas/server.ts — Production-ready HTTP server for Clonix Micro-SaaS
// Serves REST API endpoints and built frontend assets with zero third-party dependencies.

import * as http from "node:http";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import {
  handleCreatePairing,
  handleClaimPairing,
  handleAuthorizePairing,
  getPairingStatus,
  createInitialRun,
  getRunProgress,
  getParityScorecard,
  getAvailablePlans,
} from "./api.js";
import { listSnapshots, createSnapshot, deleteSnapshot } from "./vault.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Paths to static frontend builds
const FRONTEND_DIST = path.resolve(__dirname, "../../clonix-app/dist");
const PREVIEW_FALLBACK = path.resolve(__dirname, "../../clonix-preview");

const PORT = parseInt(process.env.PORT || "3000", 10);

function sendJson(res: http.ServerResponse, statusCode: number, data: unknown, headers: Record<string, string> = {}) {
  const payload = JSON.stringify(data);
  res.writeHead(statusCode, {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, If-None-Match",
    ...headers,
  });
  res.end(payload);
}

function parseJsonBody(req: http.IncomingMessage): Promise<any> {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 1e6) {
        // 1MB max body limit
        req.destroy();
        reject(new Error("Request entity too large"));
      }
    });
    req.on("end", () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (err) {
        reject(new Error("Invalid JSON body"));
      }
    });
    req.on("error", reject);
  });
}

function getContentType(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  switch (ext) {
    case ".html": return "text/html; charset=utf-8";
    case ".css": return "text/css; charset=utf-8";
    case ".js": return "application/javascript; charset=utf-8";
    case ".json": return "application/json; charset=utf-8";
    case ".png": return "image/png";
    case ".jpg": case ".jpeg": return "image/jpeg";
    case ".svg": return "image/svg+xml";
    case ".webp": return "image/webp";
    case ".ico": return "image/x-icon";
    case ".zip": return "application/zip";
    default: return "application/octet-stream";
  }
}

export function createServer(): http.Server {
  return http.createServer(async (req, res) => {
    const parsedUrl = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
    const pathname = parsedUrl.pathname;
    const method = req.method || "GET";

    console.log(`[HTTP ${new Date().toISOString().slice(11, 19)}] ${method} ${pathname}${parsedUrl.search}`);

    // Handle CORS preflight
    if (method === "OPTIONS") {
      res.writeHead(204, {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, If-None-Match",
      });
      res.end();
      return;
    }

    try {
      /* ───────────────────────── API Routes ───────────────────────── */

      // GET /api/health
      if (method === "GET" && pathname === "/api/health") {
        sendJson(res, 200, {
          status: "ok",
          service: "Clonix SaaS API",
          version: "1.0.0",
          timestamp: new Date().toISOString(),
        });
        return;
      }

      // GET /api/billing/plans
      if (method === "GET" && pathname === "/api/billing/plans") {
        sendJson(res, 200, { plans: getAvailablePlans() });
        return;
      }

      // POST /api/pairing/create
      if (method === "POST" && pathname === "/api/pairing/create") {
        const body = await parseJsonBody(req);
        const sourceShop = body.sourceShop || "source.myshopify.com";
        const result = handleCreatePairing(sourceShop);
        sendJson(res, 201, result);
        return;
      }

      // POST /api/pairing/claim
      if (method === "POST" && pathname === "/api/pairing/claim") {
        const body = await parseJsonBody(req);
        if (!body.code || !body.destShop) {
          sendJson(res, 400, { error: "Missing required fields: code and destShop" });
          return;
        }
        const result = handleClaimPairing(body.code, body.destShop);
        sendJson(res, 200, result);
        return;
      }

      // POST /api/pairing/authorize
      if (method === "POST" && pathname === "/api/pairing/authorize") {
        const body = await parseJsonBody(req);
        if (!body.code || !body.sourceShop) {
          sendJson(res, 400, { error: "Missing required fields: code and sourceShop" });
          return;
        }
        const result = handleAuthorizePairing(body.code, body.sourceShop);
        sendJson(res, 200, result);
        return;
      }

      // GET /api/pairing/:code
      if (method === "GET" && pathname.startsWith("/api/pairing/")) {
        const code = pathname.slice("/api/pairing/".length);
        const session = getPairingStatus(code);
        if (!session) {
          sendJson(res, 404, { error: "Pairing session not found or expired" });
          return;
        }
        sendJson(res, 200, session);
        return;
      }

      // POST /api/runs/create
      if (method === "POST" && pathname === "/api/runs/create") {
        const body = await parseJsonBody(req);
        const sourceShop = body.sourceShop || "ph0igg-jv.myshopify.com";
        const destShop = body.destShop || "dest.myshopify.com";
        const run = createInitialRun(sourceShop, destShop);
        sendJson(res, 201, run, { ETag: run.etag });
        return;
      }

      // GET /api/runs/:runId/progress
      if (method === "GET" && pathname.match(/^\/api\/runs\/[^/]+\/progress$/)) {
        const runId = pathname.split("/")[3];
        if (!runId) {
          sendJson(res, 400, { error: "Missing runId parameter" });
          return;
        }

        const clientEtag = typeof req.headers["if-none-match"] === "string" ? req.headers["if-none-match"] : undefined;
        try {
          const result = getRunProgress(runId, clientEtag);
          if (result.notModified) {
            res.writeHead(304, {
              "Access-Control-Allow-Origin": "*",
              ...(clientEtag ? { ETag: clientEtag } : {}),
            });
            res.end();
            return;
          }

          if (result.run) {
            sendJson(res, 200, result.run, { ETag: result.run.etag });
            return;
          }
        } catch {
          sendJson(res, 404, { error: "Migration run not found" });
          return;
        }
      }

      // GET /api/runs/:runId/parity
      if (method === "GET" && pathname.match(/^\/api\/runs\/[^/]+\/parity$/)) {
        const runId = pathname.split("/")[3];
        if (!runId) {
          sendJson(res, 400, { error: "Missing runId parameter" });
          return;
        }
        const scorecard = getParityScorecard(runId);
        sendJson(res, 200, { runId, items: scorecard });
        return;
      }

      // GET /api/vault/snapshots
      if (method === "GET" && pathname === "/api/vault/snapshots") {
        sendJson(res, 200, { snapshots: listSnapshots() });
        return;
      }

      // POST /api/vault/create-snapshot
      if (method === "POST" && pathname === "/api/vault/create-snapshot") {
        const body = await parseJsonBody(req);
        const mode = body.mode === "FULL_OFFLINE_MEDIA" ? "FULL_OFFLINE_MEDIA" : "FAST_CDN";
        const snap = createSnapshot(mode);
        sendJson(res, 201, snap);
        return;
      }

      // DELETE /api/vault/snapshots/:id
      if (method === "DELETE" && pathname.startsWith("/api/vault/snapshots/")) {
        const id = pathname.slice("/api/vault/snapshots/".length);
        const success = deleteSnapshot(id);
        sendJson(res, success ? 200 : 404, { success });
        return;
      }

      /* ───────────────────────── Static File Serving ───────────────────────── */
      let targetDir = fs.existsSync(FRONTEND_DIST) ? FRONTEND_DIST : PREVIEW_FALLBACK;
      let safePath = path.normalize(pathname).replace(/^(\.\.[/\\])+/, "");
      if (safePath === "/" || safePath === "\\") {
        safePath = "/index.html";
      }

      let filePath = path.join(targetDir, safePath);

      if (!fs.existsSync(filePath)) {
        // SPA Fallback: serve index.html for unknown HTML paths
        filePath = path.join(targetDir, "index.html");
      }

      if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
        const contentType = getContentType(filePath);
        const content = fs.readFileSync(filePath);
        const headers: Record<string, string | number> = {
          "Content-Type": contentType,
          "Content-Length": content.length,
          "Cache-Control": filePath.endsWith("index.html") ? "no-cache" : "public, max-age=31536000, immutable",
          "Content-Security-Policy": "frame-ancestors https://admin.shopify.com https://*.myshopify.com;",
        };
        if (filePath.endsWith(".zip")) {
          headers["Content-Disposition"] = `attachment; filename="${path.basename(filePath)}"`;
        }
        res.writeHead(200, headers);
        res.end(content);
        return;
      }

      sendJson(res, 404, { error: "Not Found" });
    } catch (err: any) {
      sendJson(res, 500, { error: err.message || "Internal Server Error" });
    }
  });
}

// Start standalone server if run directly
if (process.argv[1] && process.argv[1].endsWith("server.ts") || process.argv[1]?.endsWith("server.js")) {
  const server = createServer();
  server.listen(PORT, () => {
    console.log(`[Clonix SaaS] Server listening on http://localhost:${PORT}`);
    console.log(`[Clonix SaaS] Serving UI from ${fs.existsSync(FRONTEND_DIST) ? FRONTEND_DIST : PREVIEW_FALLBACK}`);
  });
}
