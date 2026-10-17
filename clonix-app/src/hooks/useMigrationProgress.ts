// clonix-app/src/hooks/useMigrationProgress.ts
import { useState, useCallback } from "react";
import type { MigrationRun, DAGStage } from "../types/clonix";

const INITIAL_STAGES: DAGStage[] = [
  { stage: 0, name: "Preflight & Probe", status: "COMPLETED", processedItems: 1, totalItems: 1, detail: "Currency, theme probed" },
  { stage: 1, name: "Locations & Markets", status: "COMPLETED", processedItems: 1, totalItems: 1, detail: "Primary location mapped" },
  { stage: 2, name: "Files & Media Ingestion", status: "COMPLETED", processedItems: 523, totalItems: 523, detail: "523 images to dest CDN" },
  { stage: 3, name: "Definitions & Metaobjects", status: "COMPLETED", processedItems: 12, totalItems: 12, detail: "Schema definitions synced" },
  { stage: 4, name: "Metaobject Entries", status: "COMPLETED", processedItems: 34, totalItems: 34, detail: "Cross-references patched" },
  { stage: 5, name: "Products & Variants", status: "COMPLETED", processedItems: 7, totalItems: 7, detail: "Urdu titles, SKUs, weights" },
  { stage: 6, name: "Inventory Tracking", status: "COMPLETED", processedItems: 7, totalItems: 7, detail: "Stock levels (97-99) tracked" },
  { stage: 7, name: "Collections & Rules", status: "COMPLETED", processedItems: 7, totalItems: 7, detail: "Smart collections synced" },
  { stage: 8, name: "Pages, Blogs & Articles", status: "COMPLETED", processedItems: 11, totalItems: 11, detail: "Pages & legal policies" },
  { stage: 9, name: "Menus & Navigation", status: "COMPLETED", processedItems: 2, totalItems: 2, detail: "Header/Footer menus synced" },
  { stage: 10, name: "Price Lists & Translations", status: "COMPLETED", processedItems: 1, totalItems: 1, detail: "Pricing structure verified" },
  { stage: 11, name: "Theme & Liquid Schemas", status: "RUNNING", processedItems: 42, totalItems: 48, detail: "Rewriting {% schema %} CDN..." },
  { stage: 12, name: "URL Redirects", status: "PENDING", processedItems: 0, totalItems: 5, detail: "Awaiting stage 11 barrier" },
  { stage: 13, name: "Storefront Verification", status: "PENDING", processedItems: 0, totalItems: 10, detail: "Live HTTP 200 crawl" },
];

export function useMigrationProgress(initialRunId?: string) {
  const [run, setRun] = useState<MigrationRun>(() => ({
    runId: initialRunId || `run_${Date.now()}`,
    sourceShop: "ph0igg-jv.myshopify.com",
    destShop: "tibbeshifa-clone.myshopify.com",
    status: "RUNNING",
    currentStage: 11,
    percentage: 78,
    stages: INITIAL_STAGES,
    startedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }));

  const [isSimulating, setIsSimulating] = useState(false);

  const startMigrationSimulation = useCallback(() => {
    setIsSimulating(true);
    let pct = 20;

    const interval = setInterval(() => {
      pct += 12;
      if (pct >= 100) {
        pct = 100;
        clearInterval(interval);
        setIsSimulating(false);
        setRun((prev) => ({
          ...prev,
          percentage: 100,
          currentStage: 13,
          status: "COMPLETED",
          stages: prev.stages.map((st) => ({
            ...st,
            status: "COMPLETED",
            processedItems: st.totalItems,
          })),
        }));
      } else {
        const stageNum = Math.min(13, Math.floor(pct / 7.5));
        setRun((prev) => ({
          ...prev,
          percentage: pct,
          currentStage: stageNum,
          stages: prev.stages.map((st) => ({
            ...st,
            status: st.stage < stageNum ? "COMPLETED" : st.stage === stageNum ? "RUNNING" : "PENDING",
            processedItems: st.stage < stageNum ? st.totalItems : Math.floor(st.totalItems * 0.7),
          })),
        }));
      }
    }, 450);
  }, []);

  return {
    run,
    isSimulating,
    startMigrationSimulation,
  };
}
