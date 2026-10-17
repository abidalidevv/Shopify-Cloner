// clonix-app/src/types/clonix.ts
// Type definitions for Clonix Shopify Store Cloner & Automated Vault

export type StoreRole = "SOURCE" | "DESTINATION";

export type ActiveTab = "cloner" | "vault" | "pricing" | "audit";

export interface PairingSession {
  code: string;
  sourceShop: string;
  destShop?: string;
  status: "PENDING_CLAIM" | "PENDING_APPROVAL" | "ACTIVE" | "EXPIRED" | "REVOKED";
  createdAt: string;
  expiresAt: string;
  secondsRemaining: number;
}

export interface DAGStage {
  stage: number;
  name: string;
  status: "PENDING" | "RUNNING" | "COMPLETED" | "FAILED";
  processedItems: number;
  totalItems: number;
  detail: string;
}

export interface MigrationRun {
  runId: string;
  sourceShop: string;
  destShop: string;
  status: "PREFLIGHT" | "AWAITING_CONFIRM" | "RUNNING" | "COMPLETED" | "PAUSED" | "FAILED";
  currentStage: number;
  percentage: number;
  stages: DAGStage[];
  startedAt: string;
  updatedAt: string;
}

export interface ParityItem {
  asset: string;
  sourceCount: string | number;
  destStatus: string;
  parityCheck: "MATCH" | "PRESERVED" | "SYNCED" | "ZERO_LEAK" | "MISMATCH";
  notes: string;
}

export interface VaultSnapshot {
  id: string;
  filename: string;
  sizeMb: number;
  createdAt: string;
  productCount: number;
  themeCount: number;
  hasMetafields: boolean;
}

export interface BillingPlan {
  id: string;
  name: string;
  priceUsd: number;
  interval: "ONE_TIME" | "MONTHLY";
  featured?: boolean;
  tag?: string;
  description: string;
  features: string[];
}
