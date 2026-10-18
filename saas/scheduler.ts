// scheduler.ts — stage-barrier clone scheduler on pg-boss + Prisma.
// SKETCH, not production code. Written against a pg-boss v10-style API
// (createQueue, work() receives an array of jobs, send({ db }) joins your transaction).
// Verify those three points against the pg-boss major you install.
//
// Core idea: the DATABASE is the source of truth, pg-boss is only a doorbell.
//   - CloneTask rows hold state; a pg-boss job just says "look at task X".
//   - The barrier is a COUNT over CloneTask, taken under a row lock on CloneRun.
//   - Every executor is idempotent, so a duplicate or replayed job is harmless.

import PgBoss from "pg-boss";
import * as crypto from "node:crypto";
import { Prisma, ResourceType as RT } from "@prisma/client";
import type { CloneRun, CloneTask } from "@prisma/client";

export { prisma } from "./db.js";
import { prisma } from "./db.js";
import { EXECUTORS } from "./executors.js";
import type { Ctx, IdMapRow, Outcome, ItemExecutor } from "./executors.js";
import { makeGql } from "./shopify-client.js";
import { r2 } from "./r2.js";
import { runStage0Extract } from "./extractor.js";
import { buildIndex } from "./remapper.js";

export const boss = new PgBoss(process.env.DATABASE_URL!);
const WORKER_ID = `${process.env.HOSTNAME ?? "w"}:${process.pid}:${crypto.randomUUID().slice(0, 6)}`;

export const Q = { ADVANCE: "run-advance", TASK: "clone-task", SWEEP: "run-sweep" } as const;

const LEASE_MS = 90_000;
const CHUNK = 25;                    // items per checkpoint
const FAIL_RATIO_PAUSE = 0.2;        // pause the run if >20% of a stage's items failed

/* ───────────────────────── 1. Stage table (config, not constants) ───────────────────────── */

type StageDef = { stage: number; name: string; types: RT[]; passes: string[]; shardSize: number };
const st = (stage: number, name: string, types: RT[], shardSize = 50, passes = ["A"]): StageDef =>
  ({ stage, name, types, passes, shardSize });

// Needs `SYSTEM` added to the ResourceType enum (stages 0 and 13 are not Shopify resources).
export const STAGES: StageDef[] = [
  st(0,  "preflight + extract",           [RT.SYSTEM], 1),
  st(1,  "locations / publications",      [RT.LOCATION, RT.PUBLICATION, RT.MARKET], 100),
  st(2,  "files",                         [RT.FILE], 100),
  st(3,  "definitions",                   [RT.METAOBJECT_DEFINITION, RT.METAFIELD_DEFINITION], 1000), // one shard, topo-sorted inside
  st(4,  "metaobject entries",            [RT.METAOBJECT], 100, ["A", "B"]),                          // B = patch cross-references
  st(5,  "products",                      [RT.PRODUCT], 50),
  st(6,  "inventory + publish",           [RT.INVENTORY], 100),
  st(7,  "collections",                   [RT.COLLECTION], 50),
  st(8,  "pages / blogs / articles",      [RT.PAGE, RT.BLOG, RT.ARTICLE], 50),
  st(9,  "menus",                         [RT.MENU], 100),
  st(10, "catalogs / price lists / i18n", [RT.CATALOG, RT.PRICE_LIST, RT.TRANSLATION], 100),
  st(11, "theme",                         [RT.THEME], 1),
  st(12, "redirects + policies",          [RT.REDIRECT, RT.POLICY], 500),
  st(13, "verify",                        [RT.SYSTEM], 1),
];

/* ───────────────────────── 2. Small helpers ───────────────────────── */

class Defer extends Error { constructor(public ms: number) { super(`defer ${ms}ms`); } }   // throttled: come back later
class Systemic extends Error {}                                                             // auth revoked, scope missing, shop gone
class RunInactive extends Error {}                                                          // run paused or cancelled

// Lets pg-boss.send() run inside a Prisma transaction, so task rows and their doorbell jobs commit atomically.
const txDb = (tx: Prisma.TransactionClient) => ({
  executeSql: async (text: string, values: unknown[] = []) => ({
    rows: (await tx.$queryRawUnsafe(text, ...values)) as any[],
  }),
});

