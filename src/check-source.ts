/**
 * Source Store Connection & Identity Verifier.
 *
 * Executes a harmless read-only GraphQL query to verify:
 * - Shop name
 * - myshopify.com domain
 * - Shopify Plan
 * - Currency code
 * - Primary & enabled locales
 *
 * Used in Phase 2 to allow the owner to confirm identity before any other operation.
 */

import { loadConfig } from "./config.js";
import { resolveAccessToken } from "./auth.js";
import { createSourceClient } from "./client.js";

const IDENTITY_QUERY = `
query CheckSourceIdentity {
  shop {
    name
    myshopifyDomain
    currencyCode
    plan {
      displayName
      partnerDevelopment
      shopifyPlus
    }
  }
  shopLocales {
    locale
    name
    primary
    published
  }
}
`;

interface ShopIdentityRawResponse {
  shop: {
    name: string;
    myshopifyDomain: string;
    currencyCode: string;
    plan: {
      displayName: string;
      partnerDevelopment: boolean;
      shopifyPlus: boolean;
    };
  };
  shopLocales?: Array<{
    locale: string;
    name: string;
    primary: boolean;
    published: boolean;
  }>;
}

export interface ShopIdentityResponse {
  shop: {
    name: string;
    myshopifyDomain: string;
    currencyCode: string;
    plan: {
      displayName: string;
      partnerDevelopment: boolean;
      shopifyPlus: boolean;
    };
    primaryLocale: {
      locale: string;
      name: string;
    };
    enabledLocales: Array<{
      locale: string;
      name: string;
      primary: boolean;
    }>;
  };
}

export async function checkSourceIdentity(): Promise<ShopIdentityResponse["shop"]> {
  const config = loadConfig();
  const token = await resolveAccessToken(config.source);
  const client = createSourceClient(config.source.shop, token, false);

  const res = await client.query<ShopIdentityRawResponse>(IDENTITY_QUERY);
  const locales = res.shopLocales ?? [];
  const primary = locales.find((l) => l.primary) ?? locales[0] ?? { locale: "en", name: "English" };

  return {
    ...res.shop,
    primaryLocale: {
      locale: primary.locale,
      name: primary.name,
    },
    enabledLocales: locales.map((l) => ({
      locale: l.locale,
      name: l.name,
      primary: l.primary,
    })),
  };
}

// CLI runner if executed directly
async function run(): Promise<void> {
  try {
    console.log("\n=======================================================");
    console.log(" Connecting to SOURCE Store (Read-Only)...");
    console.log("=======================================================\n");

    const shop = await checkSourceIdentity();

    console.log("✅ SOURCE STORE IDENTITY CONFIRMED:");
    console.log(`   - Name:             ${shop.name}`);
    console.log(`   - myshopify Domain: ${shop.myshopifyDomain}`);
    console.log(`   - Plan:             ${shop.plan.displayName}${shop.plan.shopifyPlus ? " (Shopify Plus)" : ""}`);
    console.log(`   - Currency:         ${shop.currencyCode}`);
    console.log(`   - Primary Locale:   ${shop.primaryLocale.name} (${shop.primaryLocale.locale})`);
    console.log(
      `   - Enabled Locales:  ${shop.enabledLocales.map((l) => `${l.name} [${l.locale}]`).join(", ")}`
    );
    console.log("\n=======================================================\n");
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("\n❌ SOURCE CONNECTION FAILED:\n", message);
    process.exit(1);
  }
}

// Run if called as entry point
if (process.argv[1]?.endsWith("check-source.ts") || process.argv[1]?.endsWith("check-source.js")) {
  void run();
}
