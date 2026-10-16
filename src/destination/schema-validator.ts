/**
 * Phase 6 Schema Validation Engine.
 *
 * Runs introspection query against destination store Admin GraphQL API (2026-10)
 * to verify that all mutations and fields used by Phase 6 importers exist before
 * any --apply write is permitted.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { type GraphQLClient } from "../client.js";
import { logger } from "../logger.js";

export const REQUIRED_MUTATIONS = [
  { name: "pageCreate", requiredArg: "page" },
  { name: "urlRedirectCreate", requiredArg: "urlRedirect" },
  { name: "fileCreate", requiredArg: "files" },
  { name: "productCreate", requiredArg: "product" },
  { name: "collectionCreate", requiredArg: "collection" },
  { name: "productUpdate", requiredArg: "product" },
  { name: "metaobjectDefinitionCreate", requiredArg: "definition" },
  { name: "metaobjectUpsert", requiredArg: "metaobject" },
  { name: "menuCreate", requiredArg: "items" },
  { name: "translationsRegister", requiredArg: "translations" },
  { name: "inventorySetQuantities", requiredArg: "input" },
  { name: "discountCodeBasicCreate", requiredArg: "basicCodeDiscount" },
  { name: "discountAutomaticBasicCreate", requiredArg: "automaticBasicDiscount" },
];

export interface ValidationFieldResult {
  mutation: string;
  existsInSchema: boolean;
  argValid: boolean;
  notes?: string | undefined;
}

export interface SchemaValidationSummary {
  timestamp: string;
  destinationShop: string;
  allValid: boolean;
  results: ValidationFieldResult[];
}

const INTROSPECTION_QUERY = `
query IntrospectMutations {
  __schema {
    mutationType {
      fields {
        name
        args {
          name
        }
      }
    }
  }
}
`;

interface IntrospectionResponse {
  __schema: {
    mutationType: {
      fields: Array<{
        name: string;
        args: Array<{ name: string }>;
      }>;
    };
  };
}

export async function validateDestinationSchema(
  client: GraphQLClient,
  destinationShop: string,
  reportsDir = "reports",
  checkpointsDir = "checkpoints"
): Promise<SchemaValidationSummary> {
  logger.info(`Validating Phase 6 GraphQL mutations against ${destinationShop} schema...`);

  const res = await client.query<IntrospectionResponse>(INTROSPECTION_QUERY);
  const schemaMutations = new Map<string, Set<string>>();

  for (const f of res.__schema.mutationType.fields) {
    schemaMutations.set(f.name, new Set(f.args.map((a) => a.name)));
  }

  const results: ValidationFieldResult[] = [];
  let allValid = true;

  for (const req of REQUIRED_MUTATIONS) {
    const argsSet = schemaMutations.get(req.name);
    if (!argsSet) {
      allValid = false;
      results.push({
        mutation: req.name,
        existsInSchema: false,
        argValid: false,
        notes: `Mutation '${req.name}' is missing in live 2026-10 schema!`,
      });
    } else {
      const hasArg = argsSet.has(req.requiredArg);
      if (!hasArg) {
        allValid = false;
        results.push({
          mutation: req.name,
          existsInSchema: true,
          argValid: false,
          notes: `Expected argument '${req.requiredArg}' missing on '${req.name}'.`,
        });
      } else {
        results.push({
          mutation: req.name,
          existsInSchema: true,
          argValid: true,
          notes: "Verified against live schema.",
        });
      }
    }
  }

  const summary: SchemaValidationSummary = {
    timestamp: new Date().toISOString(),
    destinationShop,
    allValid,
    results,
  };

  // 1. Write validation report
  fs.mkdirSync(reportsDir, { recursive: true });
  let md = `# GraphQL Schema Validation Report (2026-10)\n\n`;
  md += `- **Timestamp:** ${summary.timestamp}\n`;
  md += `- **Destination Store:** \`${summary.destinationShop}\`\n`;
  md += `- **Validation Result:** **\`${allValid ? "PASSED ✅" : "FAILED ❌"}\`**\n\n`;
  md += `| Mutation | Exists in Schema | Required Argument | Status | Notes |\n`;
  md += `|---|---|---|---|---|\n`;

  for (const r of results) {
    const exIcon = r.existsInSchema ? "✅" : "❌";
    const argIcon = r.argValid ? "✅" : "❌";
    const statusText = r.existsInSchema && r.argValid ? "VALID" : "INVALID";
    md += `| \`${r.mutation}\` | ${exIcon} | ${argIcon} | \`${statusText}\` | ${r.notes ?? "—"} |\n`;
  }

  fs.writeFileSync(path.join(reportsDir, "06-schema-validation.md"), md, "utf8");

  // 2. Write checkpoint token if passed
  if (allValid) {
    fs.mkdirSync(checkpointsDir, { recursive: true });
    fs.writeFileSync(
      path.join(checkpointsDir, "schema-validated.json"),
      JSON.stringify({ validatedAt: summary.timestamp, destinationShop }, null, 2),
      "utf8"
    );
  }

  return summary;
}

export function isSchemaValidated(destinationShop: string, checkpointsDir = "checkpoints"): boolean {
  const filePath = path.join(checkpointsDir, "schema-validated.json");
  if (!fs.existsSync(filePath)) return false;
  try {
    const data = JSON.parse(fs.readFileSync(filePath, "utf8")) as { destinationShop?: string };
    return data.destinationShop === destinationShop;
  } catch {
    return false;
  }
}
