import "server-only";
import { createHash, randomBytes } from "node:crypto";

// The Supabase Management API on behalf of a workspace owner (path C, step 1.5):
// OAuth sign-in to Supabase, then creating or picking the team's project and
// setting it up. SUPABASE_OAUTH_CLIENT_ID / _SECRET come from the wiki's OAuth app.

const API = "https://api.supabase.com";

export class SupabaseApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

export const supabaseOAuthConfigured = () =>
  Boolean(process.env.SUPABASE_OAUTH_CLIENT_ID && process.env.SUPABASE_OAUTH_CLIENT_SECRET);

// The callback address registered in the OAuth app: always the production site on Vercel.
export function supabaseCallbackUrl(requestOrigin: string) {
  const base = process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : requestOrigin;
  return `${base}/api/supabase/callback`;
}

export function pkcePair() {
  const verifier = randomBytes(32).toString("base64url");
  return { verifier, challenge: createHash("sha256").update(verifier).digest("base64url") };
}

export function authorizeUrl(redirectUri: string, state: string, challenge: string) {
  const params = new URLSearchParams({
    client_id: process.env.SUPABASE_OAUTH_CLIENT_ID ?? "",
    redirect_uri: redirectUri,
    response_type: "code",
    state,
    code_challenge: challenge,
    code_challenge_method: "S256",
  });
  return `${API}/v1/oauth/authorize?${params}`;
}

export type OAuthTokens = { accessToken: string; refreshToken: string; expiresAt: number };

async function tokenRequest(fields: Record<string, string>): Promise<OAuthTokens> {
  const basic = Buffer.from(`${process.env.SUPABASE_OAUTH_CLIENT_ID}:${process.env.SUPABASE_OAUTH_CLIENT_SECRET}`).toString("base64");
  const response = await fetch(`${API}/v1/oauth/token`, {
    method: "POST",
    headers: { Authorization: `Basic ${basic}`, "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body: new URLSearchParams(fields),
    signal: AbortSignal.timeout(15_000),
    cache: "no-store",
  });
  const json = (await response.json().catch(() => ({}))) as { access_token?: string; refresh_token?: string; expires_in?: number };
  if (!response.ok || !json.access_token || !json.refresh_token) throw new SupabaseApiError("token request failed", response.status);
  return { accessToken: json.access_token, refreshToken: json.refresh_token, expiresAt: Date.now() + (json.expires_in ?? 3600) * 1000 };
}

export const exchangeCode = (code: string, redirectUri: string, verifier: string) =>
  tokenRequest({ grant_type: "authorization_code", code, redirect_uri: redirectUri, code_verifier: verifier });

// Supabase rotates refresh tokens: the new one must be stored after each refresh.
export const refreshTokens = (refreshToken: string) => tokenRequest({ grant_type: "refresh_token", refresh_token: refreshToken });

async function call<T>(accessToken: string, path: string, init: RequestInit = {}, timeoutMs = 30_000): Promise<T> {
  const response = await fetch(`${API}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json", ...(init.headers as Record<string, string>) },
    signal: AbortSignal.timeout(timeoutMs),
    cache: "no-store",
  });
  const text = await response.text();
  if (!response.ok) throw new SupabaseApiError(`${path}: HTTP ${response.status} ${text.slice(0, 200)}`, response.status);
  return (text ? JSON.parse(text) : null) as T;
}

export type Organization = { id: string; slug: string; name: string };
export type Project = { id: string; ref: string; organization_slug?: string; name: string; region: string; status: string };
export type ApiKey = { api_key: string | null; type: "legacy" | "publishable" | "secret" | null; name: string };
export type ThirdPartyAuth = { id: string; oidc_issuer_url: string | null };

export const supabaseApi = (accessToken: string) => ({
  organizations: () => call<Organization[]>(accessToken, "/v1/organizations"),
  projects: () => call<Project[]>(accessToken, "/v1/projects"),
  project: (ref: string) => call<Project>(accessToken, `/v1/projects/${ref}`),
  createProject: (input: { name: string; organizationSlug: string; region: string; dbPass: string }) =>
    call<Project>(accessToken, "/v1/projects", {
      method: "POST",
      body: JSON.stringify({
        name: input.name,
        organization_slug: input.organizationSlug,
        db_pass: input.dbPass,
        region_selection: { type: "specific", code: input.region },
      }),
    }),
  apiKeys: (ref: string) => call<ApiKey[]>(accessToken, `/v1/projects/${ref}/api-keys?reveal=true`),
  createSecretKey: (ref: string) =>
    call<ApiKey>(accessToken, `/v1/projects/${ref}/api-keys?reveal=true`, {
      method: "POST",
      body: JSON.stringify({ type: "secret", name: "edgeknow", description: "EdgeKnow server (path C)" }),
    }),
  // SQL as the database owner; returns the rows of the last statement.
  query: <T = Record<string, unknown>>(ref: string, sql: string) =>
    call<T[]>(accessToken, `/v1/projects/${ref}/database/query`, { method: "POST", body: JSON.stringify({ query: sql }) }, 120_000),
  thirdPartyAuth: (ref: string) => call<ThirdPartyAuth[]>(accessToken, `/v1/projects/${ref}/config/auth/third-party-auth`),
  addOidcIssuer: (ref: string, issuer: string) =>
    call<ThirdPartyAuth>(accessToken, `/v1/projects/${ref}/config/auth/third-party-auth`, {
      method: "POST",
      body: JSON.stringify({ oidc_issuer_url: issuer }),
    }),
  restore: (ref: string) => call<unknown>(accessToken, `/v1/projects/${ref}/restore`, { method: "POST" }),
});
