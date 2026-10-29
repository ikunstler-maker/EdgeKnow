import { NextResponse, type NextRequest } from "next/server";
import { deleteMyAccount } from "@/lib/my-data";
import { overLimit, tooManyRequests } from "@/lib/rate-limit";
import { createClient } from "@/lib/supabase/server";

// "Delete my account": only after typing one's own email.
export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const userId = data?.claims?.sub;
  if (!userId) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  if (await overLimit(supabase, "export")) return tooManyRequests();
  const body = (await request.json().catch(() => ({}))) as { confirm?: unknown };
  const { data: profile } = await supabase.from("profiles").select("email").eq("id", userId).maybeSingle();
  if (!profile || typeof body.confirm !== "string" || body.confirm.trim().toLowerCase() !== profile.email.toLowerCase()) {
    return NextResponse.json({ ok: false, error: "confirm_mismatch" }, { status: 400 });
  }
  const result = await deleteMyAccount(String(userId));
  if (!result.ok) return NextResponse.json(result, { status: 409 });
  await supabase.auth.signOut();
  return NextResponse.json({ ok: true });
}
