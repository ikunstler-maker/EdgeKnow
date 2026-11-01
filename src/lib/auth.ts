import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export type CurrentUser = {
  id: string;
  email: string;
  name: string | null;
  avatarUrl: string | null;
  isPlatformAdmin: boolean;
  // The angler fish and its lure (the feedback button).
  showMascot: boolean;
  lure: "bright" | "subtle" | "hidden";
};

// The proxy already gates every page; this re-checks on the server so a page
// never renders for a session the proxy let through by mistake.
// Cached per request, so the layout and the page share one lookup.
export const getCurrentUser = cache(async (): Promise<CurrentUser> => {
  const supabase = await createClient();
  const { data: claimsData } = await supabase.auth.getClaims();
  const userId = claimsData?.claims?.sub;
  if (!userId) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    // All columns: a setting added later (show_mascot, lure) never breaks sign-in while it rolls out.
    .select("*")
    .eq("id", userId)
    .maybeSingle();
  // RLS hides even your own profile once you have no verified email.
  if (!profile) redirect("/no-access");

  return {
    id: profile.id,
    email: profile.email,
    name: profile.name,
    avatarUrl: profile.avatar_url,
    isPlatformAdmin: profile.is_platform_admin,
    showMascot: profile.show_mascot ?? true,
    lure: profile.lure === "subtle" || profile.lure === "hidden" ? profile.lure : "bright",
  };
});
