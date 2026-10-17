// clonix-app/src/components/AppHeader.tsx
import React from "react";
import type { ActiveTab } from "../types/clonix";

interface AppHeaderProps {
  activeStore: string;
  onNavigateTab: (tab: ActiveTab) => void;
}

export const AppHeader: React.FC<AppHeaderProps> = ({ activeStore, onNavigateTab }) => {
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
