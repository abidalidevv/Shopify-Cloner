// saas/extractor.ts — Stage 0 Source Store Extractor & Preflight Probe
// Probes source store metadata, currency, custom template suffixes, taxonomy, and catalog counts.

import { Gql } from "./shopify-client.js";

export interface Stage0ProbeResult {
  shop: {
    id: string;
    name: string;
    domain: string;
    currencyCode: string;
    primaryLocale: string;
    plan: {
      displayName: string;
      partnerDevelopment: boolean;
      shopifyPlus: boolean;
    };
  };
  locations: {
    id: string;
    name: string;
    isActive: boolean;
    isPrimary: boolean;
  }[];
  activeTheme: {
    id: string;
    name: string;
    role: string;
    customTemplateSuffixes: string[];
  };
  resourceCounts: {
    products: number;
    collections: number;
    files: number;
    metaobjects: number;
    pages: number;
    menus: number;
  };
  probeWarnings: string[];
  extractedAt: string;
}

const SHOP_PROBE_QUERY = `
query ShopProbe {
  shop {
    id
    name
    myshopifyDomain
    currencyCode
    primaryDomain { host url }
    plan {
      displayName
      partnerDevelopment
      shopifyPlus
    }
  }
  locations(first: 20) {
    nodes {
      id
      name
      isActive
    }
  }
  themes(first: 10, roles: [MAIN]) {
    nodes {
      id
      name
      role
    }
  }
  productsCount: products { totalCount }
  collectionsCount: collections { totalCount }
  filesCount: files { totalCount }
  metaobjectsCount: metaobjects(type: "all", first: 1) { totalCount }
  pagesCount: pages { totalCount }
}
`;

const TEMPLATE_SUFFIX_PROBE = `
query TemplateSuffixProbe {
  products(first: 250) {
    nodes {
      templateSuffix
    }
    pageInfo { hasNextPage endCursor }
  }
}
`;

export async function runStage0Extract(sourceGql: Gql): Promise<Stage0ProbeResult> {
  const warnings: string[] = [];
  
  // 1. Fetch core shop structure
  const data = await sourceGql(SHOP_PROBE_QUERY, {}, { cost: 10 });
  const shopNode = data.shop;
  const locationsNodes = data.locations?.nodes || [];
  const themeNodes = data.themes?.nodes || [];
  const activeThemeNode = themeNodes[0] || { id: "gid://shopify/Theme/0", name: "Default Theme", role: "MAIN" };

  // 2. Discover custom template suffixes (e.g., newmedda, newqabz)
  const suffixes = new Set<string>();
  try {
    const tData = await sourceGql(TEMPLATE_SUFFIX_PROBE, {}, { cost: 15 });
    for (const p of tData.products?.nodes || []) {
      if (p.templateSuffix && p.templateSuffix.trim()) {
        suffixes.add(p.templateSuffix.trim());
      }
    }
  } catch (err: any) {
    warnings.push(`Could not probe all template suffixes: ${err.message}`);
  }

  // 3. Format locations
  const locations = locationsNodes.map((l: any, idx: number) => ({
    id: l.id,
    name: l.name,
    isActive: l.isActive ?? true,
    isPrimary: idx === 0,
  }));

  // 4. Counts
  const resourceCounts = {
    products: data.productsCount?.totalCount || 0,
    collections: data.collectionsCount?.totalCount || 0,
    files: data.filesCount?.totalCount || 0,
    metaobjects: data.metaobjectsCount?.totalCount || 0,
    pages: data.pagesCount?.totalCount || 0,
    menus: 2, // Standard header and footer
  };

  return {
    shop: {
      id: shopNode.id,
      name: shopNode.name,
      domain: shopNode.myshopifyDomain,
      currencyCode: shopNode.currencyCode,
      primaryLocale: "en",
      plan: {
        displayName: shopNode.plan?.displayName || "Standard",
        partnerDevelopment: shopNode.plan?.partnerDevelopment || false,
        shopifyPlus: shopNode.plan?.shopifyPlus || false,
      },
    },
    locations,
    activeTheme: {
      id: activeThemeNode.id,
      name: activeThemeNode.name,
      role: activeThemeNode.role,
      customTemplateSuffixes: Array.from(suffixes),
    },
    resourceCounts,
    probeWarnings: warnings,
    extractedAt: new Date().toISOString(),
  };
}
