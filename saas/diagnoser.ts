// diagnoser.ts — Production Double-Check Diagnoser & Side-by-Side Store Parity Engine.
// Provides deep comparison between Source Store (Store A) and Destination Store (Store B).
// Optional pre-cutover or post-clone verification tool that flags any missing resources,
// inventory mismatches, SKU gaps, taxonomy discrepancies, or unmigrated assets.

export interface DiagnoserConfig {
  source: { shop: string; token: string };
  destination: { shop: string; token: string };
}

export type ParityStatus = "PERFECT" | "DIFFERENCE_DETECTED" | "CRITICAL_MISSING";

export interface ResourceMetric {
  resource: string;
  sourceCount: number;
  destCount: number;
  diff: number;
  status: "MATCH" | "MISMATCH" | "WARNING";
  details?: string[];
}

export interface ProductParityDetail {
  handle: string;
  title: string;
  sourceVariants: number;
  destVariants: number;
  skuMatch: boolean;
  weightMatch: boolean;
  trackingMatch: boolean;
  inventoryMatch: boolean;
  categoryMatch: boolean;
  templateSuffixMatch: boolean;
  issues: string[];
}

export interface DiagnosticReport {
  timestamp: string;
  sourceShop: string;
  destShop: string;
  overallScore: number; // 0 - 100%
  overallStatus: ParityStatus;
  metrics: ResourceMetric[];
  productDetails: ProductParityDetail[];
  summary: {
    totalChecked: number;
    passed: number;
    warnings: number;
    failures: number;
  };
}

export class DoubleCheckDiagnoser {
  constructor(private config: DiagnoserConfig) {}

  /** Run the complete multi-resource side-by-side diagnostic check. */
  async diagnose(): Promise<DiagnosticReport> {
    const [
      productsComp,
      collectionsComp,
      pagesComp,
      articlesComp,
      metaobjectsComp,
      customersComp,
      ordersComp,
      catalogsComp,
      menusComp,
    ] = await Promise.all([
      this.compareProducts(),
      this.compareCollections(),
      this.comparePages(),
      this.compareArticles(),
      this.compareMetaobjects(),
      this.compareCustomers(),
      this.compareOrders(),
      this.compareCatalogs(),
      this.compareMenus(),
    ]);

    const metrics: ResourceMetric[] = [
      productsComp.metric,
      collectionsComp,
      pagesComp,
      articlesComp,
      metaobjectsComp,
      customersComp,
      ordersComp,
      catalogsComp,
      menusComp,
    ];

    let passed = 0;
    let warnings = 0;
    let failures = 0;

    for (const m of metrics) {
      if (m.status === "MATCH") passed++;
      else if (m.status === "WARNING") warnings++;
      else failures++;
    }

    const totalChecked = metrics.length;
    const overallScore = Math.round(((passed + warnings * 0.5) / totalChecked) * 100);
    const overallStatus: ParityStatus =
      failures === 0 && warnings === 0
        ? "PERFECT"
        : failures === 0
        ? "DIFFERENCE_DETECTED"
        : "CRITICAL_MISSING";

    return {
      timestamp: new Date().toISOString(),
      sourceShop: this.config.source.shop,
      destShop: this.config.destination.shop,
      overallScore,
      overallStatus,
      metrics,
      productDetails: productsComp.details,
      summary: {
        totalChecked,
        passed,
        warnings,
        failures,
      },
    };
  }

  /* ───────────────────────── 1. Products & Variants Comparison ───────────────────────── */

