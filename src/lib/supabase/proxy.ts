import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { LAST_WORKSPACE_COOKIE } from "@/lib/paths";
import { LOCALE_COOKIE, THEME_COOKIE, asLocale, asTheme } from "@/lib/preferences";

// Routes reachable without access to any workspace.
const PUBLIC_PATHS = ["/login", "/auth", "/no-access", "/invite"];
// Routes open to everyone, signed in or not (Google requires a public privacy policy;
// the cron route checks its own secret).
const ALWAYS_PUBLIC_PATHS = ["/privacy", "/api/cron/cleanup-files"];

function isPublicPath(pathname: string) {
  return PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

function workspaceIdFromPath(pathname: string): string | null {
  return pathname.match(/^\/w\/([a-z0-9]{8})(?:\/|$)/)?.[1] ?? null;
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
  const { pathname, search } = request.nextUrl;
  const workspaceId = workspaceIdFromPath(pathname);

  const redirectTo = (path: string, params?: Record<string, string>) => {
    const url = request.nextUrl.clone();
    url.pathname = path;
    url.search = params ? `?${new URLSearchParams(params)}` : "";
    const redirect = NextResponse.redirect(url);
    // Keep refreshed auth cookies so the browser and server stay in sync.
    response.cookies.getAll().forEach((cookie) => redirect.cookies.set(cookie));
    return redirect;
  };

  if (ALWAYS_PUBLIC_PATHS.includes(pathname)) {
    return response;
  }

  if (!signedIn) {
    if (isPublicPath(pathname)) return response;
    // Come back here after signing in; a workspace link also gives Google its domain hint.
    const params: Record<string, string> = {};
    if (pathname !== "/") params.next = pathname + search;
    if (workspaceId) params.w = workspaceId;
    return redirectTo("/login", params);
  }

  // Re-check on every request, so a removed member or a disabled domain loses
  // access immediately instead of when the session token expires.
  const { data: allowed } = await supabase.rpc("has_platform_access");

  if (!allowed) {
    return isPublicPath(pathname) && pathname !== "/login" ? response : redirectTo("/no-access");
  }

  if (pathname === "/login" || pathname.startsWith("/no-access")) {
    return redirectTo("/");
  }

  // On a new device the language and theme come from the profile once; from then
  // on the cookies carry them (and the page renders with them on this very request).
  if (!request.cookies.get(LOCALE_COOKIE) || !request.cookies.get(THEME_COOKIE)) {
    const { data: prefs } = await supabase
      .from("profiles")
      .select("theme, locale")
      .eq("id", String(data?.claims?.sub))
      .maybeSingle();
    const values = {
      [LOCALE_COOKIE]: request.cookies.get(LOCALE_COOKIE)?.value ?? asLocale(prefs?.locale) ?? "uk",
      [THEME_COOKIE]: request.cookies.get(THEME_COOKIE)?.value ?? asTheme(prefs?.theme) ?? "system",
    };
    Object.entries(values).forEach(([name, value]) => request.cookies.set(name, value));
    const next = NextResponse.next({ request });
    response.cookies.getAll().forEach((cookie) => next.cookies.set(cookie));
    response.headers.forEach((value, key) => {
      if (key.toLowerCase() !== "set-cookie" && !next.headers.has(key)) next.headers.set(key, value);
    });
    Object.entries(values).forEach(([name, value]) =>
      next.cookies.set(name, value, { path: "/", maxAge: 60 * 60 * 24 * 365, sameSite: "lax", httpOnly: true }),
    );
    response = next;
  }

  // Remember the last opened workspace for the next visit to "/".
  if (workspaceId && request.cookies.get(LAST_WORKSPACE_COOKIE)?.value !== workspaceId) {
    response.cookies.set(LAST_WORKSPACE_COOKIE, workspaceId, {
      path: "/",
      maxAge: 60 * 60 * 24 * 365,
      sameSite: "lax",
      httpOnly: true,
    });
  }

  return response;
}
