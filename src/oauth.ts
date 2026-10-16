/**
 * Mode B: OAuth Authorization Code Grant with local loopback server.
 *
 * Implements the standard Shopify OAuth flow for apps across different organizations:
 * 1. Generates authorization URL for https://{shop}/admin/oauth/authorize
 * 2. Starts a local HTTP server on http://localhost:3456/callback
 * 3. Handles callback, validates state, and exchanges code for an offline access token
 * 4. Saves token to .env or passes to caller
 * 5. Closes server cleanly
 */

import * as http from "node:http";
import * as fs from "node:fs";
import * as crypto from "node:crypto";
import { logger } from "./logger.js";
import { redact } from "./redact.js";

export const DEFAULT_CALLBACK_PORT = 3456;
export const DEFAULT_CALLBACK_URL = `http://localhost:${DEFAULT_CALLBACK_PORT}/callback`;

export const SOURCE_READ_SCOPES = [
  "read_products",
  "read_files",
  "read_content",
  "read_themes",
  "read_online_store_navigation",
  "read_metaobjects",
  "read_metaobject_definitions",
  "read_translations",
  "read_locales",
  "read_customers",
  "read_orders",
  "read_draft_orders",
  "read_discounts",
  "read_price_rules",
  "read_inventory",
  "read_locations",
  "read_markets",
  "read_legal_policies",
  "read_shipping",
  "read_publications",
  "read_gift_cards",
  "customer_read_metaobjects",
];

export interface OAuthFlowOptions {
  shop: string;
  clientId: string;
  clientSecret: string;
  scopes?: string[];
  role: "source" | "destination";
  port?: number;
  envPath?: string;
}

/** Builds the Shopify OAuth authorization URL for the user to visit in their browser. */
export function buildAuthorizationUrl(
  shop: string,
  clientId: string,
  scopes: string[],
  redirectUri: string,
  state: string
): string {
  const cleanShop = shop.replace(/^https?:\/\//, "").replace(/\/.*$/, "");
  const params = new URLSearchParams({
    client_id: clientId,
    scope: scopes.join(","),
    redirect_uri: redirectUri,
    state,
  });
  return `https://${cleanShop}/admin/oauth/authorize?${params.toString()}`;
}

/** Updates or appends a key=value line in the .env file. */
export function saveTokenToEnv(envPath: string, key: string, value: string): void {
  let content = "";
  if (fs.existsSync(envPath)) {
    content = fs.readFileSync(envPath, "utf8");
  }

  const regex = new RegExp(`^${key}=.*$`, "m");
  if (regex.test(content)) {
    content = content.replace(regex, `${key}=${value}`);
  } else {
    if (content.length > 0 && !content.endsWith("\n")) {
      content += "\n";
    }
    content += `${key}=${value}\n`;
  }

  fs.writeFileSync(envPath, content, "utf8");
}

/**
 * Exchanges the one-time authorization code for an offline access token.
 */
export async function exchangeAuthCode(
  shop: string,
  clientId: string,
  clientSecret: string,
  code: string
): Promise<string> {
  const cleanShop = shop.replace(/^https?:\/\//, "").replace(/\/.*$/, "");
  const endpoint = `https://${cleanShop}/admin/oauth/access_token`;

  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Accept": "application/json",
    },
    body: JSON.stringify({
      client_id: clientId,
      client_secret: clientSecret,
      code,
    }),
  });

  if (!response.ok) {
    const errorBody = await response.text().catch(() => "");
    throw new Error(
      `OAuth token exchange failed (HTTP ${response.status}): ${redact(errorBody)}`
    );
  }

  const data = (await response.json()) as { access_token?: string };
  if (!data.access_token) {
    throw new Error("Shopify response did not contain an access_token");
  }

  return data.access_token;
}

/**
 * Starts the local callback server and waits for the browser OAuth redirect.
 * Returns the minted access token.
 */
export function runLocalOAuthServer(options: OAuthFlowOptions): Promise<string> {
  const port = options.port ?? DEFAULT_CALLBACK_PORT;
  const redirectUri = `http://localhost:${port}/callback`;
  const state = crypto.randomBytes(16).toString("hex");
  const scopes = options.scopes ?? SOURCE_READ_SCOPES;
  const envPath = options.envPath ?? ".env";

  const authUrl = buildAuthorizationUrl(
    options.shop,
    options.clientId,
    scopes,
    redirectUri,
    state
  );

  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      void (async (): Promise<void> => {
        try {
          const reqUrl = new URL(req.url ?? "/", `http://localhost:${port}`);
          if (reqUrl.pathname === "/") {
            res.writeHead(302, { Location: authUrl });
            res.end();
            return;
          }

          if (reqUrl.pathname !== "/callback") {
            res.writeHead(404, { "Content-Type": "text/plain" });
            res.end("Not Found");
            return;
          }

          const returnedState = reqUrl.searchParams.get("state");
          const code = reqUrl.searchParams.get("code");

          if (returnedState !== state) {
            res.writeHead(403, { "Content-Type": "text/html" });
            res.end("<h3>Authentication Failed: Invalid OAuth state parameter</h3>");
            server.close();
            reject(new Error("OAuth state mismatch: request may have been forged"));
            return;
          }

          if (!code) {
            const error = reqUrl.searchParams.get("error") ?? "Missing authorization code";
            res.writeHead(400, { "Content-Type": "text/html" });
            res.end(`<h3>Authentication Failed: ${error}</h3>`);
            server.close();
            reject(new Error(`OAuth error from Shopify: ${error}`));
            return;
          }

          // Exchange code for offline access token
          const token = await exchangeAuthCode(
            options.shop,
            options.clientId,
            options.clientSecret,
            code
          );

          // Save token to .env under SOURCE_ADMIN_TOKEN or DEST_ADMIN_TOKEN
          const envKey = options.role === "source" ? "SOURCE_ADMIN_TOKEN" : "DEST_ADMIN_TOKEN";
          saveTokenToEnv(envPath, envKey, token);

          // Also set in current process environment
          process.env[envKey] = token;

          res.writeHead(200, { "Content-Type": "text/html" });
          res.end(`
            <html>
              <body style="font-family: sans-serif; text-align: center; padding: 50px;">
                <h1 style="color: #2e7d32;">✅ Authentication Successful!</h1>
                <p>Access token has been safely saved to your local <code>.env</code> file.</p>
                <p>You can close this browser tab and return to the terminal.</p>
              </body>
            </html>
          `);

          logger.info(`OAuth flow complete for ${options.shop}. Token saved to ${envKey} in ${envPath}.`);
          server.close();
          resolve(token);
        } catch (err: unknown) {
          res.writeHead(500, { "Content-Type": "text/html" });
          res.end("<h3>Internal Server Error during token exchange</h3>");
          server.close();
          reject(err);
        }
      })();
    });

    server.listen(port, () => {
      logger.info(`Local OAuth listener running at ${redirectUri}`);
      logger.info(`Open this URL in your browser to authorize:\n${authUrl}`);
    });

    server.on("error", (err) => {
      reject(err);
    });
  });
}
