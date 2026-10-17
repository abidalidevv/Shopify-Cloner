// clonix-app/src/App.tsx
import React, { useState } from "react";
import type { StoreRole, ActiveTab, ParityItem, VaultSnapshot, BillingPlan } from "./types/clonix";
import { AppHeader } from "./components/AppHeader";
import { RoleSelector } from "./components/RoleSelector";
import { OrbitalSyncCanvas } from "./components/OrbitalSyncCanvas";
import { PairingWorkspace } from "./components/PairingWorkspace";
import { DAGExecutionProgress } from "./components/DAGExecutionProgress";
import { ParityScoreTable } from "./components/ParityScoreTable";
import { OfflineVaultCard } from "./components/OfflineVaultCard";
import { PricingPlansCard } from "./components/PricingPlansCard";
import { usePairingSession } from "./hooks/usePairingSession";
import { useMigrationProgress } from "./hooks/useMigrationProgress";

const DEMO_PARITY_ITEMS: ParityItem[] = [
  {
    asset: "Products & Urdu Titles",
    sourceCount: "7 Products",
    destStatus: "7 Created (100% Match)",
    parityCheck: "MATCH",
    notes: "Urdu strings preserved without encoding corruption",
  },
  {
    asset: "Custom Template Suffixes",
    sourceCount: "newmedda, newqabz",
    destStatus: "Preserved",
    parityCheck: "PRESERVED",
    notes: "Zero 404 fallback crashes on custom layouts",
  },
  {
    asset: "Inventory Stock Levels",
    sourceCount: "97, 98, 99 In Stock",
    destStatus: "Tracked: True",
    parityCheck: "SYNCED",
    notes: "Quantity matching exact source store levels",
  },
  {
    asset: "Zero-Leak CDN Images",
    sourceCount: "523 Images",
    destStatus: "0 Leaks Found",
    parityCheck: "ZERO_LEAK",
    notes: "All URLs rewritten to destination CDN files",
  },
];

const DEMO_SNAPSHOTS: VaultSnapshot[] = [
  {
    id: "snap_1",
    filename: "TibbeShifa-Old-Store-Complete-Backup-2026-10-17.zip",
    sizeMb: 1.78,
    createdAt: "2026-10-17 19:46 UTC",
    productCount: 7,
    themeCount: 1,
    hasMetafields: true,
  },
];

const BILLING_PLANS: BillingPlan[] = [
  {
    id: "plan_freemium",
    name: "Freemium Audit",
    priceUsd: 0,
    interval: "ONE_TIME",
    description: "Forever free for small stores & pre-flight audits",
    features: [
      "Up to 12 Products & 1 Collection",
      "Full Store Parity & Health Audit",
      "Active Theme Liquid Copy",
    ],
  },
  {
    id: "plan_single_pass",
    name: "Single Clone Pass",
    priceUsd: 9,
    interval: "ONE_TIME",
    featured: true,
    tag: "MOST POPULAR",
    description: "One-time fee per destination store",
    features: [
      "Unlimited Products, Collections & Themes",
      "Zero-Leak CDN Asset Remapping",
      "Template Suffix Guard (Zero 404s)",
      "Billed ONLY to Destination Store ($0 for Source)",
    ],
  },
  {
    id: "plan_unlimited_pro",
    name: "Unlimited Pro",
    priceUsd: 49,
    interval: "MONTHLY",
    description: "For agencies, dropshippers & multi-store brands",
    features: [
      "Unlimited Store Duplications Every Month",
      "Automated Daily Vault Backups",
      "Master Agency Pairing Key (Zero Repeated Consents)",
      "Priority Developer Support",
    ],
  },
];

