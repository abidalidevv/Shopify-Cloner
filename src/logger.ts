/**
 * Structured logger with mandatory redaction.
 *
 * Every message is redacted before output. Log levels: debug, info, warn, error.
 * Output goes to stdout (info/debug) or stderr (warn/error).
 * Format: ISO timestamp + level + message + optional JSON fields.
 */

import { redactAny } from "./redact.js";

export type LogLevel = "debug" | "info" | "warn" | "error";

const LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

/** Reads LOG_LEVEL from env; defaults to "info". */
function resolveLevel(): LogLevel {
  const raw = process.env["LOG_LEVEL"]?.toLowerCase() ?? "info";
  if (raw === "debug" || raw === "info" || raw === "warn" || raw === "error") {
    return raw;
  }
  return "info";
}

let currentLevel: LogLevel = resolveLevel();

/** Change log level at runtime (used in tests). */
export function setLogLevel(level: LogLevel): void {
  currentLevel = level;
}

function emit(
  level: LogLevel,
  message: string,
  fields?: Record<string, unknown>
): void {
  if (LEVELS[level] < LEVELS[currentLevel]) return;

  const ts = new Date().toISOString();
  const safeMessage = redactAny(message);
  const safeFields =
    fields !== undefined ? " " + redactAny(fields) : "";
  const line = `[${ts}] [${level.toUpperCase()}] ${safeMessage}${safeFields}`;

  if (level === "warn" || level === "error") {
    process.stderr.write(line + "\n");
  } else {
    process.stdout.write(line + "\n");
  }
}

export const logger = {
  debug(message: string, fields?: Record<string, unknown>): void {
    emit("debug", message, fields);
  },
  info(message: string, fields?: Record<string, unknown>): void {
    emit("info", message, fields);
  },
  warn(message: string, fields?: Record<string, unknown>): void {
    emit("warn", message, fields);
  },
  error(message: string, fields?: Record<string, unknown>): void {
    emit("error", message, fields);
  },
};
