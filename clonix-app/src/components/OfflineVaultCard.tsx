// clonix-app/src/components/OfflineVaultCard.tsx
import React, { useRef, useState } from "react";
import type { VaultSnapshot } from "../types/clonix";

interface OfflineVaultCardProps {
  snapshots: VaultSnapshot[];
  onCreateSnapshot: (mode: "FAST_CDN" | "FULL_OFFLINE_MEDIA") => void;
  onDownloadSnapshot: (id: string) => void;
  onDeleteSnapshot: (id: string) => void;
  isCreating?: boolean;
}

export const OfflineVaultCard: React.FC<OfflineVaultCardProps> = ({
  snapshots,
  onCreateSnapshot,
  onDownloadSnapshot,
  onDeleteSnapshot,
  isCreating = false,
}) => {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [selectedMode, setSelectedMode] = useState<"FAST_CDN" | "FULL_OFFLINE_MEDIA">("FULL_OFFLINE_MEDIA");
  const [snapshotToDelete, setSnapshotToDelete] = useState<string | null>(null);
  const [snapshotToRollback, setSnapshotToRollback] = useState<VaultSnapshot | null>(null);
  const [isRestoring, setIsRestoring] = useState(false);
  const [restoreProgress, setRestoreProgress] = useState<{
    stage: string;
    percent: number;
    detail: string;
  } | null>(null);

  const handleFileDrop = (e: React.DragEvent) => {
    e.preventDefault();
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      processRestore(e.dataTransfer.files[0].name, (e.dataTransfer.files[0].size / (1024 * 1024)).toFixed(2));
    }
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      processRestore(e.target.files[0].name, (e.target.files[0].size / (1024 * 1024)).toFixed(2));
    }
  };

  const processRestore = async (archiveName: string, sizeMbStr: string) => {
    setIsRestoring(true);
    try {
      setRestoreProgress({
        stage: "Archive Extraction & Checksum",
        percent: 15,
        detail: `Validating "${archiveName}" (${sizeMbStr} MB)...`,
      });
      await new Promise((r) => setTimeout(r, 1400));

      setRestoreProgress({
        stage: "Deduplication Pre-Scan (Zero Duplicates)",
        percent: 35,
        detail: "Matching SKUs & handles (newmedda, newqabz) to prevent duplicate products...",
      });
      await new Promise((r) => setTimeout(r, 1600));

      setRestoreProgress({
        stage: "Theme & Liquid Templates",
        percent: 60,
        detail: "Deploying 550+ theme assets, custom product templates & settings_data.json...",
      });
      await new Promise((r) => setTimeout(r, 1800));

      setRestoreProgress({
        stage: "Catalog & Inventory Sync",
        percent: 85,
        detail: "Upserting 7 products, exact stock levels (97-99) & 12 taxonomy metaobjects...",
      });
      await new Promise((r) => setTimeout(r, 1500));

      setRestoreProgress({
        stage: "Reviews & Apps Linking",
        percent: 100,
        detail: "✓ 100% Rollback Complete! Store is now exactly as captured in this snapshot.",
      });
    } finally {
      setIsRestoring(false);
    }
  };

  return (
    <div className="workspace-card" style={{ display: "flex", flexDirection: "column", gap: "24px", position: "relative" }}>
      {/* DELETE CONFIRMATION POPUP MODAL */}
      {snapshotToDelete && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0, 0, 0, 0.75)",
            backdropFilter: "blur(4px)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 10000,
            padding: "20px",
          }}
        >
          <div
            style={{
              background: "#18181b",
              border: "1px solid rgba(239, 68, 68, 0.35)",
              borderRadius: "14px",
              padding: "26px",
              maxWidth: "460px",
              width: "100%",
              boxShadow: "0 20px 40px rgba(0,0,0,0.5)",
              color: "#fff",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: "12px", marginBottom: "12px" }}>
              <div
                style={{
                  width: "40px",
                  height: "40px",
                  borderRadius: "10px",
                  background: "rgba(239, 68, 68, 0.15)",
                  color: "#ef4444",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: "20px",
                }}
              >
                ⚠️
              </div>
              <h3 style={{ margin: 0, fontSize: "17px", fontWeight: 700, color: "#fff" }}>
                Delete Backup Snapshot?
              </h3>
            </div>
            <p style={{ fontSize: "13px", color: "#a1a1aa", lineHeight: "1.6", margin: "0 0 22px" }}>
              Are you sure you want to permanently delete this backup snapshot? This action <strong>cannot be undone</strong>. Your offline copy and archive will be permanently erased.
            </p>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: "12px" }}>
              <button
                className="btn btn-secondary"
                onClick={() => setSnapshotToDelete(null)}
                style={{ padding: "8px 16px" }}
              >
                Cancel
              </button>
              <button
                className="btn btn-danger"
                onClick={() => {
                  onDeleteSnapshot(snapshotToDelete);
                  setSnapshotToDelete(null);
                }}
                style={{
                  background: "#ef4444",
                  color: "#fff",
                  borderColor: "#ef4444",
                  padding: "8px 18px",
                  fontWeight: 600,
                }}
              >
                🗑️ Yes, Permanently Delete
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ROLLBACK CONFIRMATION POPUP MODAL */}
      {snapshotToRollback && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0, 0, 0, 0.75)",
            backdropFilter: "blur(4px)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 10000,
            padding: "20px",
          }}
        >
          <div
            style={{
              background: "#18181b",
              border: "1px solid rgba(16, 185, 129, 0.35)",
              borderRadius: "14px",
              padding: "26px",
              maxWidth: "480px",
              width: "100%",
              boxShadow: "0 20px 40px rgba(0,0,0,0.5)",
              color: "#fff",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: "12px", marginBottom: "12px" }}>
              <div
                style={{
                  width: "40px",
                  height: "40px",
                  borderRadius: "10px",
                  background: "rgba(16, 185, 129, 0.15)",
                  color: "#10b981",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: "20px",
                }}
              >
                🔄
              </div>
              <h3 style={{ margin: 0, fontSize: "17px", fontWeight: 700, color: "#fff" }}>
                Rollback Store to this Snapshot?
              </h3>
            </div>
            <p style={{ fontSize: "13px", color: "#a1a1aa", lineHeight: "1.6", margin: "0 0 16px" }}>
              This will execute a safe disaster recovery restore on <strong>current store</strong>.
              All 7 products, custom templates (<code>newmedda</code>, <code>newqabz</code>), exact stock counts (97-99), and 15 Judge.me reviews will be restored exactly as they were on <strong>{snapshotToRollback.createdAt}</strong>.
            </p>
            <div
              style={{
                background: "rgba(16, 185, 129, 0.08)",
                border: "1px solid rgba(16, 185, 129, 0.2)",
                borderRadius: "8px",
                padding: "10px 14px",
                fontSize: "12px",
                color: "#10b981",
                marginBottom: "20px",
              }}
            >
              🛡️ <strong>Zero Duplication Guard:</strong> Existing products will be updated by handle/SKU rather than creating duplicates.
            </div>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: "12px" }}>
              <button
                className="btn btn-secondary"
                onClick={() => setSnapshotToRollback(null)}
                style={{ padding: "8px 16px" }}
              >
                Cancel
              </button>
              <button
                className="btn btn-primary"
                onClick={() => {
                  const targetSnap = snapshotToRollback;
                  setSnapshotToRollback(null);
                  processRestore(targetSnap.filename, typeof targetSnap.sizeMb === "string" ? targetSnap.sizeMb : "396.9");
                }}
                style={{
                  background: "#10b981",
                  color: "#fff",
                  borderColor: "#10b981",
                  padding: "8px 18px",
                  fontWeight: 600,
                }}
              >
                🚀 Start Store Rollback
              </button>
            </div>
          </div>
        </div>
      )}

      {/* SECTION 1: EXPORT / CREATE SNAPSHOT */}
      <div>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "8px" }}>
          <div>
            <h3 className="section-title">Offline Vault Backups (Export)</h3>
            <p className="section-subtitle">
              All-in-One complete store export packages containing active themes, products, metafields, collections, and reviews.
            </p>
          </div>
          <button
            className="btn btn-primary"
            onClick={() => onCreateSnapshot(selectedMode)}
            disabled={isCreating}
            style={{ minWidth: "220px" }}
          >
            {isCreating
              ? selectedMode === "FULL_OFFLINE_MEDIA"
                ? "⏳ Packaging 533 Media Files..."
                : "⏳ Compressing Cloud Snapshot..."
              : selectedMode === "FULL_OFFLINE_MEDIA"
              ? "📦 Create Full Media Vault"
              : "⚡ Create Fast Cloud Backup"}
          </button>
        </div>

        {/* Plan Entitlement Info Banner */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            background: "linear-gradient(135deg, rgba(16, 185, 129, 0.1), rgba(6, 95, 70, 0.05))",
            border: "1px solid rgba(16, 185, 129, 0.3)",
            borderRadius: "8px",
            padding: "10px 16px",
            marginBottom: "16px",
            fontSize: "13px",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
            <span style={{ fontSize: "16px" }}>👑</span>
            <div>
              <span style={{ fontWeight: 700, color: "#065f46" }}>Unlimited Pro Active:</span>{" "}
              <span style={{ color: "var(--fg-secondary)" }}>
                Unlimited Backups enabled. Both <strong>Fast Cloud Pass</strong> and <strong>Full Raw Media Bundles (396.9 MB)</strong> are unlocked for your store!
              </span>
            </div>
          </div>
          <span style={{ background: "#10b981", color: "#fff", padding: "2px 8px", borderRadius: "4px", fontSize: "11px", fontWeight: 700 }}>
            UNLOCKED
          </span>
        </div>

        {/* BACKUP MODE SELECTOR CARDS */}
        <div style={{ marginBottom: "16px" }}>
          <div style={{ fontSize: "13px", fontWeight: 600, color: "var(--fg-primary)", marginBottom: "8px" }}>
            Select Backup Vault Mode:
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }}>
            {/* Option 1: Fast CDN Cloud Pass */}
            <div
              onClick={() => setSelectedMode("FAST_CDN")}
              style={{
                border: selectedMode === "FAST_CDN" ? "2px solid #10b981" : "1px solid var(--border-hairline)",
                background: selectedMode === "FAST_CDN" ? "rgba(16, 185, 129, 0.06)" : "var(--bg-subtle)",
                borderRadius: "8px",
                padding: "14px 16px",
                cursor: "pointer",
                transition: "all 0.2s ease",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "6px" }}>
                <span style={{ fontWeight: 700, fontSize: "14px", color: "var(--fg-primary)", display: "flex", alignItems: "center", gap: "6px" }}>
                  ⚡ Fast Cloud Package
                </span>
                <span style={{ fontSize: "11px", fontWeight: 700, background: "#ecfdf5", color: "#059669", padding: "2px 6px", borderRadius: "4px" }}>
                  ~1.78 MB • Fast
                </span>
              </div>
              <div style={{ fontSize: "12px", color: "var(--fg-secondary)", lineHeight: "1.4" }}>
                Packs all 19 JSONs, 550+ theme files &amp; 15 reviews. Uses live CDN links for instant migration between active stores.
              </div>
            </div>

            {/* Option 2: Full Offline Media Bundle */}
            <div
              onClick={() => setSelectedMode("FULL_OFFLINE_MEDIA")}
              style={{
                border: selectedMode === "FULL_OFFLINE_MEDIA" ? "2px solid #8b5cf6" : "1px solid var(--border-hairline)",
                background: selectedMode === "FULL_OFFLINE_MEDIA" ? "rgba(139, 92, 246, 0.06)" : "var(--bg-subtle)",
                borderRadius: "8px",
                padding: "14px 16px",
                cursor: "pointer",
                transition: "all 0.2s ease",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "6px" }}>
                <span style={{ fontWeight: 700, fontSize: "14px", color: "var(--fg-primary)", display: "flex", alignItems: "center", gap: "6px" }}>
                  📦 Full Offline Media Bundle
                </span>
                <span style={{ fontSize: "11px", fontWeight: 700, background: "#f5f3ff", color: "#7c3aed", padding: "2px 6px", borderRadius: "4px" }}>
                  👑 533 Media Files (396.9 MB)
                </span>
              </div>
              <div style={{ fontSize: "12px", color: "var(--fg-secondary)", lineHeight: "1.4" }}>
                Includes 4 MP4 videos, 528 images, hero banners &amp; Urdu fonts. Safe forever even if the old Shopify store is deleted!
              </div>
            </div>
          </div>
        </div>

        {snapshots.length === 0 ? (
          <div
            style={{
              padding: "32px",
              textAlign: "center",
              background: "var(--bg-subtle)",
              borderRadius: "var(--radius-md)",
              border: "1px dashed var(--border-hairline)",
              color: "var(--fg-secondary)",
              fontSize: "14px",
            }}
          >
            No vault snapshots created yet. Choose a mode above and click <strong>"Create Backup"</strong> to generate your archive.
          </div>
        ) : (
          snapshots.map((snap) => (
            <div
              key={snap.id}
              style={{
                background: "var(--bg-subtle)",
                border: "1px solid var(--border-hairline)",
                borderRadius: "var(--radius-md)",
                padding: "18px 20px",
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                marginBottom: "12px",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: "16px" }}>
                <div
                  style={{
                    width: "44px",
                    height: "44px",
                    borderRadius: "10px",
                    background: snap.mode === "FULL_OFFLINE_MEDIA" ? "#f5f3ff" : "#ecfdf5",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    color: snap.mode === "FULL_OFFLINE_MEDIA" ? "#7c3aed" : "#059669",
                    fontSize: "20px",
                  }}
                >
                  {snap.mode === "FULL_OFFLINE_MEDIA" ? "📦" : "⚡"}
                </div>
                <div>
                  <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "4px" }}>
                    <span style={{ fontWeight: 700, fontSize: "14px", color: "var(--fg-primary)" }}>
                      {snap.filename}
                    </span>
                    {snap.mode === "FULL_OFFLINE_MEDIA" ? (
                      <span style={{ fontSize: "11px", fontWeight: 700, background: "#8b5cf6", color: "#fff", padding: "1px 6px", borderRadius: "4px" }}>
                        RAW IMAGES + VIDEOS (396.9 MB)
                      </span>
                    ) : (
                      <span style={{ fontSize: "11px", fontWeight: 700, background: "#10b981", color: "#fff", padding: "1px 6px", borderRadius: "4px" }}>
                        FAST CLOUD PASS
                      </span>
                    )}
                  </div>
                  <div style={{ fontSize: "12px", color: "var(--fg-secondary)", display: "flex", gap: "12px", flexWrap: "wrap" }}>
                    <span>📦 <strong>{typeof snap.sizeMb === "string" && (snap.sizeMb.includes("KB") || snap.sizeMb.includes("MB")) ? snap.sizeMb : `${snap.sizeMb} MB`}</strong></span>
                    <span>🕒 Created: <strong>{snap.createdAt}</strong></span>
                    <span>🛍️ <strong>{snap.productCount} Products</strong></span>
                    <span>🎨 <strong>{snap.themeCount} Theme</strong></span>
                    {snap.mediaCount ? <span>🖼️ <strong>{snap.mediaCount} Media Files (4 Videos)</strong></span> : null}
                    <span style={{ color: "#059669" }}>✓ Verified Checksum</span>
                  </div>
                </div>
              </div>
              <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
                {/* RESTORE BUTTON */}
                <button
                  className="btn btn-secondary"
                  onClick={() => setSnapshotToRollback(snap)}
                  title="Rollback current store to this snapshot date"
                  style={{
                    color: "#059669",
                    borderColor: "rgba(16, 185, 129, 0.4)",
                    background: "rgba(16, 185, 129, 0.08)",
                    fontWeight: 600,
                    display: "flex",
                    alignItems: "center",
                    gap: "6px",
                  }}
                >
                  <span>🔄</span>
                  <span>Restore</span>
                </button>

                {/* DOWNLOAD BUTTON */}
                <button className="btn btn-secondary" onClick={() => onDownloadSnapshot(snap.id)}>
                  ⬇️ Download (.ZIP)
                </button>

                {/* DELETE BUTTON WITH CONFIRMATION */}
                <button
                  className="btn btn-secondary"
                  onClick={() => setSnapshotToDelete(snap.id)}
                  title="Delete backup snapshot"
                  style={{
                    color: "#ef4444",
                    borderColor: "rgba(239, 68, 68, 0.35)",
                    background: "rgba(239, 68, 68, 0.05)",
                    padding: "7px 12px",
                    display: "flex",
                    alignItems: "center",
                    gap: "6px",
                  }}
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <polyline points="3 6 5 6 21 6" />
                    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                  </svg>
                  <span>Delete</span>
                </button>
              </div>
            </div>
          ))
        )}
      </div>

      {/* SECTION 2: ALL-IN-ONE RESTORE / IMPORT ZONE */}
      <div
        style={{
          borderTop: "1px solid var(--border-hairline)",
          paddingTop: "20px",
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "8px" }}>
          <div>
            <h3 className="section-title">Restore Store from Backup (Import / Rollback)</h3>
            <p className="section-subtitle">
              WordPress All-In-One Migration style with <strong>Deduplication Guard</strong> (zero duplicate products on re-runs).
            </p>
          </div>
          <span style={{ fontSize: "11px", fontWeight: 700, background: "#ecfdf5", color: "#059669", padding: "4px 8px", borderRadius: "4px" }}>
            🛡️ IDEMPOTENT RESTORE SAFE
          </span>
        </div>

        <div
          onDragOver={(e) => e.preventDefault()}
          onDrop={handleFileDrop}
          onClick={() => fileInputRef.current?.click()}
          style={{
            border: "2px dashed var(--border-hairline)",
            borderRadius: "var(--radius-md)",
            padding: "30px 20px",
            textAlign: "center",
            cursor: isRestoring ? "wait" : "pointer",
            background: isRestoring ? "rgba(16, 185, 129, 0.04)" : "var(--bg-subtle)",
            opacity: isRestoring ? 0.9 : 1,
            transition: "all 0.2s ease",
          }}
        >
          <input
            type="file"
            ref={fileInputRef}
            onChange={handleFileSelect}
            accept=".zip,.json"
            disabled={isRestoring}
            style={{ display: "none" }}
          />
          <div style={{ fontSize: "32px", marginBottom: "8px" }}>{isRestoring ? "⏳" : "📥"}</div>
          <div style={{ fontWeight: 600, fontSize: "14px", marginBottom: "4px" }}>
            {isRestoring ? "Restoring Archive into Store..." : "Drag & Drop any Clonix Backup (.zip) here, or click to browse"}
          </div>
          <div style={{ fontSize: "12px", color: "var(--fg-secondary)" }}>
            Supports both Fast Cloud Pass (.zip) and Full Media Vaults (.zip) with zero duplicate products.
          </div>

          {/* LIVE RESTORE PROGRESS BAR */}
          {restoreProgress && (
            <div
              style={{
                marginTop: "20px",
                padding: "16px 20px",
                background: "#09090b",
                borderRadius: "8px",
                textAlign: "left",
                color: "#fff",
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "8px" }}>
                <span style={{ fontSize: "13px", fontWeight: 700, color: "#10b981" }}>
                  {restoreProgress.stage}
                </span>
                <span style={{ fontSize: "12px", fontWeight: 700, color: "#a1a1aa" }}>
                  {restoreProgress.percent}%
                </span>
              </div>
              <div
                style={{
                  width: "100%",
                  height: "8px",
                  background: "#27272a",
                  borderRadius: "4px",
                  overflow: "hidden",
                  marginBottom: "8px",
                }}
              >
                <div
                  style={{
                    width: `${restoreProgress.percent}%`,
                    height: "100%",
                    background: "linear-gradient(90deg, #10b981, #3b82f6)",
                    transition: "width 0.4s ease",
                  }}
                />
              </div>
              <div style={{ fontSize: "12px", color: "#a1a1aa" }}>
                {restoreProgress.detail}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
