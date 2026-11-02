import "server-only";
import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

// Secrets kept in the database are encrypted here (AES-256-GCM), and the OAuth
// "state" is signed so a connect request can't be forged.
//
// Two keys, from environment variables (any long random text):
// - DRIVE_TOKEN_KEY: Google Drive accesses, the "state" signature, and anything
//   written before TEAM_DB_KEY existed ("v1.…");
// - TEAM_DB_KEY: the team databases' secret key, address and Supabase access, and
//   the setup session ("v2.team.…"). Without it these fall back to v1, so nothing
//   breaks before it is added; with it, v1 values are rekeyed (see rekeyTeamSecrets).
function keyOf(secretName: "DRIVE_TOKEN_KEY" | "TEAM_DB_KEY", purpose: string) {
  const secret = process.env[secretName];
  if (!secret || secret.length < 24) throw new Error(`${secretName} is not set`);
  return createHash("sha256").update(`${purpose}:${secret}`).digest();
}

const teamKeyConfigured = () => (process.env.TEAM_DB_KEY ?? "").length >= 24;

function seal(text: string, key: Buffer, prefix: string[]) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const body = Buffer.concat([cipher.update(text, "utf8"), cipher.final()]);
  return [...prefix, iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), body.toString("base64url")].join(".");
}

function open(iv: string, tag: string, body: string, key: Buffer) {
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(iv, "base64url"));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(body, "base64url")), decipher.final()]).toString("utf8");
}

// Google Drive accesses (and the old format of everything).
export function encrypt(text: string): string {
  return seal(text, keyOf("DRIVE_TOKEN_KEY", "encrypt"), ["v1"]);
}

// Secrets of the team databases: their own key when it is set.
export function encryptTeam(text: string): string {
  return teamKeyConfigured() ? seal(text, keyOf("TEAM_DB_KEY", "encrypt"), ["v2", "team"]) : encrypt(text);
}

// Reads either format; the prefix says which key.
export function decrypt(value: string): string {
  const parts = value.split(".");
  if (parts[0] === "v1" && parts.length === 4) return open(parts[1], parts[2], parts[3], keyOf("DRIVE_TOKEN_KEY", "encrypt"));
  if (parts[0] === "v2" && parts[1] === "team" && parts.length === 5) return open(parts[2], parts[3], parts[4], keyOf("TEAM_DB_KEY", "encrypt"));
  throw new Error("bad token format");
}

// A team secret still under the old key while the new one is there.
export const needsTeamRekey = (value: string | null | undefined) => Boolean(value) && teamKeyConfigured() && value!.startsWith("v1.");
export const isTeamKeyed = (value: string | null | undefined) => Boolean(value?.startsWith("v2.team."));

// For moving back (rollback): the old key, whatever is configured.
export const encryptWithOldKey = encrypt;

export function sign(payload: object): string {
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const mac = createHmac("sha256", keyOf("DRIVE_TOKEN_KEY", "state")).update(body).digest("base64url");
  return `${body}.${mac}`;
}

export function verify<T>(value: string): T | null {
  const [body, mac] = value.split(".");
  if (!body || !mac) return null;
  const expected = createHmac("sha256", keyOf("DRIVE_TOKEN_KEY", "state")).update(body).digest();
  const given = Buffer.from(mac, "base64url");
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  try {
    return JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as T;
  } catch {
    return null;
  }
}