export const App: React.FC = () => {
  const activeStore = "ph0igg-jv.myshopify.com";
  const [activeTab, setActiveTab] = useState<ActiveTab>("cloner");
  const [selectedRole, setSelectedRole] = useState<StoreRole>("SOURCE");

  const { session, regenerateCode, copyCode, authorizeClaim } = usePairingSession(activeStore);
  const { run, isSimulating, startMigrationSimulation } = useMigrationProgress();

  const handleAuthorizeClone = (code: string) => {
    authorizeClaim(code, "tibbeshifa-clone.myshopify.com");
    alert(`Handshake authorized for token ${code}! Starting 14-stage DAG migration with Zero-Leak CDN...`);
    startMigrationSimulation();
  };

  const handleCreateSnapshot = () => {
    alert("Creating new compressed store snapshot (theme, catalog, metafields)...");
  };

  const handleDownloadSnapshot = (id: string) => {
    alert(`Downloading offline vault archive (${id})...`);
  };

  const handleSelectPlan = (planId: string) => {
    if (planId === "plan_single_pass") {
      alert("Redirecting to Shopify Billing API for Single Clone Pass ($9 one-time)...");
    } else if (planId === "plan_unlimited_pro") {
      alert("Redirecting to Shopify Billing API for Unlimited Pro ($49/month recurring)...");
    } else {
      setActiveTab("cloner");
    }
  };

  return (
    <div className="app-shell">
      <AppHeader activeStore={activeStore} onNavigateTab={setActiveTab} />

      {/* Top Freemium Audit Banner */}
      <div className="notice-banner">
        <div className="notice-text">
          <span className="badge-lime">100% FREE AUDIT</span>&nbsp;
          <strong>Pre-Flight Parity Check:</strong> Scan your store for custom templates (
          <code>newmedda</code>, <code>newqabz</code>), metafields, and CDN links with zero risk.
        </div>
        <button className="btn btn-secondary" onClick={startMigrationSimulation}>
          Run Free Health Audit
        </button>
      </div>

      {/* Navigation Tabs */}
      <nav className="tab-bar">
        <button
          className={`tab-btn ${activeTab === "cloner" ? "active" : ""}`}
          onClick={() => setActiveTab("cloner")}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect>
            <path d="M7 11V7a5 5 0 0 1 10 0v4"></path>
          </svg>
          Store Cloner &amp; Handshake
        </button>

        <button
          className={`tab-btn ${activeTab === "vault" ? "active" : ""}`}
          onClick={() => setActiveTab("vault")}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
            <polyline points="7 10 12 15 17 10"></polyline>
            <line x1="12" y1="15" x2="12" y2="3"></line>
          </svg>
          Offline Vault Backup (ZIP)
        </button>

        <button
          className={`tab-btn ${activeTab === "pricing" ? "active" : ""}`}
          onClick={() => setActiveTab("pricing")}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="12" cy="12" r="10"></circle>
            <path d="M16 8h-6a2 2 0 1 0 0 4h4a2 2 0 1 1 0 4H8"></path>
            <path d="M12 18V6"></path>
          </svg>
          Pricing &amp; Plans ($9 / $49)
        </button>
      </nav>

      {/* TAB 1: CLONER & ROLE WORKFLOW */}
      {activeTab === "cloner" && (
        <div>
          <RoleSelector selectedRole={selectedRole} onSelectRole={setSelectedRole} />

          <OrbitalSyncCanvas
            sourceShop={activeStore}
            destShop={session.destShop || "tibbeshifa-clone"}
            activeStageName={run.stages[run.currentStage]?.name || "Theme & Liquid Schemas"}
            activeStageNumber={run.currentStage}
            totalStages={14}
          />

          <PairingWorkspace
            currentRole={selectedRole}
            pairingCode={session.code}
            onCopyCode={copyCode}
            onRegenerateCode={regenerateCode}
            onAuthorizeClone={handleAuthorizeClone}
            isLoading={isSimulating}
          />

          <DAGExecutionProgress
            currentStage={run.currentStage}
            percentage={run.percentage}
            stages={run.stages}
            status={run.status}
          />

          <ParityScoreTable items={DEMO_PARITY_ITEMS} />
        </div>
      )}

      {/* TAB 2: OFFLINE VAULT BACKUPS */}
      {activeTab === "vault" && (
        <OfflineVaultCard
          snapshots={DEMO_SNAPSHOTS}
          onCreateSnapshot={handleCreateSnapshot}
          onDownloadSnapshot={handleDownloadSnapshot}
        />
      )}

      {/* TAB 3: PRICING & PLANS */}
      {activeTab === "pricing" && (
        <PricingPlansCard plans={BILLING_PLANS} onSelectPlan={handleSelectPlan} />
      )}
    </div>
  );
};

export default App;
