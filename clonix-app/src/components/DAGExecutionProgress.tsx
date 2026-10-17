// clonix-app/src/components/DAGExecutionProgress.tsx
import React from "react";
import type { DAGStage } from "../types/clonix";

interface DAGExecutionProgressProps {
  currentStage: number;
  percentage: number;
  stages: DAGStage[];
  status: string;
}

export const DAGExecutionProgress: React.FC<DAGExecutionProgressProps> = ({
  currentStage,
  percentage,
  stages,
  status,
}) => {
  const getStageTintClass = (stage: DAGStage) => {
    if (stage.status === "RUNNING") return "running";
    if (stage.stage <= 1) return "tint-emerald";
    if (stage.stage <= 5) return "tint-sky";
    if (stage.stage <= 10) return "tint-lavender";
    return "tint-amber";
  };

  return (
    <div className="workspace-card">
      <div className="progress-header">
        <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
          <h3 className="section-title" style={{ margin: 0 }}>
            14-Stage DAG Barrier Execution
          </h3>
          <span className="badge-pill success">
            {status === "COMPLETED" ? "All 14 Stages Complete ✅" : `Stage ${currentStage}/14 Active`}
          </span>
        </div>
        <div style={{ fontFamily: "'Anton', sans-serif", fontSize: "18px", color: "var(--p-green)" }}>
          {percentage}% COMPLETED
        </div>
      </div>

      <div className="progress-bar-track">
        <div className="progress-bar-fill" style={{ width: `${percentage}%` }}></div>
      </div>

      <div className="stages-grid">
        {stages.map((st) => (
          <div key={st.stage} className={`stage-item ${getStageTintClass(st)}`}>
            <div>
              <div className="stage-title">
                Stage {st.stage}: {st.name}
              </div>
              <div className="stage-sub">{st.detail}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};