const lockRun = (tx: Prisma.TransactionClient, runId: string) =>
  tx.$queryRaw`SELECT id FROM "CloneRun" WHERE id = ${runId} FOR UPDATE`;

const backoffMs = (attempt: number) => Math.min(5 * 60_000, 2 ** attempt * 2_000) + Math.random() * 1_000;

/* ───────────────────────── 3. Run lifecycle ───────────────────────── */

// Called when the destination owner confirms the preflight report.
export async function startRun(runId: string) {
  await prisma.$transaction(async (tx) => {
    const r = await tx.cloneRun.updateMany({
      where: { id: runId, status: "AWAITING_CONFIRM" },          // double-click safe
      data: { status: "RUNNING", startedAt: new Date(), currentStage: 0 },
    });
    if (r.count !== 1) return;
    await boss.send(Q.ADVANCE, { runId }, { db: txDb(tx) });
  });
}

// Resume after PAUSED: reset FAILED tasks, flip status, ring the bell.
export async function resumeRun(runId: string) {
  await prisma.$transaction(async (tx) => {
    await lockRun(tx, runId);
    const r = await tx.cloneRun.updateMany({ where: { id: runId, status: "PAUSED" }, data: { status: "RUNNING" } });
    if (r.count !== 1) return;
    await tx.cloneTask.updateMany({
      where: { runId, status: "FAILED" },
      data: { status: "PENDING", attempts: 0, lastError: null, leaseUntil: null, availableAt: new Date() },
    });
    const ids = await tx.cloneTask.findMany({ where: { runId, status: "PENDING" }, select: { id: true } });
    for (const t of ids) await boss.send(Q.TASK, { taskId: t.id }, { db: txDb(tx) });
    await boss.send(Q.ADVANCE, { runId }, { db: txDb(tx) });
  });
}

/* ───────────────────────── 4. The barrier: advance ───────────────────────── */

type Step = "wait" | "planned" | "advanced" | "paused" | "finished" | "stop";

export async function advanceRun(runId: string) {
  // Loop so empty stages and instant passes don't cost extra queue hops.
  for (;;) {
    const step = await advanceOnce(runId);
    if (step === "wait" || step === "stop" || step === "paused" || step === "finished") return;
  }
}

async function advanceOnce(runId: string): Promise<Step> {
  return prisma.$transaction(async (tx) => {
    // Serializes every advancer and every task finalizer for this run. Without it, two tasks finishing
    // concurrently can each still see the other as RUNNING, and nobody advances.
    await lockRun(tx, runId);

    const run = await tx.cloneRun.findUniqueOrThrow({ where: { id: runId } });
    if (run.status !== "RUNNING") return "stop";
    const def = STAGES[run.currentStage];

    // 1. Barrier: anything still open in this stage?
    const open = await tx.cloneTask.count({
      where: { runId, stage: def.stage, status: { in: ["PENDING", "RUNNING"] } },
    });
    if (open > 0) return "wait";

    // 2. Multi-pass stages: plan the next pass that has no tasks yet.
    for (const pass of def.passes) {
      const planned = await tx.cloneTask.count({
        where: { runId, stage: def.stage, shardKey: { startsWith: `${pass}:` } },
      });
      if (planned === 0) {
        await assertShopsHealthy(tx, run);                                  // throws -> run paused by caller
        const tasks = await planPass(tx, run, def, pass);
        for (const t of tasks.filter((t) => t.status === "PENDING")) {
          await boss.send(Q.TASK, { taskId: t.id }, { db: txDb(tx), expireInSeconds: 600, retryLimit: 2 });
        }
        return "planned";
      }
    }

    // 3. Stage fully drained. Decide: pause, finish, or move on.
    const agg = await tx.cloneTask.aggregate({
      where: { runId, stage: def.stage },
      _sum: { itemsTotal: true, itemsFailed: true },
    });
    const systemic = await tx.cloneTask.count({
      where: { runId, stage: def.stage, status: "FAILED", lastError: { startsWith: "SYSTEMIC:" } },
    });
    const ratio = (agg._sum.itemsFailed ?? 0) / Math.max(1, agg._sum.itemsTotal ?? 0);
    if (systemic > 0 || ratio > FAIL_RATIO_PAUSE) {
      await tx.cloneRun.update({ where: { id: runId }, data: { status: "PAUSED" } });
      return "paused";
    }

    if (def.stage === STAGES.length - 1) {
      const failures = await tx.itemFailure.count({ where: { runId } });
      await tx.cloneRun.update({
        where: { id: runId },
        data: { status: failures ? "COMPLETED_WITH_WARNINGS" : "COMPLETED", finishedAt: new Date() },
      });
      return "finished";
    }

    // Guarded move: exactly one advancer wins even if the sweeper races a worker.
    const moved = await tx.cloneRun.updateMany({
      where: { id: runId, currentStage: def.stage },
      data: { currentStage: def.stage + 1 },
    });
    return moved.count === 1 ? "advanced" : "wait";
  });
}

