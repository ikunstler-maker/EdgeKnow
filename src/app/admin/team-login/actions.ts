"use server";

import { headers } from "next/headers";
import { SignJWT, generateKeyPair, importJWK } from "jose";
import { getCurrentUser } from "@/lib/auth";
import { mintTeamToken, oidcIssuer } from "@/lib/oidc";

// Live check of a team's Supabase project against our sign-in (platform admin only).
// Only *.supabase.co project addresses are called, never arbitrary hosts.
const PROJECT_URL = /^https:\/\/[a-z0-9]{20}\.supabase\.co$/;

export type CheckStep = { id: "accepted" | "identity" | "guard" | "forged"; ok: boolean; detail: string };

async function callWhoami(url: string, publishableKey: string, token: string) {
  const response = await fetch(`${url}/rest/v1/rpc/edgeknow_whoami`, {
    method: "POST",
    headers: { apikey: publishableKey, Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: "{}",
    signal: AbortSignal.timeout(8000),
    cache: "no-store",
  });
  const text = await response.text();
  return { status: response.status, text: text.slice(0, 300) };
}

// Tokens that must be refused: one claiming an admin role, signed with our real key
// (what a leaked key would allow), and one signed with a stranger's key.
async function probeToken(issuer: string, role: string, sub: string, useOurKey: boolean) {
  const now = Math.floor(Date.now() / 1000);
  const claims = new SignJWT({ role }).setIssuer(issuer).setSubject(sub).setAudience("authenticated").setIssuedAt(now).setExpirationTime(now + 120);
  if (useOurKey) {
    const [current] = JSON.parse(process.env.EDGEKNOW_OIDC_SIGNING_KEYS ?? "[]");
    const { kty, crv, x, y, d, kid } = current;
    return claims.setProtectedHeader({ alg: "ES256", kid, typ: "JWT" }).sign(await importJWK({ kty, crv, x, y, d }, "ES256"));
  }
  const { privateKey } = await generateKeyPair("ES256");
  return claims.setProtectedHeader({ alg: "ES256", kid: "stranger", typ: "JWT" }).sign(privateKey);
}

export async function checkTeamProject(input: { url: string; publishableKey: string }) {
  const user = await getCurrentUser();
  if (!user.isPlatformAdmin) return { ok: false as const, error: "forbidden" };
  const url = input.url.trim().replace(/\/$/, "");
  const publishableKey = input.publishableKey.trim();
  if (!PROJECT_URL.test(url) || !/^[A-Za-z0-9._-]{20,400}$/.test(publishableKey)) return { ok: false as const, error: "invalid" };

  const h = await headers();
  const issuer = oidcIssuer(`${h.get("x-forwarded-proto") ?? "https"}://${h.get("host")}`);
  const steps: CheckStep[] = [];
  try {
    const { token } = await mintTeamToken(issuer, user);
    const own = await callWhoami(url, publishableKey, token);
    steps.push({ id: "accepted", ok: own.status === 200, detail: `HTTP ${own.status} ${own.text}` });
    let uid = "";
    try {
      uid = (JSON.parse(own.text) as { uid?: string }).uid ?? "";
    } catch {}
    steps.push({ id: "identity", ok: uid === user.id, detail: uid || "—" });
    const admin = await callWhoami(url, publishableKey, await probeToken(issuer, "service_role", user.id, true));
    steps.push({ id: "guard", ok: admin.status === 401 || admin.status === 403, detail: `HTTP ${admin.status} ${admin.text}` });
    const forged = await callWhoami(url, publishableKey, await probeToken(issuer, "authenticated", user.id, false));
    steps.push({ id: "forged", ok: forged.status === 401, detail: `HTTP ${forged.status} ${forged.text}` });
  } catch (error) {
    return { ok: false as const, error: "unreachable", detail: String((error as Error).message).slice(0, 200), steps };
  }
  return { ok: true as const, steps };
}
