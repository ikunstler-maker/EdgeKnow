import "server-only";
import { SignJWT, importJWK, type JWK } from "jose";

// EdgeKnow as a sign-in provider for the teams' own Supabase projects (path C).
// A team project adds our issuer URL as a "Custom OIDC" third-party auth
// integration; from then on it trusts tokens we sign and reads the person from
// "sub". The private key never leaves our server: projects fetch the public half
// from /oidc/jwks.
//
// EDGEKNOW_OIDC_SIGNING_KEYS is a JSON array of private ES256 JWKs. The first one
// signs; all of them stay published, so a key can be replaced without breaking
// tokens already handed out.

const TOKEN_SECONDS = 10 * 60;

type PrivateJwk = JWK & { kid: string; d: string };

function signingKeys(): PrivateJwk[] {
  try {
    const keys = JSON.parse(process.env.EDGEKNOW_OIDC_SIGNING_KEYS ?? "[]") as PrivateJwk[];
    return Array.isArray(keys) ? keys.filter((k) => k?.kty === "EC" && k.crv === "P-256" && k.kid && k.d) : [];
  } catch {
    return [];
  }
}

export const oidcConfigured = () => signingKeys().length > 0;

// The issuer must never change once teams trust it: on Vercel it is the
// production address, whatever deployment serves the request.
export function oidcIssuer(requestOrigin: string): string {
  if (process.env.EDGEKNOW_OIDC_ISSUER) return process.env.EDGEKNOW_OIDC_ISSUER.replace(/\/$/, "");
  if (process.env.VERCEL_PROJECT_PRODUCTION_URL) return `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}/oidc`;
  return `${requestOrigin}/oidc`;
}

// Public halves only: never "d".
export function publicJwks() {
  return {
    keys: signingKeys().map(({ kty, crv, x, y, kid }) => ({ kty, crv, x, y, kid, alg: "ES256", use: "sig" })),
  };
}

// A short-lived token for one person, for one workspace's own database: team
// databases refuse it anywhere else (ek_workspace, checked by edgeknow_guard).
// Always the plain "authenticated" role: nothing here can mint an admin token,
// and team databases refuse one from us anyway.
export async function mintTeamToken(issuer: string, person: { id: string; email: string }, workspaceId: string) {
  return mint(issuer, person, { ek_workspace: workspaceId });
}

// Only for the platform admin's live check of a project not connected to any
// workspace yet: marked as a check, and with no workspace no team database accepts it.
export async function mintCheckToken(issuer: string, person: { id: string; email: string }) {
  return mint(issuer, person, { ek_purpose: "check" });
}

async function mint(issuer: string, person: { id: string; email: string }, claims: Record<string, string>) {
  const [current] = signingKeys();
  if (!current) throw new Error("oidc not configured");
  const { kty, crv, x, y, d, kid } = current;
  const key = await importJWK({ kty, crv, x, y, d }, "ES256");
  const now = Math.floor(Date.now() / 1000);
  const token = await new SignJWT({ role: "authenticated", email: person.email, ...claims })
    .setProtectedHeader({ alg: "ES256", kid, typ: "JWT" })
    .setIssuer(issuer)
    .setSubject(person.id)
    .setAudience("authenticated")
    .setIssuedAt(now)
    .setExpirationTime(now + TOKEN_SECONDS)
    .sign(key);
  return { token, expiresAt: now + TOKEN_SECONDS };
}