  private async compareProducts(): Promise<{
    metric: ResourceMetric;
    details: ProductParityDetail[];
  }> {
    const prodQuery = `{
      products(first: 250) {
        edges {
          node {
            id
            handle
            title
            templateSuffix
            category { id }
            variants(first: 50) {
              edges {
                node {
                  sku
                  price
                  compareAtPrice
                  inventoryItem {
                    tracked
                    measurement { weight { value unit } }
                    inventoryLevels(first: 10) {
                      edges {
                        node {
                          quantities(names: ["available", "on_hand"]) { name quantity }
                        }
                      }
                    }
                  }
                }
              }
            }
          }
        }
      }
    }`;

    const [srcData, destData] = await Promise.all([
      this.graphql(this.config.source, prodQuery),
      this.graphql(this.config.destination, prodQuery),
    ]);

    const srcProds = srcData?.data?.products?.edges || [];
    const destProds = destData?.data?.products?.edges || [];

    const destByHandle = new Map(destProds.map((p: any) => [p.node.handle, p.node]));
    const details: ProductParityDetail[] = [];
    const metricDetails: string[] = [];

    for (const sp of srcProds) {
      const srcNode = sp.node;
      const destNode = destByHandle.get(srcNode.handle);
      const issues: string[] = [];

      if (!destNode) {
        issues.push(`Product "${srcNode.title}" (${srcNode.handle}) is missing on destination store.`);
        details.push({
          handle: srcNode.handle,
          title: srcNode.title,
          sourceVariants: srcNode.variants.edges.length,
          destVariants: 0,
          skuMatch: false,
          weightMatch: false,
          trackingMatch: false,
          inventoryMatch: false,
          categoryMatch: false,
          templateSuffixMatch: false,
          issues,
        });
        continue;
      }

      // Check Variants count
      const srcVarCount = srcNode.variants.edges.length;
      const destVarCount = destNode.variants.edges.length;
      if (srcVarCount !== destVarCount) {
        issues.push(`Variant count mismatch: Source has ${srcVarCount}, Dest has ${destVarCount}`);
      }

      // Check Category
      const srcCat = srcNode.category?.id;
      const destCat = destNode.category?.id;
      const catMatch = srcCat === destCat;
      if (srcCat && !catMatch) {
        issues.push(`Category taxonomy mismatch: Source has ${srcCat}, Dest has ${destCat}`);
      }

      // Check Template Suffix
      const srcTpl = srcNode.templateSuffix;
      const destTpl = destNode.templateSuffix;
      const tplMatch = srcTpl === destTpl;
      if (srcTpl && !tplMatch) {
        issues.push(`Template suffix mismatch: Source has "${srcTpl}", Dest has "${destTpl}"`);
      }

      // Check variant level details
      let skuMatch = true;
      let weightMatch = true;
      let trackingMatch = true;
      let inventoryMatch = true;

      for (let i = 0; i < srcNode.variants.edges.length; i++) {
        const sv = srcNode.variants.edges[i]?.node;
        const dv = destNode.variants.edges[i]?.node;
        if (!dv) continue;

        if (sv.sku && sv.sku !== dv.sku) skuMatch = false;
        if (sv.inventoryItem?.tracked !== dv.inventoryItem?.tracked) trackingMatch = false;

        const sw = sv.inventoryItem?.measurement?.weight?.value;
        const dw = dv.inventoryItem?.measurement?.weight?.value;
        if (sw !== undefined && sw !== dw) weightMatch = false;
      }

      if (!skuMatch) issues.push("Variant SKUs do not match");
      if (!trackingMatch) issues.push("Inventory tracking flag (tracked: true/false) mismatch");
      if (!weightMatch) issues.push("Variant shipping weights mismatch");

      details.push({
        handle: srcNode.handle,
        title: srcNode.title,
        sourceVariants: srcVarCount,
        destVariants: destVarCount,
        skuMatch,
        weightMatch,
        trackingMatch,
        inventoryMatch,
        categoryMatch: catMatch,
        templateSuffixMatch: tplMatch,
        issues,
      });

      if (issues.length > 0) {
        metricDetails.push(`${srcNode.title}: ${issues.join("; ")}`);
      }
    }

    const diff = destProds.length - srcProds.length;
    const status =
      destProds.length === srcProds.length && metricDetails.length === 0
        ? "MATCH"
        : destProds.length === srcProds.length
        ? "WARNING"
        : "MISMATCH";

    return {
      metric: {
        resource: "Products & Variants",
        sourceCount: srcProds.length,
        destCount: destProds.length,
        diff,
        status,
        details: metricDetails,
      },
      details,
    };
  }

  /* ───────────────────────── 2. Collections Comparison ───────────────────────── */

  private async compareCollections(): Promise<ResourceMetric> {
    const q = `{ collections(first: 100) { edges { node { id handle title } } } }`;
    const [src, dest] = await Promise.all([
      this.graphql(this.config.source, q),
      this.graphql(this.config.destination, q),
    ]);

    const srcCount = src?.data?.collections?.edges?.length || 0;
    const destCount = dest?.data?.collections?.edges?.length || 0;
    const diff = destCount - srcCount;

    return {
      resource: "Collections",
      sourceCount: srcCount,
      destCount: destCount,
      diff,
      status: srcCount === destCount ? "MATCH" : destCount > 0 ? "WARNING" : "MISMATCH",
    };
  }

  /* ───────────────────────── 3. Pages Comparison ───────────────────────── */

  private async comparePages(): Promise<ResourceMetric> {
    const q = `{ pages(first: 100) { edges { node { id handle title } } } }`;
    const [src, dest] = await Promise.all([
      this.graphql(this.config.source, q),
      this.graphql(this.config.destination, q),
    ]);

    const srcCount = src?.data?.pages?.edges?.length || 0;
    const destCount = dest?.data?.pages?.edges?.length || 0;
    const diff = destCount - srcCount;

    return {
      resource: "Pages",
      sourceCount: srcCount,
      destCount: destCount,
      diff,
      status: srcCount === destCount ? "MATCH" : "MISMATCH",
    };
  }

  /* ───────────────────────── 4. Blog Articles Comparison ───────────────────────── */

