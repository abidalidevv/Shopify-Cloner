/**
 * Global constants pinned to this project.
 * Only change SHOPIFY_API_VERSION after reading Shopify release notes.
 */

/** Pinned Admin GraphQL API version. Released 2026-10-01. */
export const SHOPIFY_API_VERSION = "2026-10";

/** Store sizes for TibbeShifa (used in assertions and progress bars). */
export const EXPECTED_COUNTS = {
  products: 7,
  collections: 7,
  customers: 2,
  orders: 3,
  discounts: 1,
  pages: 11,
  menus: 3,
  metaobjects: 12,
  translations: 42,
  redirects: 1,
  files: 523,
} as const;

/** Maximum files per stagedUploadsCreate / fileCreate batch (per Shopify docs). */
export const FILE_BATCH_SIZE = 250;

/** Name of the STOP sentinel file (place in project root to halt gracefully). */
export const STOP_FILE = "STOP";

/** Directory where checkpoint state files are written. */
export const CHECKPOINT_DIR = "checkpoints";

/** Directory where audit logs are written. */
export const AUDIT_LOG_DIR = "logs";
