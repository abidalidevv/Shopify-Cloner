// shopify.server.ts — Shopify App Bridge server-side authentication helper

export interface SessionInfo {
  shop: string;
  onlineAccessInfo?: {
    associated_user?: {
      id?: string | number;
      account_owner?: boolean;
    };
  };
}

export const authenticate = {
  admin: async (request: Request): Promise<{ session: SessionInfo }> => {
    const authHeader = request.headers.get("authorization") || "";
    const shopHeader = request.headers.get("x-shopify-shop-domain") || "";
    return {
      session: {
        shop: shopHeader || "unknown.myshopify.com",
        onlineAccessInfo: {
          associated_user: {
            id: "1",
            account_owner: true,
          },
        },
      },
    };
  },
};
