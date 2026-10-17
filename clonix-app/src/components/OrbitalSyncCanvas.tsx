// clonix-app/src/components/OrbitalSyncCanvas.tsx
import React from "react";

interface OrbitalSyncCanvasProps {
  sourceShop: string;
  destShop: string;
  activeStageName: string;
  activeStageNumber: number;
  totalStages?: number;
}

export const OrbitalSyncCanvas: React.FC<OrbitalSyncCanvasProps> = ({
  sourceShop,
  destShop,
  activeStageName,
  activeStageNumber,
  totalStages = 14,
}) => {
  return (
    <div className="orbital-sync-card">
      <div className="orbital-header">
        <div>
          <div className="orbital-title">Direct Cloud Synchronization Stream</div>
          <div className="orbital-subtitle">
            Zero-Leak CDN remapping • Template suffix preservation • 2-sided Crockford handshake
          </div>
        </div>
        <div className="orbital-stage-pill">
          STAGE {activeStageNumber}/{totalStages} ACTIVE: {activeStageName}
        </div>
      </div>

      <div className="orbital-canvas">
        {/* Source Store Node */}
        <div className="orbital-node">
          <div className="node-box">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#d4ff00" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M6 2L3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z"></path>
              <line x1="3" y1="6" x2="21" y2="6"></line>
              <path d="M16 10a4 4 0 0 1-8 0"></path>
            </svg>
          </div>
          <span className="node-label">Source Store</span>
          <span className="node-sub">{sourceShop}</span>
        </div>

        {/* Center Migration Engine Node */}
        <div className="orbital-node">
          <div className="node-box center-core">
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#d4ff00" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67"/>
            </svg>
          </div>
          <span className="node-label" style={{ color: "var(--brand-lime)" }}>Clonix DAG Core</span>
          <span className="node-sub" style={{ color: "#d4ff00" }}>{totalStages} Barrier Passes</span>
        </div>

        {/* Destination Store Node */}
        <div className="orbital-node">
          <div className="node-box">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#22c55e" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="2" y="3" width="20" height="14" rx="2" ry="2"></rect>
              <line x1="8" y1="21" x2="16" y2="21"></line>
              <line x1="12" y1="17" x2="12" y2="21"></line>
            </svg>
          </div>
          <span className="node-label">Destination Store</span>
          <span className="node-sub">{destShop || "Awaiting Pair"}</span>
        </div>

        {/* Animated Connecting SVG Data Rays */}
        <svg className="orbital-svg-layer" viewBox="0 0 1000 110" preserveAspectRatio="none">
          <path d="M 120 55 L 470 55" stroke="rgba(255, 255, 255, 0.15)" strokeWidth="2" strokeDasharray="6 6" />
          <circle r="4" fill="#d4ff00">
            <animateMotion dur="1.8s" repeatCount="indefinite" path="M 120 55 L 470 55" />
            <animate attributeName="opacity" dur="1.8s" repeatCount="indefinite" values="0;1;1;0" />
          </circle>

          <path d="M 530 55 L 880 55" stroke="rgba(255, 255, 255, 0.15)" strokeWidth="2" strokeDasharray="6 6" />
          <circle r="4" fill="#22c55e">
            <animateMotion dur="1.8s" repeatCount="indefinite" path="M 530 55 L 880 55" />
            <animate attributeName="opacity" dur="1.8s" repeatCount="indefinite" values="0;1;1;0" />
          </circle>
        </svg>
      </div>
    </div>
  );
};
