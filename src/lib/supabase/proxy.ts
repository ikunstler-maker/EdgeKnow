import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

// Routes reachable without an allowed session.
const PUBLIC_PATHS = ["/login", "/auth", "/no-access"];

function isPublicPath(pathname: string) {
  return PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request });

  // Create a new client per request; never cache it in a module-level variable.
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet, headers) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options),
          );
          Object.entries(headers).forEach(([key, value]) => response.headers.set(key, value));
        },
      },
    },
  );

  // Must run right after creating the client: it validates and refreshes the session.
  const { data } = await supabase.auth.getClaims();
  const signedIn = Boolean(data?.claims);
  const { pathname } = request.nextUrl;

  const redirectTo = (path: string) => {
    const url = request.nextUrl.clone();
    url.pathname = path;
    url.search = "";
    const redirect = NextResponse.redirect(url);
    // Keep refreshed auth cookies so the browser and server stay in sync.
    response.cookies.getAll().forEach((cookie) => redirect.cookies.set(cookie));
    return redirect;
  };

  if (!signedIn) {
    return isPublicPath(pathname) ? response : redirectTo("/login");
  }

  // Re-check the domain on every request, so a removed or disabled domain
  // locks its users out immediately instead of when their token expires.
  const { data: allowed } = await supabase.rpc("is_allowed_user");

  if (!allowed) {
    return pathname.startsWith("/no-access") || pathname.startsWith("/auth")
      ? response
      : redirectTo("/no-access");
  }

  if (pathname === "/login" || pathname.startsWith("/no-access")) {
    return redirectTo("/");
  }

  return response;
}
