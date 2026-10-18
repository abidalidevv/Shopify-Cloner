/**
 * Section 6: Manual Configuration Checklist Generator.
 *
 * Produces reports/manual-checklist.md with exact click-by-click instructions
 * and markdown checkboxes for everything the API cannot transfer.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { logger } from "../logger.js";

export function generateManualChecklist(reportsDir = "reports"): void {
  fs.mkdirSync(reportsDir, { recursive: true });

  const md = `# Manual Configuration Checklist (TibbeShifa Migration)

> Follow this checklist after theme push and data migration to finish setting up the destination store.

---

### 1. Payment Providers & Cash on Delivery (COD)
- [ ] Go to **Settings > Payments** on destination store.
- [ ] Configure manual payment method: **Cash on Delivery (COD)** with instructions: "Pay with cash upon delivery".
- [ ] Set transaction fee and currency preferences (PKR).

### 2. Apps Reinstallation & Settings
- [ ] **COD King**: Install from Shopify App Store; copy OTP / SMS verification settings from source store.
- [ ] **Judge.me Product Reviews**:
  - [ ] Install Judge.me on destination store.
  - [ ] On source store Judge.me dashboard: export reviews CSV.
  - [ ] On destination store Judge.me dashboard: import reviews CSV.
  - [ ] Enable review widget & star ratings app embeds in theme editor.
- [ ] **Facebook & Instagram**: Connect Meta Business Account and assign Meta Pixel.
- [ ] **TikTok**: Connect TikTok for Business account and verify TikTok Pixel.

### 3. Theme Editor & App Embeds
- [ ] Open **Online Store > Themes > Customize** (Horizon Theme).
- [ ] Check **App Embeds** tab (left sidebar):
  - [ ] Enable Judge.me core snippet.
  - [ ] Enable WhatsApp floating chat / order button.
  - [ ] Enable COD King quick order button.
- [ ] Verify **Header & Footer**:
  - [ ] Main Menu is attached to header navigation.
  - [ ] Footer Menu is attached to footer.
  - [ ] Urdu logo and announcements are rendering cleanly.

### 4. Custom Product Templates Verification (All 7 Products)
- [ ] **Product 1 Template**: Verify buy button, images, Urdu description, WhatsApp link.
- [ ] **Product 2 Template**: Verify template suffix matches and renders custom sections.
- [ ] **Product 3 Template**: Verify template suffix matches and renders custom sections.
- [ ] **Product 4 Template**: Verify template suffix matches and renders custom sections.
- [ ] **Product 5 Template**: Verify template suffix matches and renders custom sections.
- [ ] **Product 6 Template**: Verify template suffix matches and renders custom sections.
- [ ] **Product 7 Template**: Verify template suffix matches and renders custom sections.

### 5. Final Domain Transfer Plan (After 100% Acceptance Sign-off)
- [ ] Verify destination store preview in mobile and desktop browsers.
- [ ] Place one real test order via Cash on Delivery to confirm end-to-end checkout flow.
- [ ] In destination store admin: go to **Settings > Domains**.
- [ ] Click **Connect existing domain** and type \`tibbeshifa.com\`.
- [ ] Update DNS records (A record to Shopify's IP \`23.227.38.65\`, CNAME to \`shops.myshopify.com\`).
- [ ] Verify SSL certificate generation (takes ~15 minutes).
- [ ] Keep source store active in read-only state for at least 14 days before archiving.
`;

  const outPath = path.join(reportsDir, "manual-checklist.md");
  fs.writeFileSync(outPath, md, "utf8");
  logger.info(`Manual checklist report generated at ${outPath}`);
}
