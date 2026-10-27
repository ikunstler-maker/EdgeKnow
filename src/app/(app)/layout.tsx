import type { ReactNode } from "react";
import { getCurrentUser } from "@/lib/auth";
import { toPageNode, type PageRow } from "@/lib/pages";
import { createClient } from "@/lib/supabase/server";
import { AppShell } from "@/components/app-shell";
import { PagesProvider } from "@/components/pages/pages-provider";

export default async function AppLayout({ children }: { children: ReactNode }) {
  const user = await getCurrentUser();
  const supabase = await createClient();
  // RLS returns only pages the user has a role on.
  const { data } = await supabase
    .from("pages")
    .select("id, parent_id, title, icon, position")
    .is("deleted_at", null)
    .order("position")
    .overrideTypes<PageRow[], { merge: false }>();

  return (
    <PagesProvider pages={(data ?? []).map(toPageNode)}>
      <AppShell user={user}>{children}</AppShell>
    </PagesProvider>
  );
}
