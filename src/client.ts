/**
 * Guarded GraphQL client — the central safety mechanism.
 *
 * SAFETY RULES (from goal file §1):
 * 1. A client with role="source" MUST reject any GraphQL mutation.
 * 2. When dry-run is active, ALL clients reject mutations.
 * 3. API version is pinned; if Shopify's X-Shopify-API-Version response header
 *    differs from the pinned version, the call FAILS LOUDLY (Shopify silently
 *    "falls forward" to a different version, which can break things silently).
 * 4. HTTP 200 is NOT success — errors and userErrors are always checked.
 *
 * This module is the single place every Shopify API call goes through.
 */

import { SHOPIFY_API_VERSION } from "./constants.js";
import { logger } from "./logger.js";
import { withRetry, type RetryOptions } from "./retry.js";
import { redact } from "./redact.js";

// ── Types ────────────────────────────────────────────────────────────────────

export type ClientRole = "source" | "destination";

export interface ClientConfig {
  shop: string;
  /** Access token — held in memory only, never written to disk or logs. */
  accessToken: string;
  role: ClientRole;
  /** When true, ALL mutation calls are blocked regardless of role. */
  dryRun: boolean;
}

export interface GraphQLError {
  message: string;
  extensions?: { code?: string };
}

export interface UserError {
  field?: string[];
  message: string;
}

export interface GqlResponse<T> {
  data?: T;
  errors?: GraphQLError[];
  extensions?: {
    cost?: {
      requestedQueryCost: number;
      actualQueryCost: number;
      throttleStatus: {
        maximumAvailable: number;
        currentlyAvailable: number;
        restoreRate: number;
      };
    };
  };
}

/** Thrown when the response X-Shopify-API-Version header does not match pinned version. */
export class ApiVersionMismatchError extends Error {
  constructor(expected: string, actual: string) {
    super(
      `API version mismatch: expected "${expected}", got "${actual}" from Shopify. ` +
      "Shopify silently fell-forward to a different version. " +
      "Check https://shopify.dev/docs/api/release-notes for updates."
    );
    this.name = "ApiVersionMismatchError";
  }
}

/** Thrown when a mutation is blocked by the write-guard. */
export class WriteBlockedError extends Error {
  constructor(reason: "source-role" | "dry-run") {
    const msg =
      reason === "source-role"
        ? "WRITE BLOCKED: mutations are not allowed on a source-role client. " +
          "The source store is read-only."
        : "WRITE BLOCKED: dry-run mode is active. Pass --apply to perform real writes.";
    super(msg);
    this.name = "WriteBlockedError";
  }
}

/** Thrown when a GraphQL response contains errors or userErrors. */
export class GraphQLResponseError extends Error {
  constructor(
    public readonly gqlErrors: GraphQLError[],
    public readonly userErrors: UserError[]
  ) {
    const msgs = [
      ...gqlErrors.map((e) => `GraphQL: ${e.message}`),
      ...userErrors.map((e) => `userError: ${e.message}`),
    ].join("; ");
    super(msgs);
    this.name = "GraphQLResponseError";
  }
}

// ── Mutation detection ────────────────────────────────────────────────────────

/**
 * Lexer-based mutation detector for GraphQL documents.
 *
 * Scans the GraphQL document respecting:
 * 1. Single-line comments (# ...)
 * 2. Regular string literals ("...") with escape sequences
 * 3. Block string literals ("""...""")
 * 4. Selection set depth tracking ({ and })
 *
 * A mutation is identified when the keyword `mutation` occurs as a top-level
 * operation definition (brace depth 0, outside comments and strings).
 *
 * This guarantees:
 * - Leading comments and multiline comments are skipped
 * - Whitespace and newlines anywhere are handled cleanly
 * - Named operations like `mutation DoSomething(...)` are recognized
 * - The word "mutation" inside string literals or comments in queries is NOT blocked
 * - Documents with multiple operations (e.g. query Q + mutation M) are recognized
 */
