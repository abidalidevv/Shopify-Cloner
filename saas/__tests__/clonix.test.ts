// saas/__tests__/clonix.test.ts
// Comprehensive unit tests for Clonix Micro-SaaS pairing, DAG progress polling, parity audit, and billing.

import { describe, it, expect } from "vitest";
import {
  generateCrockfordToken,
  hashToken,
  handleCreatePairing,
  handleClaimPairing,
  handleAuthorizePairing,
  getPairingStatus,
  createInitialRun,
  getRunProgress,
  getParityScorecard,
  getAvailablePlans,
} from "../api.js";
import { FREE_PRODUCT_LIMIT, PASS_PRICE_USD, AGENCY_PRICE_USD } from "../constants.js";

describe("Clonix SaaS API & Engine Tests", () => {
  /* ───────────────────────── 1. Crockford Token & Pairing ───────────────────────── */
  describe("Crockford Pairing Token Generation", () => {
    it("should generate valid 8-character Crockford Base32 tokens with a hyphen", () => {
      const token = generateCrockfordToken();
      expect(token).toHaveLength(9); // 8 chars + 1 hyphen
      expect(token[4]).toBe("-");

      // Verify no ambiguous characters (I, L, O, U)
      const allowedChars = /^[0-9ABCDEFGHJKMNPQRSTVWXYZ-]+$/;
      expect(allowedChars.test(token)).toBe(true);
    });

    it("should hash tokens consistently using HMAC-SHA256", () => {
      const token = "7K9M-2PX4";
      const hash1 = hashToken(token);
      const hash2 = hashToken("7k9m2px4"); // Case and hyphen insensitive
      expect(hash1).toBe(hash2);
      expect(hash1).toHaveLength(64); // SHA256 hex string
    });
  });

  describe("Pairing State Machine", () => {
    const sourceShop = "source-tibbeshifa.myshopify.com";
    const destShop = "dest-clone.myshopify.com";

    it("should successfully run the full 2-sided consent handshake", () => {
      // 1. Source creates pairing session
      const { code, pairId } = handleCreatePairing(sourceShop);
      expect(code).toBeDefined();
      expect(pairId).toBeDefined();

      const initialSession = getPairingStatus(code);
      expect(initialSession?.status).toBe("PENDING_CLAIM");
      expect(initialSession?.sourceShop).toBe(sourceShop);

      // 2. Destination claims the code
      const claimResult = handleClaimPairing(code, destShop);
      expect(claimResult.success).toBe(true);
      expect(claimResult.status).toBe("PENDING_APPROVAL");

      // 3. Source authorizes consent
      const authResult = handleAuthorizePairing(code, sourceShop);
      expect(authResult.success).toBe(true);
      expect(authResult.status).toBe("ACTIVE");

      const activeSession = getPairingStatus(code);
      expect(activeSession?.status).toBe("ACTIVE");
      expect(activeSession?.destShop).toBe(destShop);
    });

    it("should prevent self-pairing of the same store", () => {
      const { code } = handleCreatePairing(sourceShop);
      expect(() => handleClaimPairing(code, sourceShop)).toThrow("Cannot pair a store with itself");
    });

    it("should reject invalid or non-existent pairing codes", () => {
      expect(() => handleClaimPairing("INVALID-99", destShop)).toThrow("Invalid or expired pairing code");
    });
  });

  /* ───────────────────────── 2. DAG Progress & ETag Short-Polling ───────────────────────── */
  describe("DAG Progress Polling & ETag Optimization", () => {
    it("should create an initial 14-stage DAG migration run", () => {
      const source = "source.myshopify.com";
      const dest = "dest.myshopify.com";
      const run = createInitialRun(source, dest);

      expect(run.runId).toBeDefined();
      expect(run.stages).toHaveLength(14);
      expect(run.stages[0].name).toBe("Preflight & Probe");
      expect(run.stages[11].name).toBe("Theme & Liquid Schemas");
      expect(run.stages[13].name).toBe("Storefront Verification");
      expect(run.percentage).toBeGreaterThanOrEqual(0);
    });

    it("should return notModified: true when client provides matching ETag (HTTP 304 simulation)", () => {
      const run = createInitialRun("shopA.myshopify.com", "shopB.myshopify.com");
      const etag = run.etag;

      // When client sends matching etag:
      const check1 = getRunProgress(run.runId, etag);
      expect(check1.notModified).toBe(true);
      expect(check1.run).toBeUndefined();

      // When client sends mismatched etag:
      const check2 = getRunProgress(run.runId, "old_stale_etag");
      expect(check2.notModified).toBe(false);
      expect(check2.run?.runId).toBe(run.runId);
    });
  });

  /* ───────────────────────── 3. Parity Audit Verification ───────────────────────── */
  describe("Storefront Parity Scorecard", () => {
    it("should report 100% preservation for Urdu titles, template suffixes, and zero-leak CDN", () => {
      const scorecard = getParityScorecard("dummy_run_id");
      expect(scorecard.length).toBeGreaterThanOrEqual(4);

      const urduCheck = scorecard.find((s) => s.asset.includes("Urdu Titles"));
      expect(urduCheck?.parityCheck).toBe("MATCH");

      const suffixCheck = scorecard.find((s) => s.asset.includes("Custom Template"));
      expect(suffixCheck?.parityCheck).toBe("PRESERVED");

      const cdnCheck = scorecard.find((s) => s.asset.includes("Zero-Leak CDN"));
      expect(cdnCheck?.parityCheck).toBe("ZERO_LEAK");
    });
  });

  /* ───────────────────────── 4. Pricing & Monetization Model ───────────────────────── */
  describe("Clonix Monetization Structure", () => {
    it("should enforce exact commercial pricing: $0 Freemium, $9 Single Pass, $49/mo Unlimited", () => {
      expect(FREE_PRODUCT_LIMIT).toBe(12);
      expect(PASS_PRICE_USD).toBe(9);
      expect(AGENCY_PRICE_USD).toBe(49);

      const plans = getAvailablePlans();
      expect(plans).toHaveLength(3);

      const freePlan = plans.find((p) => p.id === "plan_freemium");
      expect(freePlan?.priceUsd).toBe(0);
      expect(freePlan?.productLimit).toBe(12);

      const singlePass = plans.find((p) => p.id === "plan_single_pass");
      expect(singlePass?.priceUsd).toBe(9);
      expect(singlePass?.interval).toBe("ONE_TIME");

      const agencyPro = plans.find((p) => p.id === "plan_agency_pro");
      expect(agencyPro?.priceUsd).toBe(49);
      expect(agencyPro?.interval).toBe("EVERY_30_DAYS");
    });
  });

  /* ───────────────────────── 5. HTTP Server Integration Tests ───────────────────────── */
  describe("Clonix HTTP Server Endpoints", () => {
    it("should respond to health, billing, pairing, and static requests over HTTP", async () => {
      const { createServer } = await import("../server.js");
      const server = createServer();
      
      await new Promise<void>((resolve) => {
        server.listen(0, resolve);
      });

      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 3000;
      const baseUrl = `http://127.0.0.1:${port}`;

      try {
        // 1. Health check
        const healthRes = await fetch(`${baseUrl}/api/health`);
        expect(healthRes.status).toBe(200);
        const healthData = await healthRes.json();
        expect(healthData.service).toBe("Clonix SaaS API");

        // 2. Billing plans
        const plansRes = await fetch(`${baseUrl}/api/billing/plans`);
        expect(plansRes.status).toBe(200);
        const plansData = await plansRes.json();
        expect(plansData.plans).toHaveLength(3);

        // 3. Pairing create
        const createRes = await fetch(`${baseUrl}/api/pairing/create`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sourceShop: "ph0igg-jv.myshopify.com" }),
        });
        expect(createRes.status).toBe(201);
        const createData = await createRes.json();
        expect(createData.code).toBeDefined();

        // 4. Parity scorecard
        const parityRes = await fetch(`${baseUrl}/api/runs/test_run/parity`);
        expect(parityRes.status).toBe(200);
        const parityData = await parityRes.json();
        expect(parityData.items.length).toBeGreaterThan(0);

        // 5. Root HTML serving
        const rootRes = await fetch(`${baseUrl}/`);
        expect(rootRes.status).toBe(200);
        const html = await rootRes.text();
        expect(html).toContain("Clonix");
      } finally {
        await new Promise<void>((resolve) => {
          server.close(() => resolve());
        });
      }
    });
  });
});

