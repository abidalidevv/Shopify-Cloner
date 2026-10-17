// clonix-app/src/components/ParityScoreTable.tsx
import React from "react";
import type { ParityItem } from "../types/clonix";

interface ParityScoreTableProps {
  items: ParityItem[];
}

export const ParityScoreTable: React.FC<ParityScoreTableProps> = ({ items }) => {
  return (
    <div className="workspace-card">
      <h3 className="section-title">Live Parity &amp; Zero-404 Score Card</h3>
      <p className="section-subtitle">
        Real-time side-by-side audit comparing source and destination store assets.
      </p>

      <table className="parity-table">
        <thead>
          <tr>
            <th>Store Asset</th>
            <th>Source Count</th>
            <th>Destination Status</th>
            <th>Parity Result</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item, idx) => (
            <tr key={idx}>
              <td>
                <strong>{item.asset}</strong>
              </td>
              <td>{item.sourceCount}</td>
              <td>{item.destStatus}</td>
              <td>
                <span className="badge-pill success">✅ {item.parityCheck}</span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};
