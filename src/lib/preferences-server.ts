import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { LOCALE_COOKIE, THEME_COOKIE, asLocale, asTheme, type Locale, type Theme } from "./preferences";

// The cookie decides (it is set whenever the person changes a preference); on a
// new device without it, the profile is read once and the cookie set on the next change.
export const getPreferences = cache(async (): Promise<{ theme: Theme; locale: Locale }> => {
  const jar = await cookies();
  const theme = asTheme(jar.get(THEME_COOKIE)?.value);
  const locale = asLocale(jar.get(LOCALE_COOKIE)?.value);
  if (theme && locale) return { theme, locale };

  let profile: { theme?: string; locale?: string } | null = null;
  try {
    const supabase = await createClient();
    const { data } = await supabase.auth.getClaims();
    if (data?.claims?.sub) {
      const result = await supabase.from("profiles").select("theme, locale").eq("id", data.claims.sub).maybeSingle();
      profile = result.data;
    }
  } catch {
    profile = null;
  }
  return {
    theme: theme ?? asTheme(profile?.theme) ?? "system",
    locale: locale ?? asLocale(profile?.locale) ?? "uk",
  };
});
