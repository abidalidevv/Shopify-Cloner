// prisma-types.d.ts — Ambient types for Prisma client models when prisma generate is offline.

declare module "@prisma/client" {
  export namespace Prisma {
    export type TransactionClient = any;
    export type CloneTaskCreateManyInput = {
      runId: string;
      stage: number;
      resourceType: ResourceType;
      shardKey: string;
      status?: string;
      inputKey?: string;
      itemsTotal?: number;
    };
  }

  export enum ResourceType {
    SYSTEM = "SYSTEM",
    SHOP = "SHOP",
    LOCATION = "LOCATION",
    PUBLICATION = "PUBLICATION",
    MARKET = "MARKET",
    TAXONOMY = "TAXONOMY",
    FILE = "FILE",
    METAOBJECT_DEF = "METAOBJECT_DEF",
    METAOBJECT_DEFINITION = "METAOBJECT_DEFINITION",
    METAFIELD_DEFINITION = "METAFIELD_DEFINITION",
    METAOBJECT_ENTRY = "METAOBJECT_ENTRY",
    METAOBJECT = "METAOBJECT",
    PRODUCT = "PRODUCT",
    INVENTORY = "INVENTORY",
    COLLECTION = "COLLECTION",
    PAGE = "PAGE",
    BLOG = "BLOG",
    ARTICLE = "ARTICLE",
    MENU = "MENU",
    CATALOG = "CATALOG",
    PRICE_LIST = "PRICE_LIST",
    TRANSLATION = "TRANSLATION",
    THEME = "THEME",
    POLICY = "POLICY",
    REDIRECT = "REDIRECT",
  }

  export interface CloneRun {
    id: string;
    mode: "DIRECT" | "FROM_SNAPSHOT";
    pairId: string | null;
    destShopId: string;
    status: "PREFLIGHT" | "AWAITING_CONFIRM" | "QUEUED" | "RUNNING" | "PAUSED" | "SUCCEEDED" | "FAILED" | "CANCELLED";
    stage: number;
    currentStage: number;
    pass: string;
    stageAttempts: number;
    snapshotId: string | null;
    selectedResources: ResourceType[];
    createdByUserId: string | null;
    entitlementId: string | null;
    startedAt: Date | null;
    finishedAt: Date | null;
    cancelledAt: Date | null;
    pauseReason: string | null;
    createdAt: Date;
    updatedAt: Date;
  }

  export interface CloneTask {
    id: string;
    runId: string;
    stage: number;
    resourceType: ResourceType;
    shardKey: string;
    status: "PENDING" | "RUNNING" | "SUCCEEDED" | "FAILED" | "SKIPPED";
    attempts: number;
    maxAttempts: number;
    workerId: string | null;
    cursor: string | null;
    inputKey: string | null;
    itemsTotal: number;
    itemsDone: number;
    itemsOk: number;
    itemsFailed: number;
    lastError: any;
    startedAt: Date | null;
    leaseUntil: Date | null;
    finishedAt: Date | null;
    availableAt: Date;
    createdAt: Date;
    updatedAt: Date;
  }

  export class PrismaClient {
    $transaction<T>(arg: ((tx: any) => Promise<T>) | any[], options?: any): Promise<T>;
    $queryRaw<T = any>(query: TemplateStringsArray, ...values: any[]): Promise<T>;
    $executeRaw(query: TemplateStringsArray, ...values: any[]): Promise<number>;
    shop: any;
    storePair: any;
    cloneRun: any;
    cloneTask: any;
    snapshotObject: any;
    idMap: any;
    itemFailure: any;
    freeUsage: any;
    agencyGrant: any;
    agencyToken: any;
    entitlement: any;
    auditLog: any;
  }
}
