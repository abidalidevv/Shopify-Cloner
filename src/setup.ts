/**
 * Setup Wizard for Shopify Dev Dashboard OAuth Authorization.
 *
 * Usage:
 *   npm run setup
 */

import { loadConfig } from "./config.js";
import { runLocalOAuthServer, SOURCE_READ_SCOPES } from "./oauth.js";
import { checkSourceIdentity } from "./check-source.js";

async function main(): Promise<void> {
  console.log("\n=======================================================");
  console.log(" TibbeShifa Migrator — Phase 2 Setup & Identity Check");
  console.log("=======================================================\n");

  const config = loadConfig();

  // If token is already present, verify connection immediately
  if (config.source.adminToken) {
    console.log("Found existing SOURCE_ADMIN_TOKEN in .env. Verifying identity...\n");
    const shop = await checkSourceIdentity();
    printShopInfo(shop);
    return;
  }

  // If Client ID & Secret are provided in .env, start OAuth authorization flow
  if (config.source.clientId && config.source.clientSecret) {
    console.log("Starting local OAuth authorization server for SOURCE store...\n");
    await runLocalOAuthServer({
      shop: config.source.shop,
      clientId: config.source.clientId,
      clientSecret: config.source.clientSecret,
      scopes: SOURCE_READ_SCOPES,
      role: "source",
    });

    console.log("\nToken obtained. Checking store identity...\n");
    const shop = await checkSourceIdentity();
    printShopInfo(shop);
    return;
  }

  // If neither is present, prompt the user with instructions
  console.log("No credentials found in .env yet.");
  console.log(`Target source store: ${config.source.shop}\n`);
  console.log("Please add your Dev Dashboard App credentials to .env:");
  console.log("   SOURCE_SHOP=your-store.myshopify.com");
  console.log("   SOURCE_CLIENT_ID=your_client_id");
  console.log("   SOURCE_CLIENT_SECRET=your_client_secret");
  console.log("\nThen run `npm run setup` again to authorize.");
}

function printShopInfo(shop: {
  name: string;
  myshopifyDomain: string;
  currencyCode: string;
  plan: { displayName: string; shopifyPlus: boolean };
  primaryLocale: { name: string; locale: string };
  enabledLocales: Array<{ name: string; locale: string }>;
}): void {
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
}

void main();