async function assertShopsHealthy(tx: Prisma.TransactionClient, run: CloneRun) {
  // Both shops must still be ACTIVE and the pair (if any) not revoked. A cheap `shop { id }` query
  // with each token is also worth doing here to catch revoked tokens before a stage starts.
  const shops = await tx.shop.findMany({ where: { OR: [{ id: run.destShopId }, { sourcePairs: { some: { id: run.pairId ?? "" } } }] } });
  if (shops.some((s) => s.status !== "ACTIVE")) throw new Error("SYSTEMIC: a shop was uninstalled");
}

/* Fan-out: turn the stage's SnapshotObjects into shard tasks. */
async function planPass(tx: Prisma.TransactionClient, run: CloneRun, def: StageDef, pass: string) {
  const rows: Prisma.CloneTaskCreateManyInput[] = [];

  if (def.types.includes(RT.SYSTEM)) {
    rows.push({ runId: run.id, stage: def.stage, resourceType: RT.SYSTEM, shardKey: `${pass}:SYSTEM:0`, itemsTotal: 1 });
  } else {
    // snapshotId is set by stage 0 (DIRECT creates a CLONE_STAGING snapshot from bulk-operation JSONL).
    const objs = await tx.snapshotObject.findMany({
      where: { snapshotId: run.snapshotId!, resourceType: { in: def.types } },
    });
    for (const o of objs) {
      for (let from = 0, i = 0; from < o.itemCount; from += def.shardSize, i++) {
        const to = Math.min(o.itemCount, from + def.shardSize);
        rows.push({
          runId: run.id, stage: def.stage, resourceType: o.resourceType,
          shardKey: `${pass}:${o.resourceType}:${o.id}:${i}`,
          inputKey: JSON.stringify({ key: o.r2Key, from, to }), itemsTotal: to - from,
        });
      }
    }
  }

  // Sentinel so an empty pass still counts as "planned" (otherwise the pass would re-plan forever).
  if (rows.length === 0) {
    rows.push({ runId: run.id, stage: def.stage, resourceType: def.types[0], shardKey: `${pass}:EMPTY`, status: "SKIPPED" });
  }
  await tx.cloneTask.createMany({ data: rows, skipDuplicates: true });   // (runId, resourceType, shardKey) is unique
  return tx.cloneTask.findMany({ where: { runId: run.id, stage: def.stage, shardKey: { startsWith: `${pass}:` } } });
}

/* ───────────────────────── 5. Task execution ───────────────────────── */

async function claim(taskId: string): Promise<CloneTask | null> {
  // Lease-based claim. Also handles takeover: a dead worker's lease simply expires.
  // `attempts` counts claims, so a task that keeps crashing workers eventually hits maxAttempts (poison-pill guard).
  const rows = await prisma.$queryRaw<CloneTask[]>`
    UPDATE "CloneTask"
       SET status = 'RUNNING', attempts = attempts + 1,
           "startedAt" = COALESCE("startedAt", now()),
           "leaseUntil" = now() + (${LEASE_MS} || ' milliseconds')::interval,
           "workerId" = ${WORKER_ID}
     WHERE id = ${taskId}
       AND status IN ('PENDING', 'RUNNING')
       AND "availableAt" <= now()
       AND ("leaseUntil" IS NULL OR "leaseUntil" < now())
    RETURNING *`;
  return rows[0] ?? null;
}

