/**
 * CLI Runner for Phase 8: Local Control Dashboard.
 *
 * Usage:
 *   npm run dashboard
 */

import { startDashboardServer, DASHBOARD_PORT } from "./dashboard/server.js";

console.log("\n=======================================================");
console.log(" TibbeShifa Migrator — Phase 8: Local Control Center");
console.log("=======================================================\n");

startDashboardServer(DASHBOARD_PORT);
console.log(`Open http://localhost:${DASHBOARD_PORT} in your browser.`);
console.log("Press Ctrl+C to stop.\n");
