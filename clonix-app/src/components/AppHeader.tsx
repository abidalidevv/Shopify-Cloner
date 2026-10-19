// clonix-app/src/components/AppHeader.tsx
import React from "react";
import type { ActiveTab } from "../types/clonix";

interface AppHeaderProps {
  activeStore: string;
  currentPlan?: string;
  onNavigateTab: (tab: ActiveTab) => void;
}

export const AppHeader: React.FC<AppHeaderProps> = ({
  activeStore,
  currentPlan = "Unlimited Pro ($49/mo)",
  onNavigateTab,
}) => {
  return (
    <header className="top-bar">
      <div className="brand-group">
        <div className="logo-badge">C</div>
        <div>
          <div className="brand-title">
            Clonix
            <span className="brand-version-pill">v1.0 Pro</span>
          </div>
          <div className="brand-tagline">Shopify Store Cloner &amp; Automated Vault</div>
        </div>
      </div>

      <div className="top-actions">
        {/* Prominent Active Plan Badge */}
        <div
          onClick={() => onNavigateTab("pricing")}
          style={{
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            gap: "8px",
            background: "linear-gradient(135deg, rgba(16, 185, 129, 0.15), rgba(5, 150, 105, 0.08))",
            border: "1px solid rgba(16, 185, 129, 0.35)",
            padding: "5px 12px",
            borderRadius: "8px",
            fontSize: "12px",
            fontWeight: 600,
            color: "#047857",
            boxShadow: "0 2px 8px rgba(16, 185, 129, 0.1)",
          }}
          title="Click to view plan details"
        >
          <span style={{ fontSize: "14px" }}>👑</span>
          <span>Plan: <strong>{currentPlan}</strong></span>
          <span
            style={{
              background: "#10b981",
              color: "#fff",
              padding: "1px 6px",
              borderRadius: "4px",
              fontSize: "10px",
              fontWeight: 700,
              letterSpacing: "0.5px",
            }}
          >
            ACTIVE
          </span>
        </div>

        <div className="store-connection-pill">
          <div className="status-dot-pulse">
            <div className="ring"></div>
            <div className="core"></div>
          </div>
          <span>Active: <strong>{activeStore}</strong></span>
        </div>

        <button className="btn btn-secondary" onClick={() => onNavigateTab("pricing")}>
          Plans &amp; Pricing
        </button>
      </div>
    </header>
  );
};
