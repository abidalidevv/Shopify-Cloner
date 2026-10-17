// clonix-app/src/components/RoleSelector.tsx
import React from "react";
import type { StoreRole } from "../types/clonix";

interface RoleSelectorProps {
  selectedRole: StoreRole;
  onSelectRole: (role: StoreRole) => void;
}

export const RoleSelector: React.FC<RoleSelectorProps> = ({ selectedRole, onSelectRole }) => {
  return (
    <div style={{ marginBottom: "20px" }}>
      <h2 className="section-title">Select Store Role</h2>
      <p className="section-subtitle">Choose whether this current store is sending data or receiving data.</p>

      <div className="role-grid">
        {/* Source Store Card */}
        <div
          className={`role-card ${selectedRole === "SOURCE" ? "selected" : ""}`}
          onClick={() => onSelectRole("SOURCE")}
        >
          <div className="role-radio-wrap">
            <span className="role-badge green">Origin</span>
            <div className="role-radio-circle"></div>
          </div>

          <div className="role-icon-box source">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
              <polyline points="17 8 12 3 7 8"></polyline>
              <line x1="12" y1="3" x2="12" y2="15"></line>
            </svg>
          </div>

          <div className="role-name">Source Store (Export &amp; Send)</div>
          <p className="role-desc">Export catalog, liquid themes, and settings to another store or save an encrypted offline vault.</p>

          <ul className="role-features">
            <li>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#008060" strokeWidth="2.5">
                <polyline points="20 6 9 17 4 12"></polyline>
              </svg>
              <span><strong>100% Free ($0)</strong> for Source Store</span>
            </li>
            <li>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#008060" strokeWidth="2.5">
                <polyline points="20 6 9 17 4 12"></polyline>
              </svg>
              <span>Generates secure Crockford Pairing Key</span>
            </li>
          </ul>
        </div>

        {/* Destination Store Card */}
        <div
          className={`role-card ${selectedRole === "DESTINATION" ? "selected" : ""}`}
          onClick={() => onSelectRole("DESTINATION")}
        >
          <div className="role-radio-wrap">
            <span className="role-badge purple">Target</span>
            <div className="role-radio-circle"></div>
          </div>

          <div className="role-icon-box dest">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
              <polyline points="7 10 12 15 17 10"></polyline>
              <line x1="12" y1="15" x2="12" y2="3"></line>
            </svg>
          </div>

          <div className="role-name">Destination Store (Import &amp; Replicate)</div>
          <p className="role-desc">Receive cloned products, variants, collections, templates, and metafields with Zero-Leak CDN guarantee.</p>

          <ul className="role-features">
            <li>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#6d28d9" strokeWidth="2.5">
                <polyline points="20 6 9 17 4 12"></polyline>
              </svg>
              <span>Preserves custom template suffixes (<code>newmedda</code>)</span>
            </li>
            <li>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#6d28d9" strokeWidth="2.5">
                <polyline points="20 6 9 17 4 12"></polyline>
              </svg>
              <span>Dynamic rewrite to Destination CDN</span>
            </li>
          </ul>
        </div>
      </div>
    </div>
  );
};
