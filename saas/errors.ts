// errors.ts — control-flow errors shared by the scheduler and the executors.
// Kept in its own file so executors never need to import the scheduler at runtime (no import cycle).

/** The shop's rate-limit bucket is empty (or Shopify said THROTTLED): requeue the task, free the worker slot. */
export class Defer extends Error {
  ms: number;
  constructor(ms: number) { super(`defer ${ms}ms`); this.ms = ms; }
}

/** Auth revoked, scope missing, shop frozen or gone: retrying cannot help. The run pauses. */
export class Systemic extends Error {}

/** The run was paused or cancelled while a task was in flight. Leave the task PENDING and stop quietly. */
export class RunInactive extends Error {}

/** A fatal remapping error occurred while processing an item. */
export class RemapError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
    this.name = "RemapError";
  }
}

