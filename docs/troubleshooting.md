# Troubleshooting & Migration Limitations Guide

This guide covers common Shopify API errors, resolution steps, and a definitive list of resources that Shopify does not allow transferring via API.

---

## 1. Common Shopify Errors & Solutions

### `shop_not_permitted`
- **Cause:** Attempting to use Client Credentials grant (Mode A) when the Dev Dashboard app and the store are under different Shopify organizations or emails.
- **Solution:** Use Mode B (OAuth authorization code flow) by running `npm run setup`. It starts a local listener on `http://localhost:3456/callback` for cross-organization installation.

### `invalid_request` (OAuth scope error)
- **Cause:** Scopes requested by the local app do not match the scopes published in the released App Version in Dev Dashboard.
- **Solution:**
  1. Open your Dev Dashboard app: `https://dev.shopify.com/dashboard/231819379/apps/434940084225/versions`.
  2. Ensure a version (e.g. `tibbeshifa-migrator-source-re-1`) is **Active/Released**.
  3. Ensure `read_online_store_navigation` is selected (Shopify's official name for navigation scopes).

### `THROTTLED` / Rate Limit Exceeded
- **Cause:** GraphQL query cost consumed the store's leak bucket (standard Shopify limit is 50-100 points/second).
- **Solution:** The tool includes cost-aware throttling in `src/client.ts` and exponential backoff in `src/retry.ts`. It automatically pauses and resumes once the query bucket refills.

### `403 Access Denied` on Orders / Customers
- **Cause:** Shopify restricts access to protected customer personal data (names, emails, phone numbers) and orders older than 60 days without special approval (`read_all_orders`).
- **Solution:** The tool catches this gracefully, logs the missing scope to `reports/01-inaccessible.md`, and continues auditing the remaining resources without crashing.

### `WriteBlockedError: Mutation blocked on source profile`
- **Cause:** A mutation was attempted while targeting the source store or while in dry-run mode.
- **Solution:** This is an intentional security guard. The source store is permanently read-only. Mutations are only permitted on the destination store when `DRY_RUN=false` and `--apply` is explicitly passed.

---

## 2. Definitive List of What Shopify Does NOT Allow Migrating

The following items cannot be transferred via Shopify's Admin API and must be handled manually or archived locally:

1. **Customer Passwords:**
   Shopify securely hashes passwords. They cannot be exported or imported via any API. Customers must use Shopify's "Forgot Password" or account invite flow on the new store.

2. **Historical Order Financial States:**
   Orders created via API cannot reproduce historical credit card authorizations, gateway transactions, or historical timestamps without financial distortion.
   - **Resolution:** Orders are losslessly exported to local `backups/source-store/json/orders.json` for tax/record-keeping archives.

3. **Theme Files Upsert Exemption (`themeFilesUpsert`):**
   Shopify restricts direct theme file uploads via Admin API to apps with special exemptions.
   - **Resolution:** The tool uses official Shopify CLI (`shopify theme pull` and `shopify theme push --unpublished`) instead of restricted APIs.

4. **Third-Party App Configurations & Reviews:**
   - **Judge.me Reviews:** Reviews are managed on Judge.me's servers. Export CSV from source Judge.me dashboard and import into destination Judge.me dashboard.
   - **COD King Settings:** OTP verification, delivery rules, and SMS gateways must be configured in the destination app settings.
   - **Meta Pixel & TikTok Pixels:** Must be connected via the respective sales channel apps.

5. **Live Domain & DNS Records (`tibbeshifa.com`):**
   Domains must never be touched by migration scripts. The store owner will manually update DNS records after full acceptance sign-off.
