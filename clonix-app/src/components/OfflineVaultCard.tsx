// clonix-app/src/components/OfflineVaultCard.tsx
import React from "react";
import type { VaultSnapshot } from "../types/clonix";

interface OfflineVaultCardProps {
  snapshots: VaultSnapshot[];
  onCreateSnapshot: () => void;
  onDownloadSnapshot: (id: string) => void;
  isCreating?: boolean;
}

export const OfflineVaultCard: React.FC<OfflineVaultCardProps> = ({
  snapshots,
  onCreateSnapshot,
  onDownloadSnapshot,
  isCreating = false,
}) => {
  return (
    <div className="workspace-card">
      <h3 className="section-title">Offline Vault Backups</h3>
      <p className="section-subtitle">
        1-click compressed disaster recovery ZIP snapshots containing themes, JSON catalogs, and metafields.
      </p>

      {snapshots.map((snap) => (
        <div
          key={snap.id}
          style={{
            background: "var(--bg-subtle)",
            border: "1px solid var(--border-hairline)",
            borderRadius: "var(--radius-md)",
            padding: "20px",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            marginBottom: "16px",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "14px" }}>
            <div
              style={{
                width: "42px",
                height: "42px",
                borderRadius: "8px",
                background: "#eff6ff",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                color: "#2563eb",
              }}
            >
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                <polyline points="7 10 12 15 17 10" />
                <line x1="12" y1="15" x2="12" y2="3" />
              </svg>
            </div>
            <div>
              <div style={{ fontWeight: 700, fontSize: "14px" }}>{snap.filename}</div>
              <div style={{ fontSize: "12px", color: "var(--fg-secondary)" }}>
                {snap.sizeMb} MB • Highly Compressed • {snap.productCount} Products • {snap.themeCount} Themes
              </div>
            </div>
          </div>
          <button className="btn btn-secondary" onClick={() => onDownloadSnapshot(snap.id)}>
            Download ZIP
          </button>
        </div>
      ))}

      <button className="btn btn-primary" onClick={onCreateSnapshot} disabled={isCreating}>
        {isCreating ? "Compressing Store Snapshot..." : "Create New Snapshot Now"}
      </button>
    </div>
  );
};
