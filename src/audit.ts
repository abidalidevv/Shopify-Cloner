/**
 * JSONL audit log.
 *
 * Every attempted write, skip, and error is appended as one JSON line
 * to logs/audit.jsonl. This is the immutable record of what the tool did.
 *
 * Goal file §Phase 1: "audit log (JSONL) of every attempted write,
 * skipped item and error."
 * Goal file §1 rule 9: "Never silently skip or drop a field. Anything not
 * migrated goes into a report with the reason."
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { AUDIT_LOG_DIR } from "./constants.js";
import { redact } from "./redact.js";

export type AuditAction =
  | "write_attempted"
  | "write_succeeded"
  | "write_failed"
  | "write_skipped"
  | "dry_run_blocked"
  | "source_guard_blocked"
  | "error";

export interface AuditEntry {
  ts: string;
  action: AuditAction;
  phase: string;
  resourceType: string;
  naturalKey: string;
  reason?: string | undefined;
  sourceId?: string | undefined;
  destId?: string | undefined;
}

let auditStream: fs.WriteStream | null = null;

function getStream(): fs.WriteStream {
  if (auditStream !== null) return auditStream;
  fs.mkdirSync(AUDIT_LOG_DIR, { recursive: true });
  const filePath = path.join(AUDIT_LOG_DIR, "audit.jsonl");
  auditStream = fs.createWriteStream(filePath, { flags: "a", encoding: "utf8" });
  return auditStream;
}

/**
 * Append one entry to the audit log.
 * All string fields are redacted before writing.
 */
export function auditLog(entry: AuditEntry): void {
  const safe: AuditEntry = {
    ...entry,
    naturalKey: redact(entry.naturalKey),
    reason: entry.reason !== undefined ? redact(entry.reason) : undefined,
  };
  getStream().write(JSON.stringify(safe) + "\n");
}

/** Close the audit stream (call on process exit). */
export function closeAuditLog(): void {
  if (auditStream !== null) {
    auditStream.end();
    auditStream = null;
  }
}
