import { redirect } from "next/navigation";
import { pagePath } from "@/lib/paths";
import { createClient } from "@/lib/supabase/server";

// Links from before workspaces (/p/<id>) keep working: find the page's workspace.
export default async function LegacyPageLink({ params }: PageProps<"/p/[id]">) {
  const { id } = await params;
  const supabase = await createClient();
  const { data } = await supabase
    .from("pages")
    .select("id, workspace:workspaces(short_id)")
    .eq("id", id)
    .maybeSingle()
    .overrideTypes<{ id: string; workspace: { short_id: string } | null }, { merge: false }>();
  redirect(data?.workspace ? pagePath(data.workspace.short_id, data.id) : "/");
}
