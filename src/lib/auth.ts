import "server-only";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export type CurrentUser = {
  id: string;
  email: string;
  name: string | null;
  avatarUrl: string | null;
  isAdmin: boolean;
};

// The proxy already gates every page; this re-checks on the server so a page
// never renders for a session the proxy let through by mistake.
export async function getCurrentUser(): Promise<CurrentUser> {
  const supabase = await createClient();
  const { data: claimsData } = await supabase.auth.getClaims();
  const userId = claimsData?.claims?.sub;
  if (!userId) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("id, email, name, avatar_url, is_admin")
    .eq("id", userId)
    .maybeSingle();
  // RLS hides profiles from users whose domain is no longer allowed.
  if (!profile) redirect("/no-access");

  return {
    id: profile.id,
    email: profile.email,
    name: profile.name,
    avatarUrl: profile.avatar_url,
    isAdmin: profile.is_admin,
  };
}
