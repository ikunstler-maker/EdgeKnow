import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";

// POST only, so a link or prefetch can't sign someone out. Only this device:
// other devices are ended from Profile → My devices.
export async function POST(request: NextRequest) {
  const supabase = await createClient();
  await supabase.auth.signOut({ scope: "local" });
  return NextResponse.redirect(`${request.nextUrl.origin}/login`, { status: 303 });
}
