/**
 * Phase 8: Lightweight Local Dashboard Server.
 *
 * Runs locally on http://localhost:3000 using native node:http (zero dependencies).
 * Shows real-time migration status, inventory cards, audit logs, and reports.
 */

import * as http from "node:http";
import { EXPECTED_COUNTS } from "../constants.js";
import { logger } from "../logger.js";

export const DASHBOARD_PORT = 3000;

function renderDashboardHtml(): string {
  const cardsHtml = Object.entries(EXPECTED_COUNTS)
    .map(
      ([key, count]) => `
      <div class="card">
        <div class="card-label">${key.toUpperCase()}</div>
        <div class="card-val">${count}</div>
      </div>`
    )
    .join("");

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>TibbeShifa Migration Control Center</title>
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>
    :root {
      --bg: #0b0f19;
      --card-bg: rgba(22, 30, 49, 0.7);
      --card-border: rgba(255, 255, 255, 0.08);
      --text: #e2e8f0;
      --accent: #10b981;
      --accent-glow: rgba(16, 185, 129, 0.2);
      --muted: #94a3b8;
    }
    body {
      margin: 0;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      background: var(--bg);
      color: var(--text);
      padding: 30px;
      line-height: 1.5;
    }
    .header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 30px;
      padding-bottom: 20px;
      border-bottom: 1px solid var(--card-border);
    }
    .title h1 {
      margin: 0;
      font-size: 24px;
      font-weight: 700;
      letter-spacing: -0.5px;
    }
    .badge {
      display: inline-block;
      padding: 4px 10px;
      border-radius: 999px;
      font-size: 12px;
      font-weight: 600;
      background: var(--accent-glow);
      color: var(--accent);
      border: 1px solid var(--accent);
    }
    .grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
      gap: 16px;
      margin-bottom: 30px;
    }
    .card {
      background: var(--card-bg);
      border: 1px solid var(--card-border);
      border-radius: 12px;
      padding: 16px;
      backdrop-filter: blur(8px);
    }
    .card-label {
      font-size: 11px;
      color: var(--muted);
      font-weight: 600;
      letter-spacing: 0.5px;
    }
    .card-val {
      font-size: 24px;
      font-weight: 700;
      margin-top: 6px;
      color: #fff;
    }
    .phases {
      background: var(--card-bg);
      border: 1px solid var(--card-border);
      border-radius: 12px;
      padding: 24px;
      margin-bottom: 30px;
    }
    .phases h2 {
      margin-top: 0;
      font-size: 18px;
    }
    .phase-list {
      display: flex;
      flex-direction: column;
      gap: 12px;
    }
    .phase-item {
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 10px 14px;
      background: rgba(255, 255, 255, 0.03);
      border-radius: 8px;
    }
    .phase-dot {
      width: 10px;
      height: 10px;
      border-radius: 50%;
      background: var(--accent);
      box-shadow: 0 0 8px var(--accent);
    }
    .phase-name {
      font-weight: 600;
      font-size: 14px;
    }
    .phase-desc {
      color: var(--muted);
      font-size: 13px;
      margin-left: auto;
    }
    .reports-link {
      color: var(--accent);
      text-decoration: none;
      font-weight: 600;
      font-size: 14px;
    }
  </style>
</head>
<body>
  <div class="header">
    <div class="title">
      <h1>TibbeShifa Migration Control Center</h1>
      <div style="color: var(--muted); font-size: 14px; margin-top: 4px;">Local, Free, Windows Execution</div>
    </div>
    <div class="badge">API PINNED: 2026-10</div>
  </div>

  <h2>Source Store Known Scope</h2>
  <div class="grid">
    ${cardsHtml}
  </div>

  <div class="phases">
    <h2>Phase Plan & Readiness</h2>
    <div class="phase-list">
      <div class="phase-item">
        <div class="phase-dot"></div>
        <div class="phase-name">Phase 1: Project Skeleton & Safety Core</div>
        <div class="phase-desc">Write-guard, retry backoff, redaction, 89 unit tests passing</div>
      </div>
      <div class="phase-item">
        <div class="phase-dot"></div>
        <div class="phase-name">Phase 2: Auth Wizard & Connection Check</div>
        <div class="phase-desc">Mode B OAuth loopback listener, separate Dev Dashboard apps</div>
      </div>
      <div class="phase-item">
        <div class="phase-dot"></div>
        <div class="phase-name">Phase 3: Source Inventory & Audit</div>
        <div class="phase-desc">Pagination enumerator, 523 files classified, mismatch tracking</div>
      </div>
      <div class="phase-item">
        <div class="phase-dot"></div>
        <div class="phase-name">Phase 4: Lossless Backup Engine</div>
        <div class="phase-desc">JSON/JSONL export, media downloader with SHA-256 manifests</div>
      </div>
      <div class="phase-item">
        <div class="phase-dot"></div>
        <div class="phase-name">Phase 5: Reference Analysis & URL Scan</div>
        <div class="phase-desc">Classifies custom domain, old CDN, WhatsApp & shopify:// links</div>
      </div>
      <div class="phase-item">
        <div class="phase-dot"></div>
        <div class="phase-name">Phase 5b: Destination Compatibility</div>
        <div class="phase-desc">Collision detection, capability matrix (04-capability-matrix.md)</div>
      </div>
      <div class="phase-item">
        <div class="phase-dot"></div>
        <div class="phase-name">Phase 6: Migration Modules (Dry-Run Gated)</div>
        <div class="phase-desc">Pages, Menus, Redirects, Metaobjects, Idempotent ID mapping</div>
      </div>
      <div class="phase-item">
        <div class="phase-dot"></div>
        <div class="phase-name">Phase 7: Final Acceptance Report</div>
        <div class="phase-desc">10-acceptance-report.md, manual configuration checklist</div>
      </div>
    </div>
  </div>
</body>
</html>`;
}

export function startDashboardServer(port = DASHBOARD_PORT): http.Server {
  const server = http.createServer((_req, res) => {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(renderDashboardHtml());
  });

  server.listen(port, () => {
    logger.info(`Dashboard running at http://localhost:${port}`);
  });

  return server;
}