export function isMutation(document: string): boolean {
  let inComment = false;
  let inString = false;
  let inBlockString = false;
  let depth = 0;
  let currentWord = "";

  for (let i = 0; i < document.length; i++) {
    const ch = document[i]!;

    // 1. Inside single-line comment (# to newline)
    if (inComment) {
      if (ch === "\n" || ch === "\r") {
        inComment = false;
      }
      continue;
    }

    // 2. Inside block string (""" ... """)
    if (inBlockString) {
      if (
        ch === '"' &&
        document[i + 1] === '"' &&
        document[i + 2] === '"' &&
        document[i - 1] !== "\\"
      ) {
        inBlockString = false;
        i += 2;
      }
      continue;
    }

    // 3. Inside standard string (" ... ")
    if (inString) {
      if (ch === "\\" && i + 1 < document.length) {
        i++; // skip escaped char
        continue;
      }
      if (ch === '"') {
        inString = false;
      }
      continue;
    }

    // 4. Comment start
    if (ch === "#") {
      if (depth === 0 && currentWord.toLowerCase() === "mutation") {
        return true;
      }
      currentWord = "";
      inComment = true;
      continue;
    }

    // 5. String or block string start
    if (ch === '"') {
      if (depth === 0 && currentWord.toLowerCase() === "mutation") {
        return true;
      }
      currentWord = "";
      if (document[i + 1] === '"' && document[i + 2] === '"') {
        inBlockString = true;
        i += 2;
      } else {
        inString = true;
      }
      continue;
    }

    // 6. Braces depth tracking
    if (ch === "{") {
      if (depth === 0 && currentWord.toLowerCase() === "mutation") {
        return true;
      }
      currentWord = "";
      depth++;
      continue;
    }

    if (ch === "}") {
      currentWord = "";
      if (depth > 0) depth--;
      continue;
    }

    // 7. Word characters (alphanumeric + underscore)
    if (/[_a-zA-Z0-9]/.test(ch)) {
      currentWord += ch;
    } else {
      // Encountered non-word char (whitespace, punctuation, etc.)
      if (depth === 0 && currentWord.toLowerCase() === "mutation") {
        return true;
      }
      currentWord = "";
    }
  }

  // Trailing word check
  return depth === 0 && currentWord.toLowerCase() === "mutation";
}

// ── Main client class ─────────────────────────────────────────────────────────

export class GraphQLClient {
  private readonly endpoint: string;
  private readonly headers: Record<string, string>;

  constructor(private readonly config: ClientConfig) {
    this.endpoint = `https://${config.shop}/admin/api/${SHOPIFY_API_VERSION}/graphql.json`;
    // Token stays in memory only — it is NEVER logged (redact() handles it if
    // it somehow slips into an error message, but we don't pass it to logger).
    this.headers = {
      "Content-Type": "application/json",
      "X-Shopify-Access-Token": config.accessToken,
    };
  }

  /**
   * Execute a GraphQL query. Always safe regardless of role or dry-run.
   */
  async query<T>(
    document: string,
    variables?: Record<string, unknown>,
    retryOpts?: RetryOptions
  ): Promise<T> {
    if (isMutation(document)) {
      if (this.config.role === "source") {
        throw new WriteBlockedError("source-role");
      }
      if (this.config.dryRun) {
        throw new WriteBlockedError("dry-run");
      }
      // Queries must not accidentally be mutations
      throw new Error(
        "GraphQLClient.query() received a mutation document. Use .mutate() instead."
      );
    }
    return this._execute<T>(document, variables, retryOpts);
  }

  /**
   * Execute a GraphQL mutation.
   *
   * BLOCKED if:
   *   - role === "source"  (source store is physically read-only)
   *   - dryRun === true    (dry-run prevents all writes)
   */
  async mutate<T>(
    document: string,
    variables?: Record<string, unknown>,
    retryOpts?: RetryOptions
  ): Promise<T> {
    // Safety gate 1: source role
    if (this.config.role === "source") {
      throw new WriteBlockedError("source-role");
    }
    // Safety gate 2: dry-run
    if (this.config.dryRun) {
      throw new WriteBlockedError("dry-run");
    }

    return this._execute<T>(document, variables, retryOpts);
  }