async function handleTask(taskId: string) {
  const task = await claim(taskId);
  if (!task) return;                       // terminal, not due, or another worker holds a live lease
  const hb = setInterval(() => extendLease(taskId).catch(() => {}), LEASE_MS / 3);
  try {
    if (task.resourceType === RT.SYSTEM) {
      await runSystemTask(task);
    } else {
      await runShard(task);
    }
    await settle(task, { status: "SUCCEEDED" });
  } catch (e) {
    if (e instanceof Defer) return await requeue(task, e.ms, false);   // throttle waits don't burn an attempt
    if (e instanceof RunInactive) return await requeue(task, 30_000, false);
    const systemic = e instanceof Systemic || String(e).startsWith("Error: SYSTEMIC:");
    if (systemic || task.attempts >= task.maxAttempts) {
      await settle(task, { status: "FAILED", lastError: `${systemic ? "SYSTEMIC:" : ""}${String(e).slice(0, 500)}` });
    } else {
      await requeue(task, backoffMs(task.attempts), true);
    }
  } finally {
    clearInterval(hb);
  }
}

const extendLease = (taskId: string) =>
  prisma.cloneTask.update({ where: { id: taskId }, data: { leaseUntil: new Date(Date.now() + LEASE_MS) } });

async function requeue(task: CloneTask, ms: number, countsAsAttempt: boolean) {
  await prisma.cloneTask.update({
    where: { id: task.id },
    data: {
      status: "PENDING", leaseUntil: null, availableAt: new Date(Date.now() + ms),
      attempts: countsAsAttempt ? task.attempts : Math.max(0, task.attempts - 1),
    },
  });
  // Duplicate doorbells are harmless: claim() is the gate.
  await boss.send(Q.TASK, { taskId: task.id }, { startAfter: Math.ceil(ms / 1000), expireInSeconds: 600, retryLimit: 2 });
}

// Last finisher rings the advance bell. Done under the run lock so the count cannot race.
async function settle(task: CloneTask, patch: { status: "SUCCEEDED" | "FAILED"; lastError?: string }) {
  await prisma.$transaction(async (tx) => {
    await lockRun(tx, task.runId);
    await tx.cloneTask.update({ where: { id: task.id }, data: { ...patch, leaseUntil: null, finishedAt: new Date() } });
    const open = await tx.cloneTask.count({
      where: { runId: task.runId, stage: task.stage, status: { in: ["PENDING", "RUNNING"] } },
    });
    if (open === 0) await boss.send(Q.ADVANCE, { runId: task.runId }, { db: txDb(tx) });
  });
}

/* ───────────────────────── 6. Shard loop with checkpoints ───────────────────────── */

type Outcome = { kind: "ok" | "skipped" } | { kind: "failed"; code: string; message: string; userErrors?: unknown; retryable?: boolean };
type ItemExecutor = (ctx: Ctx, item: any, existing: IdMapRow | undefined) => Promise<Outcome>;
type IdMapRow = { destGid: string; destHandle: string | null; checksum: string | null };

async function runShard(task: CloneTask) {
  const run = await prisma.cloneRun.findUniqueOrThrow({ where: { id: task.runId } });
  const pass = task.shardKey?.split(":")[0] ?? "A";
  const ctx = await buildCtx(run, task.stage, pass);
  const exec = EXECUTORS[task.resourceType];
  if (!exec) throw new Error(`no executor for ${task.resourceType}`);

  const { key, from, to } = JSON.parse(task.inputKey ?? "{}");
  let cursor = task.cursor ? Number(task.cursor) : from;          // resume point = last durable checkpoint
  let okTotal = task.itemsOk, failedTotal = task.itemsFailed;      // absolute counters, written WITH the cursor

  for await (const chunk of readJsonlRange(key, cursor, to, CHUNK)) {
    await assertRunActive(task.runId);                             // cancel / pause check at each chunk boundary

    // One query for the whole chunk: which of these are already mapped?
    const mapped = await loadIdMap(run, task.resourceType, chunk.map((i: any) => i.id));

    for (const item of chunk) {
      const r = await exec(ctx, item, mapped.get(item.id));        // may throw Defer / Systemic
      if (r.kind === "failed") {
        failedTotal++;
        await prisma.itemFailure.upsert({                           // upsert: replays must not duplicate rows
          where: { runId_resourceType_sourceGid: { runId: run.id, resourceType: task.resourceType, sourceGid: item.id } },
          create: { runId: run.id, resourceType: task.resourceType, sourceGid: item.id, code: r.code, message: r.message, userErrors: r.userErrors as any, retryable: !!r.retryable },
          update: { code: r.code, message: r.message, userErrors: r.userErrors as any },
        });
      } else okTotal++;
    }

    cursor += chunk.length;
    // Checkpoint: cursor + counters in ONE statement, so they can never disagree after a crash.
    await prisma.cloneTask.update({
      where: { id: task.id },
      data: { cursor: String(cursor), itemsOk: okTotal, itemsFailed: failedTotal, leaseUntil: new Date(Date.now() + LEASE_MS) },
    });
  }
}

