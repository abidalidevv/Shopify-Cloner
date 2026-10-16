/**
 * Checkpoint / resume system.
 *
 * Each phase writes a JSON state file to the checkpoints/ directory.
 * If a phase is interrupted, re-running it reads the checkpoint and
 * skips already-completed items.
 *
 * Goal file §Phase 1: "Checkpoint/resume system (state file per phase)
 * and a STOP mechanism (a STOP file or Ctrl+C handler that finishes the
 * current item and saves state)."
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { CHECKPOINT_DIR, STOP_FILE } from "./constants.js";
import { logger } from "./logger.js";

/** Generic checkpoint state for a migration phase. */
export interface CheckpointState<T> {
  phase: string;
  startedAt: string;
  updatedAt: string;
  completed: boolean;
  /** IDs / keys already successfully processed. */
  done: string[];
  /** Any phase-specific extra data (e.g. ID maps built so far). */
  data: T;
}

/** Returns the checkpoint file path for a given phase name. */
function checkpointPath(phase: string): string {
  return path.join(CHECKPOINT_DIR, `${phase}.json`);
}

/** Ensure the checkpoints directory exists. */
function ensureDir(): void {
  fs.mkdirSync(CHECKPOINT_DIR, { recursive: true });
}

/**
 * Load an existing checkpoint for `phase`, or return null if none exists.
 */
export function loadCheckpoint<T>(
  phase: string
): CheckpointState<T> | null {
  const filePath = checkpointPath(phase);
  if (!fs.existsSync(filePath)) return null;
  try {
    const raw = fs.readFileSync(filePath, "utf8");
    return JSON.parse(raw) as CheckpointState<T>;
  } catch (err) {
    logger.warn(`Checkpoint for "${phase}" exists but could not be parsed — starting fresh.`, {
      error: String(err),
    });
    return null;
  }
}

/**
 * Save checkpoint state to disk.
 * Called after every successfully processed item so a restart can skip it.
 */
export function saveCheckpoint<T>(state: CheckpointState<T>): void {
  ensureDir();
  state.updatedAt = new Date().toISOString();
  const filePath = checkpointPath(state.phase);
  fs.writeFileSync(filePath, JSON.stringify(state, null, 2), "utf8");
}

/**
 * Create a fresh checkpoint state for `phase`.
 */
export function createCheckpoint<T>(phase: string, initialData: T): CheckpointState<T> {
  return {
    phase,
    startedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    completed: false,
    done: [],
    data: initialData,
  };
}

/**
 * Mark a phase checkpoint as complete.
 */
export function markComplete<T>(state: CheckpointState<T>): void {
  state.completed = true;
  saveCheckpoint(state);
  logger.info(`Phase "${state.phase}" marked complete.`);
}

// ── STOP file mechanism ───────────────────────────────────────────────────────

let stopRequested = false;

/** Returns true if a graceful stop has been requested. */
export function isStopRequested(): boolean {
  if (stopRequested) return true;
  // Check for the STOP sentinel file
  if (fs.existsSync(STOP_FILE)) {
    logger.warn(`STOP file detected — finishing current item then halting.`);
    stopRequested = true;
    return true;
  }
  return false;
}

/** Reset stop request state (used in testing and clean starts). */
export function resetStopRequest(): void {
  stopRequested = false;
}

/**
 * Register a Ctrl+C (SIGINT) handler that sets the stop flag.
 * The running phase should call isStopRequested() between items
 * and save its checkpoint before exiting cleanly.
 */
export function registerStopHandler(): void {
  process.once("SIGINT", () => {
    logger.warn("SIGINT received — finishing current item then stopping. Checkpoint will be saved.");
    stopRequested = true;
  });
}
