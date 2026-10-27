import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";

// Google → Supabase → here. Exchanges the one-time code for a session cookie.
export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl;
  const code = searchParams.get("code");

  if (!code) {
    // Supabase sends `error` here when the Before User Created hook rejects the domain.
    const reason = searchParams.get("error") ? "domain_not_allowed" : "signin_failed";
    return NextResponse.redirect(`${origin}/no-access?reason=${reason}`);
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) {
    return NextResponse.redirect(`${origin}/no-access?reason=signin_failed`);
  }

  // Existing users whose domain was removed later still get a session from Google;
  // drop it right away instead of leaving them signed in to a locked app.
  const { data: allowed } = await supabase.rpc("is_allowed_user");
  if (!allowed) {
    await supabase.auth.signOut();
    return NextResponse.redirect(`${origin}/no-access?reason=domain_not_allowed`);
  }

  return NextResponse.redirect(`${origin}/`);
}
