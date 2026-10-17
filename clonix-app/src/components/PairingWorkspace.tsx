// clonix-app/src/components/PairingWorkspace.tsx
import React, { useState } from "react";
import type { StoreRole } from "../types/clonix";

interface PairingWorkspaceProps {
  currentRole: StoreRole;
  pairingCode: string;
  onCopyCode: () => void;
  onRegenerateCode: () => void;
  onAuthorizeClone: (enteredCode: string) => void;
  isLoading?: boolean;
}

export const PairingWorkspace: React.FC<PairingWorkspaceProps> = ({
  currentRole,
  pairingCode,
  onCopyCode,
  onRegenerateCode,
  onAuthorizeClone,
  isLoading = false,
}) => {
  const [destCodeInput, setDestCodeInput] = useState("");
  const [copiedNotification, setCopiedNotification] = useState(false);

  const handleCopy = () => {
    onCopyCode();
    setCopiedNotification(true);
    setTimeout(() => setCopiedNotification(false), 2000);
  };

  const handleAuthorize = () => {
    if (!destCodeInput.trim()) {
      alert("Please enter the 8-character pairing code from the source store.");
      return;
    }
    onAuthorizeClone(destCodeInput.trim().toUpperCase());
  };

  if (currentRole === "SOURCE") {
    return (
      <div className="workspace-card">
        <h3 className="section-title">Source Handshake Code</h3>
        <p className="section-subtitle">
          Provide this 8-character code to your destination store to authorize direct transfer.
        </p>

        <div className="code-box">
          <div className="code-label">Consent Pairing Code</div>
          <div className="code-string">{pairingCode}</div>
          <div className="code-meta">
            <span>🔒 Crockford Base32</span>
            <span>⚡ 15-Minute Expiry</span>
            <span>🛡️ 2-Sided Consent Required</span>
          </div>
        </div>

        <div style={{ display: "flex", gap: "10px", alignItems: "center" }}>
          <button className="btn btn-lime" onClick={handleCopy}>
            {copiedNotification ? "Copied to Clipboard! ✓" : "Copy Code to Clipboard"}
          </button>
          <button className="btn btn-secondary" onClick={onRegenerateCode}>
            Regenerate Code
          </button>
        </div>
      </div>
    );
  }

  // DESTINATION ROLE
  return (
    <div className="workspace-card">
      <h3 className="section-title">Connect to Source Store</h3>
      <p className="section-subtitle">
        Enter the 8-character pairing code from the source store to initiate transfer.
      </p>

      <div style={{ maxWidth: "460px", margin: "18px 0" }}>
        <label style={{ display: "block", fontSize: "13px", fontWeight: 600, marginBottom: "6px" }}>
          Pairing Code
        </label>
        <div style={{ display: "flex", gap: "10px" }}>
          <input
            type="text"
            className="input-field"
            placeholder="e.g. 7K9M-2PX4"
            maxLength={9}
            value={destCodeInput}
            onChange={(e) => setDestCodeInput(e.target.value.toUpperCase())}
            style={{
              fontFamily: "'JetBrains Mono', monospace",
              fontSize: "16px",
              fontWeight: 700,
              letterSpacing: "0.08em",
            }}
          />
          <button
            className="btn btn-primary"
            onClick={handleAuthorize}
            disabled={isLoading}
            style={{ minWidth: "150px" }}
          >
            {isLoading ? "Validating..." : "Authorize &amp; Clone"}
          </button>
        </div>
      </div>

      <div style={{ fontSize: "12.5px", color: "var(--fg-secondary)" }}>
        💡 <strong>Zero-Risk Guarantee:</strong> Preflight verifier checks templates, currencies, and metafields before writing any data.
      </div>
    </div>
  );
};