  private async _execute<T>(
    document: string,
    variables: Record<string, unknown> | undefined,
    retryOpts?: RetryOptions
  ): Promise<T> {
    // Ultimate safety gate before HTTP dispatch:
    if (isMutation(document)) {
      if (this.config.role === "source") {
        throw new WriteBlockedError("source-role");
      }
      if (this.config.dryRun) {
        throw new WriteBlockedError("dry-run");
      }
    }
    const label = `${this.config.role}@${this.config.shop}`;
    return withRetry(
      label,
      async () => {
        const response = await fetch(this.endpoint, {
          method: "POST",
          headers: this.headers,
          body: JSON.stringify({ query: document, variables }),
        });

        // ── API version check (goal file §2) ──────────────────────────────
        const respondedVersion = response.headers.get("X-Shopify-API-Version");
        if (respondedVersion !== null && respondedVersion !== SHOPIFY_API_VERSION) {
          throw new ApiVersionMismatchError(SHOPIFY_API_VERSION, respondedVersion);
        }

        // ── Handle HTTP-level errors ───────────────────────────────────────
        if (!response.ok) {
          const body = await response.text().catch(() => "");
          const err = new Error(
            `HTTP ${response.status} from ${this.config.shop}: ${redact(body)}`
          ) as Error & { status: number };
          err.status = response.status;
          throw err;
        }

        // ── Parse and validate response (HTTP 200 ≠ success) ───────────────
        const json = (await response.json()) as GqlResponse<T>;

        // Log throttle status at debug level
        if (json.extensions?.cost) {
          const cost = json.extensions.cost;
          logger.debug("GraphQL cost", {
            shop: this.config.shop,
            requested: cost.requestedQueryCost,
            actual: cost.actualQueryCost,
            available: cost.throttleStatus.currentlyAvailable,
          });

          // If throttled, signal the retry layer
          if (
            cost.throttleStatus.currentlyAvailable <
            cost.requestedQueryCost
          ) {
            const thrErr = new Error("THROTTLED") as Error & { status: number };
            thrErr.status = 429;
            throw thrErr;
          }
        }

        // Collect all errors from the response
        const gqlErrors: GraphQLError[] = json.errors ?? [];
        const userErrors: UserError[] = extractUserErrors(json.data);

        if (gqlErrors.length > 0 || userErrors.length > 0) {
          throw new GraphQLResponseError(gqlErrors, userErrors);
        }

        if (json.data === undefined) {
          throw new Error("GraphQL response had no data and no errors.");
        }

        return json.data;
      },
      retryOpts
    );
  }
}

// ── Helper: extract userErrors from any top-level mutation result ─────────────

function extractUserErrors(data: unknown): UserError[] {
  if (data === null || typeof data !== "object") return [];
  const errors: UserError[] = [];
  for (const value of Object.values(data as Record<string, unknown>)) {
    if (
      value !== null &&
      typeof value === "object" &&
      "userErrors" in value &&
      Array.isArray((value as { userErrors: unknown }).userErrors)
    ) {
      errors.push(...((value as { userErrors: UserError[] }).userErrors));
    }
  }
  return errors;
}

// ── Factory ───────────────────────────────────────────────────────────────────

/**
 * Create a source client (read-only — mutations are physically impossible).
 * Token is passed at runtime, never stored in config files.
 */
export function createSourceClient(
  shop: string,
  accessToken: string,
  dryRun: boolean
): GraphQLClient {
  return new GraphQLClient({ shop, accessToken, role: "source", dryRun });
}

/**
 * Create a destination client (writes enabled only when dryRun=false).
 * Token is passed at runtime, never stored in config files.
 */
export function createDestClient(
  shop: string,
  accessToken: string,
  dryRun: boolean
): GraphQLClient {
  return new GraphQLClient({ shop, accessToken, role: "destination", dryRun });
}
