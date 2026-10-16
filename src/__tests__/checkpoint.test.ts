/**
 * Tests for the checkpoint / resume system and STOP file mechanism.
 *
 * Verifies:
 * 1. loadCheckpoint returns null when no state file exists.
 * 2. createCheckpoint creates a properly formatted initial state.
 * 3. saveCheckpoint and loadCheckpoint persist and resume state accurately.
 * 4. markComplete updates completed to true and persists.
 * 5. Corrupted checkpoint file returns null safely without throwing.
 * 6. STOP sentinel file is detected by isStopRequested.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import {
  createCheckpoint,
  saveCheckpoint,
  loadCheckpoint,
  markComplete,
  isStopRequested,
  resetStopRequest,
} from "../checkpoint.js";
import { CHECKPOINT_DIR, STOP_FILE } from "../constants.js";

const TEST_PHASE = "test-phase-unit";
const testCheckpointPath = path.join(CHECKPOINT_DIR, `${TEST_PHASE}.json`);

describe("checkpoint / resume system", () => {
  beforeEach(() => {
    resetStopRequest();
    if (fs.existsSync(testCheckpointPath)) {
      fs.unlinkSync(testCheckpointPath);
    }
    if (fs.existsSync(STOP_FILE)) {
      fs.unlinkSync(STOP_FILE);
    }
  });

  afterEach(() => {
    resetStopRequest();
    if (fs.existsSync(testCheckpointPath)) {
      fs.unlinkSync(testCheckpointPath);
    }
    if (fs.existsSync(STOP_FILE)) {
      fs.unlinkSync(STOP_FILE);
    }
  });

  it("returns null when no checkpoint exists", () => {
    const state = loadCheckpoint<Record<string, unknown>>(TEST_PHASE);
    expect(state).toBeNull();
  });

  it("creates a fresh checkpoint with empty done array and completed=false", () => {
    const initialData = { processedCount: 0, idMap: {} };
    const cp = createCheckpoint(TEST_PHASE, initialData);

    expect(cp.phase).toBe(TEST_PHASE);
    expect(cp.completed).toBe(false);
    expect(cp.done).toEqual([]);
    expect(cp.data).toEqual(initialData);
    expect(typeof cp.startedAt).toBe("string");
    expect(typeof cp.updatedAt).toBe("string");
  });

  it("saves and resumes checkpoint state across operations", () => {
    const cp = createCheckpoint(TEST_PHASE, { count: 0 });
    cp.done.push("prod-1", "prod-2");
    cp.data = { count: 2 };
    saveCheckpoint(cp);

    // Verify it exists on disk
    expect(fs.existsSync(testCheckpointPath)).toBe(true);

    // Resume / load it
    const resumed = loadCheckpoint<{ count: number }>(TEST_PHASE);
    expect(resumed).not.toBeNull();
    expect(resumed?.phase).toBe(TEST_PHASE);
    expect(resumed?.completed).toBe(false);
    expect(resumed?.done).toEqual(["prod-1", "prod-2"]);
    expect(resumed?.data.count).toBe(2);
  });

  it("marks checkpoint as complete and persists to disk", () => {
    const cp = createCheckpoint(TEST_PHASE, { status: "running" });
    saveCheckpoint(cp);

    markComplete(cp);
    expect(cp.completed).toBe(true);

    const loaded = loadCheckpoint<{ status: string }>(TEST_PHASE);
    expect(loaded?.completed).toBe(true);
  });

  it("returns null and recovers gracefully when checkpoint JSON is corrupted", () => {
    fs.mkdirSync(CHECKPOINT_DIR, { recursive: true });
    fs.writeFileSync(testCheckpointPath, "{ invalid json content ...", "utf8");

    const loaded = loadCheckpoint(TEST_PHASE);
    expect(loaded).toBeNull();
  });
});

describe("STOP sentinel file mechanism", () => {
  beforeEach(() => {
    resetStopRequest();
    if (fs.existsSync(STOP_FILE)) {
      fs.unlinkSync(STOP_FILE);
    }
  });

  afterEach(() => {
    resetStopRequest();
    if (fs.existsSync(STOP_FILE)) {
      fs.unlinkSync(STOP_FILE);
    }
  });

  it("returns false when STOP file is absent and stop is not requested", () => {
    expect(isStopRequested()).toBe(false);
  });

  it("detects STOP file, returns true, and remembers stop request", () => {
    fs.writeFileSync(STOP_FILE, "halt", "utf8");
    expect(isStopRequested()).toBe(true);

    // Even if STOP file is subsequently removed, stopRequested flag remains set until reset
    fs.unlinkSync(STOP_FILE);
    expect(isStopRequested()).toBe(true);

    // After reset, returns false
    resetStopRequest();
    expect(isStopRequested()).toBe(false);
  });
});