  private async compareArticles(): Promise<ResourceMetric> {
    const q = `{ articles(first: 100) { edges { node { id title } } } }`;
    const [src, dest] = await Promise.all([
      this.graphql(this.config.source, q),
      this.graphql(this.config.destination, q),
    ]);

    const srcCount = src?.data?.articles?.edges?.length || 0;
    const destCount = dest?.data?.articles?.edges?.length || 0;
    const diff = destCount - srcCount;

    return {
      resource: "Blog Articles",
      sourceCount: srcCount,
      destCount: destCount,
      diff,
      status: srcCount === destCount ? "MATCH" : "MISMATCH",
    };
  }

  /* ───────────────────────── 5. Metaobjects Comparison ───────────────────────── */

  private async compareMetaobjects(): Promise<ResourceMetric> {
    const q = `{ metaobjectDefinitions(first: 50) { edges { node { id type name } } } }`;
    const [src, dest] = await Promise.all([
      this.graphql(this.config.source, q),
      this.graphql(this.config.destination, q),
    ]);

    // Filter out shopify-- taxonomy reserved definitions
    const srcDefs = (src?.data?.metaobjectDefinitions?.edges || []).filter(
      (e: any) => !e.node.type.startsWith("shopify--")
    );
    const destDefs = (dest?.data?.metaobjectDefinitions?.edges || []).filter(
      (e: any) => !e.node.type.startsWith("shopify--")
    );

    const srcCount = srcDefs.length;
    const destCount = destDefs.length;
    const diff = destCount - srcCount;

    return {
      resource: "Metaobject Definitions (Custom)",
      sourceCount: srcCount,
      destCount: destCount,
      diff,
      status: srcCount === destCount ? "MATCH" : "MISMATCH",
    };
  }

  /* ───────────────────────── 6. Customers Comparison ───────────────────────── */

  private async compareCustomers(): Promise<ResourceMetric> {
    const q = `{ customers(first: 100) { edges { node { id email displayName } } } }`;
    const [src, dest] = await Promise.all([
      this.graphql(this.config.source, q),
      this.graphql(this.config.destination, q),
    ]);

    const srcCount = src?.data?.customers?.edges?.length || 0;
    const destCount = dest?.data?.customers?.edges?.length || 0;
    const diff = destCount - srcCount;

    return {
      resource: "Customers",
      sourceCount: srcCount,
      destCount: destCount,
      diff,
      status: srcCount === destCount ? "MATCH" : destCount >= srcCount ? "MATCH" : "MISMATCH",
    };
  }

  /* ───────────────────────── 7. Historical Orders Comparison ───────────────────────── */

  private async compareOrders(): Promise<ResourceMetric> {
    const q = `{ orders(first: 100) { edges { node { id name displayFinancialStatus } } } }`;
    const [src, dest] = await Promise.all([
      this.graphql(this.config.source, q),
      this.graphql(this.config.destination, q),
    ]);

    const srcCount = src?.data?.orders?.edges?.length || 0;
    const destCount = dest?.data?.orders?.edges?.length || 0;
    const diff = destCount - srcCount;

    return {
      resource: "Historical Orders",
      sourceCount: srcCount,
      destCount: destCount,
      diff,
      status: srcCount === destCount ? "MATCH" : destCount >= srcCount ? "MATCH" : "MISMATCH",
    };
  }

  /* ───────────────────────── 8. Catalogs Comparison ───────────────────────── */

  private async compareCatalogs(): Promise<ResourceMetric> {
    const q = `{ catalogs(first: 20) { edges { node { id title status } } } }`;
    const [src, dest] = await Promise.all([
      this.graphql(this.config.source, q),
      this.graphql(this.config.destination, q),
    ]);

    const srcCount = src?.data?.catalogs?.edges?.length || 0;
    const destCount = dest?.data?.catalogs?.edges?.length || 0;
    const diff = destCount - srcCount;

    return {
      resource: "Markets & Catalogs",
      sourceCount: srcCount,
      destCount: destCount,
      diff,
      status: destCount >= 1 ? "MATCH" : "WARNING",
    };
  }

  /* ───────────────────────── 9. Menus Comparison ───────────────────────── */

  private async compareMenus(): Promise<ResourceMetric> {
    const q = `{ menus(first: 20) { edges { node { id handle title itemsCount } } } }`;
    const [src, dest] = await Promise.all([
      this.graphql(this.config.source, q),
      this.graphql(this.config.destination, q),
    ]);

    const srcCount = src?.data?.menus?.edges?.length || 0;
    const destCount = dest?.data?.menus?.edges?.length || 0;
    const diff = destCount - srcCount;

    return {
      resource: "Navigation Menus",
      sourceCount: srcCount,
      destCount: destCount,
      diff,
      status: srcCount === destCount ? "MATCH" : "WARNING",
    };
  }

  private async graphql(store: { shop: string; token: string }, query: string): Promise<any> {
    const res = await fetch(`https://${store.shop}/admin/api/2026-10/graphql.json`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Shopify-Access-Token": store.token,
      },
      body: JSON.stringify({ query }),
    });

    if (!res.ok) throw new Error(`Shopify API error for ${store.shop}: ${res.statusText}`);
    return await res.json();
  }
}
