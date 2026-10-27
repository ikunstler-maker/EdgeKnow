import { NextResponse, type NextRequest } from "next/server";
import { NEXT_PATH_COOKIE, safeNextPath } from "@/lib/paths";
import { createClient } from "@/lib/supabase/server";

// Google → Supabase → here. Exchanges the one-time code for a session cookie,
// joins the workspaces the email qualifies for and continues where the user was going.
export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl;
  const code = searchParams.get("code");

  const finish = (path: string) => {
    const response = NextResponse.redirect(`${origin}${path}`);
    response.cookies.delete(NEXT_PATH_COOKIE);
    return response;
  };

  if (!code) {
    // Supabase sends `error` here when the Before User Created hook rejects the account.
    const reason = searchParams.get("error") ? "domain_not_allowed" : "signin_failed";
    return finish(`/no-access?reason=${reason}`);
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) {
    return finish("/no-access?reason=signin_failed");
  }

  // Automatic joining by domain and accepting invitations happen on every sign-in.
  await supabase.rpc("join_workspaces");

  // No workspace and registration closed: drop the session right away.
  const { data: allowed } = await supabase.rpc("has_platform_access");
  if (!allowed) {
    await supabase.auth.signOut();
    return finish("/no-access?reason=domain_not_allowed");
  }

  return finish(safeNextPath(request.cookies.get(NEXT_PATH_COOKIE)?.value) ?? "/");
}
