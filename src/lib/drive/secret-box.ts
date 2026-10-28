import "server-only";
import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

// Encrypts the Drive access token before it goes into the database (AES-256-GCM)
// and signs the OAuth "state" so a connect request can't be forged. The key comes
// from the DRIVE_TOKEN_KEY environment variable (any long random text).
function key(purpose: string) {
  const secret = process.env.DRIVE_TOKEN_KEY;
  if (!secret || secret.length < 24) throw new Error("DRIVE_TOKEN_KEY is not set");
  return createHash("sha256").update(`${purpose}:${secret}`).digest();
}

export function encrypt(text: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key("encrypt"), iv);
  const body = Buffer.concat([cipher.update(text, "utf8"), cipher.final()]);
  return ["v1", iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), body.toString("base64url")].join(".");
}

export function decrypt(value: string): string {
  const [version, iv, tag, body] = value.split(".");
  if (version !== "v1" || !iv || !tag || !body) throw new Error("bad token format");
  const decipher = createDecipheriv("aes-256-gcm", key("encrypt"), Buffer.from(iv, "base64url"));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(body, "base64url")), decipher.final()]).toString("utf8");
}

export function sign(payload: object): string {
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const mac = createHmac("sha256", key("state")).update(body).digest("base64url");
  return `${body}.${mac}`;
}

export function verify<T>(value: string): T | null {
  const [body, mac] = value.split(".");
  if (!body || !mac) return null;
  const expected = createHmac("sha256", key("state")).update(body).digest();
  const given = Buffer.from(mac, "base64url");
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  try {
    return JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as T;
  } catch {
    return null;
  }
}
