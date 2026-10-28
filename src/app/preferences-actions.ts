"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { LOCALE_COOKIE, THEME_COOKIE, asLocale, asTheme } from "@/lib/preferences";
import { createClient } from "@/lib/supabase/server";

const YEAR = 60 * 60 * 24 * 365;

// Saved in a cookie (so the very first render uses it) and in the profile (so it
// follows the person to other devices). Works before sign-in too (cookie only).
export async function savePreferences(input: { theme?: string; locale?: string }) {
  const theme = input.theme === undefined ? null : asTheme(input.theme);
  const locale = input.locale === undefined ? null : asLocale(input.locale);
  if ((input.theme !== undefined && !theme) || (input.locale !== undefined && !locale)) {
    return { ok: false as const, error: "invalid" };
  }
  const jar = await cookies();
  const options = { path: "/", maxAge: YEAR, sameSite: "lax" as const, httpOnly: true, secure: process.env.NODE_ENV === "production" };
  if (theme) jar.set(THEME_COOKIE, theme, options);
  if (locale) jar.set(LOCALE_COOKIE, locale, options);

  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  if (data?.claims?.sub) await supabase.rpc("set_my_preferences", { new_theme: theme, new_locale: locale });
  revalidatePath("/", "layout");
  return { ok: true as const };
}
