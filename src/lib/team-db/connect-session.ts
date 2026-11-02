import "server-only";
import { cookies } from "next/headers";
import { decrypt, encryptTeam } from "@/lib/drive/secret-box";

// Between signing in to Supabase and choosing the project, the owner's Supabase
// access waits in an encrypted, short-lived cookie (never readable by the page).
const COOKIE = "ek-sb-connect";
const TTL_SECONDS = 15 * 60;

type Session = { ws: string; u: string; refreshToken: string; exp: number };

export async function saveConnectSession(session: Omit<Session, "exp">) {
  (await cookies()).set(COOKIE, encryptTeam(JSON.stringify({ ...session, exp: Date.now() + TTL_SECONDS * 1000 })), {
    path: "/",
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: TTL_SECONDS,
  });
}

export async function readConnectSession(ws: string, userId: string): Promise<Session | null> {
  const value = (await cookies()).get(COOKIE)?.value;
  if (!value) return null;
  try {
    const session = JSON.parse(decrypt(value)) as Session;
    return session.ws === ws && session.u === userId && session.exp > Date.now() ? session : null;
  } catch {
    return null;
  }
}

export async function clearConnectSession() {
  (await cookies()).delete(COOKIE);
}
