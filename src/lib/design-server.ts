import { t } from "@/i18n";
import { dataClient } from "@/lib/team-db/data";
import { getWorkspace } from "@/lib/workspace";
import { readDesign, type DesignDoc } from "@/lib/design";

// A design file the person may open (RLS decides), for the prototype player.
export async function loadDesign(wid: string, id: string): Promise<{ shortId: string; doc: DesignDoc; title: string } | null> {
  const workspace = await getWorkspace(wid);
  if (!workspace || !/^[0-9a-f-]{36}$/.test(id)) return null;
  const db = await dataClient(wid);
  const [{ data }, { data: role }] = await Promise.all([
    db.from("service_objects").select("id, kind, title, data, deleted_at").eq("id", id).eq("service", "boards").maybeSingle(),
    db.rpc("service_object_role", { target_object: id }),
  ]);
  const row = data as { id: string; kind: string; title: string; data: unknown; deleted_at: string | null } | null;
  if (!row || !role || row.deleted_at || row.kind !== "design") return null;
  return { shortId: workspace.shortId, doc: readDesign(row.data, t.design.pageName(1)), title: row.title };
}