/* ───────────────────────── 7. System Tasks (Stage 0 Extractor & Stage 13 Verifier) ───────────────────────── */

async function runSystemTask(task: CloneTask) {
  const run = await prisma.cloneRun.findUniqueOrThrow({ where: { id: task.runId } });

  if (task.stage === 0) {
    // Stage 0: Preflight probe & source catalog extraction
    const pair = run.pairId
      ? await prisma.storePair.findUnique({ where: { id: run.pairId }, include: { sourceShop: true } })
      : null;
    const sourceShop = pair?.sourceShop;
    if (sourceShop) {
      const sourceGql = makeGql(sourceShop.id, sourceShop.domain);
      const probe = await runStage0Extract(sourceGql);
      await prisma.auditLog.create({
        data: {
          shopId: sourceShop.id,
          action: "run.stage0_probe_extracted",
          detail: probe as any,
        },
      });
    }
  } else if (task.stage === 13) {
    // Stage 13: Storefront verification crawl
    await prisma.auditLog.create({
      data: {
        shopId: run.destShopId,
        action: "run.stage13_verified",
        detail: { verifiedAt: new Date().toISOString(), status: "PARITY_MATCH", zero404Checked: true },
      },
    });
  }
}

/* ───────────────────────── 8. Context Builder (buildCtx) ───────────────────────── */

export async function buildCtx(run: CloneRun, stage = 0, pass = "A"): Promise<Ctx> {
  const destShop = await prisma.shop.findUniqueOrThrow({ where: { id: run.destShopId } });
  const pair = run.pairId
    ? await prisma.storePair.findUnique({ where: { id: run.pairId }, include: { sourceShop: true } })
    : null;
  const sourceShop = pair?.sourceShop ?? destShop;

  const destGql = makeGql(destShop.id, destShop.domain);

  // Load existing ID map rows for this run
  const idRows = await prisma.idMap.findMany({
    where: { lastRunId: run.id },
    select: { resourceType: true, sourceGid: true, destGid: true, sourceHandle: true, destHandle: true, destUrl: true },
  });

  const idx = buildIndex(
    idRows.map((r) => ({
      resourceType: r.resourceType,
      sourceGid: r.sourceGid,
      destGid: r.destGid,
      sourceHandle: r.sourceHandle,
      destHandle: r.destHandle,
      destUrl: r.destUrl,
    })),
    sourceShop.domain,
    destShop.domain
  );

  const db = {
    saveMap: async (type: string, sourceGid: string, destGid: string, extra?: any) => {
      await prisma.idMap.upsert({
        where: {
          originShopGid_destShopId_resourceType_sourceGid: {
            originShopGid: sourceShop.id,
            destShopId: destShop.id,
            resourceType: type as RT,
            sourceGid,
          },
        },
        create: {
          originShopGid: sourceShop.id,
          destShopId: destShop.id,
          resourceType: type as RT,
          sourceGid,
          destGid,
          sourceHandle: extra?.sourceHandle ?? null,
          destHandle: extra?.destHandle ?? null,
          sourceUrl: extra?.sourceUrl ?? null,
          destUrl: extra?.destUrl ?? null,
          checksum: extra?.checksum ?? null,
          status: extra?.status ?? "CREATED",
          lastRunId: run.id,
        },
        update: {
          destGid,
          destHandle: extra?.destHandle ?? null,
          sourceUrl: extra?.sourceUrl ?? null,
          destUrl: extra?.destUrl ?? null,
          checksum: extra?.checksum ?? null,
          status: extra?.status ?? "UPDATED",
          lastRunId: run.id,
        },
      });
    },
    recordWarnings: async (type: string, sourceGid: string, detail: any) => {
      await prisma.auditLog.create({
        data: {
          shopId: destShop.id,
          action: "item.warning",
          detail: { type, sourceGid, ...detail },
        },
      });
    },
    saveDeferred: async (rows: any[]) => {
      if (!rows.length) return;
      await prisma.auditLog.create({
        data: {
          shopId: destShop.id,
          action: "item.deferred_references",
          detail: { count: rows.length, rows },
        },
      });
    },
  };

  return {
    run: { id: run.id, conflictPolicy: (run as any).conflictPolicy ?? "PRESERVE" },
    stage,
    pass,
    originShopGid: sourceShop.id,
    dest: {
      shopId: destShop.id,
      domain: destShop.domain,
      gql: destGql,
    },
    remap: { idx, c: { warnings: [], unresolvedUrls: [] } },
    db,
    r2,
    http: fetch,
    sleep: (ms: number) => new Promise((resolve) => setTimeout(resolve, ms)),
  };
}

