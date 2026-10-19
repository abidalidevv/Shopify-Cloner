// clonix-app/src/components/PricingPlansCard.tsx
import React from "react";
import type { BillingPlan } from "../types/clonix";

interface PricingPlansCardProps {
  plans: BillingPlan[];
  currentPlanId?: string;
  onSelectPlan: (planId: string) => void;
}

export const PricingPlansCard: React.FC<PricingPlansCardProps> = ({
  plans,
  currentPlanId = "plan_unlimited_pro",
  onSelectPlan,
}) => {
  return (
    <div style={{ marginTop: "10px" }}>
      <div style={{ textAlign: "center", marginBottom: "24px" }}>
        <h2 className="section-title" style={{ fontSize: "24px" }}>
          Transparent &amp; Fair Pricing
        </h2>
        <p className="section-subtitle">
          No recurring trap for 1-time store duplications. Pick the plan that fits you.
        </p>
      </div>

      <div className="pricing-grid">
        {plans.map((plan) => {
          const isActive = plan.id === currentPlanId;
          return (
            <div
              key={plan.id}
              className={`price-card ${isActive ? "featured" : ""}`}
              style={
                isActive
                  ? {
                      borderColor: "#10b981",
                      boxShadow: "0 0 0 2px #10b981, 0 10px 25px rgba(16, 185, 129, 0.15)",
                    }
                  : {}
              }
            >
              {isActive ? (
                <span
                  className="featured-tag"
                  style={{
                    background: "#10b981",
                    color: "#ffffff",
                    fontWeight: 700,
                  }}
                >
                  ✓ CURRENT ACTIVE PLAN
                </span>
              ) : plan.featured ? (
                <span className="featured-tag">{plan.tag || "MOST POPULAR"}</span>
              ) : null}

              <div className="price-plan-name">{plan.name}</div>
              <div className="price-amount">
                ${plan.priceUsd}
                {plan.interval === "MONTHLY" && (
                  <span
                    style={{
                      fontSize: "16px",
                      fontFamily: "'Geist', sans-serif",
                      fontWeight: 400,
                      color: "var(--fg-secondary)",
                    }}
                  >
                    {" "}/ mo
                  </span>
                )}
              </div>
              <div className="price-sub">{plan.description}</div>

              <ul className="price-features">
                {plan.features.map((feat, idx) => (
                  <li key={idx}>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#008060" strokeWidth="2.5">
                      <polyline points="20 6 9 17 4 12"></polyline>
                    </svg>
                    <span>{feat}</span>
                  </li>
                ))}
              </ul>

              <button
                className={`btn ${
                  isActive
                    ? "btn-lime"
                    : plan.featured
                    ? "btn-lime"
                    : plan.priceUsd === 0
                    ? "btn-secondary"
                    : "btn-primary"
                }`}
                onClick={() => onSelectPlan(plan.id)}
                style={isActive ? { background: "#10b981", color: "#fff", cursor: "default" } : {}}
              >
                {isActive
                  ? "✓ Active Plan (Unlocked)"
                  : plan.priceUsd === 0
                  ? "Switch to Free Tier"
                  : plan.interval === "MONTHLY"
                  ? "Start Unlimited ($49/mo)"
                  : "Get Single Pass ($9)"}
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
};