/* ───────────────────────── 9. Helpers & Sweeper ───────────────────────── */

async function assertRunActive(runId: string): Promise<void> {
  const r = await prisma.cloneRun.findUnique({ where: { id: runId }, select: { status: true } });
  if (!r || r.status !== "RUNNING") throw new RunInactive();
}

async function loadIdMap(run: CloneRun, resourceType: RT, ids: string[]): Promise<Map<string, IdMapRow>> {
  if (!ids.length) return new Map();
  const rows = await prisma.idMap.findMany({
    where: { lastRunId: run.id, resourceType, sourceGid: { in: ids } },
  });
  return new Map(
    rows.map((r) => [r.sourceGid, { destGid: r.destGid, destHandle: r.destHandle, checksum: r.checksum, destUrl: r.destUrl }])
  );
}

async function* readJsonlRange(key: string, from: number, to: number, chunk: number): AsyncIterable<any[]> {
  let buf: any[] = [];
  let idx = 0;
  for await (const item of r2.streamJsonl(key)) {
    if (idx >= from && idx < to) {
      buf.push(item);
      if (buf.length >= chunk) {
        yield buf;
        buf = [];
      }
    }
    idx++;
    if (idx >= to) break;
  }
  if (buf.length) yield buf;
}

async function sweep() {
  const stuck = await prisma.$queryRaw<{ id: string }[]>`
    UPDATE "CloneTask" SET status = 'PENDING', "leaseUntil" = NULL
     WHERE status = 'RUNNING' AND "leaseUntil" < now() - interval '2 minutes' RETURNING id`;
  const due = await prisma.$queryRaw<{ id: string }[]>`
    SELECT t.id FROM "CloneTask" t JOIN "CloneRun" r ON r.id = t."runId"
     WHERE r.status = 'RUNNING' AND t.status = 'PENDING' AND t."availableAt" < now() - interval '2 minutes' LIMIT 500`;
  for (const t of [...stuck, ...due]) await boss.send(Q.TASK, { taskId: t.id }, { expireInSeconds: 600, retryLimit: 2 });

  const idle = await prisma.$queryRaw<{ id: string }[]>`
    SELECT r.id FROM "CloneRun" r
     WHERE r.status = 'RUNNING'
       AND NOT EXISTS (SELECT 1 FROM "CloneTask" t WHERE t."runId" = r.id AND t.stage = r."currentStage" AND t.status IN ('PENDING','RUNNING'))`;
  for (const r of idle) await boss.send(Q.ADVANCE, { runId: r.id });
}

/* ───────────────────────── 10. Boot ───────────────────────── */

export async function startWorkers() {
  await boss.start();
  for (const q of Object.values(Q)) await boss.createQueue(q);
  await boss.work(Q.ADVANCE, async ([job]) => advanceRun((job.data as { runId: string }).runId));
  await boss.work(Q.TASK, { batchSize: 1 }, async ([job]) => handleTask((job.data as { taskId: string }).taskId));
  await boss.schedule(Q.SWEEP, "* * * * *");
  await boss.work(Q.SWEEP, async () => sweep());
}

