import { dataClient } from "@/lib/team-db/data";
import { getWorkspace } from "@/lib/workspace";
import { readDeck, type Deck } from "@/lib/slides";

// A deck the person may open (RLS decides), for the show and the print pages.
export async function loadDeck(wid: string, id: string): Promise<{ shortId: string; deck: Deck; title: string; role: string } | null> {
  const workspace = await getWorkspace(wid);
  if (!workspace || !/^[0-9a-f-]{36}$/.test(id)) return null;
  const db = await dataClient(wid);
  const [{ data }, { data: role }] = await Promise.all([
    db.from("service_objects").select("id, title, data, deleted_at").eq("id", id).eq("service", "slides").maybeSingle(),
    db.rpc("service_object_role", { target_object: id }),
  ]);
  const row = data as { id: string; title: string; data: unknown; deleted_at: string | null } | null;
  if (!row || !role || row.deleted_at) return null;
  return { shortId: workspace.shortId, deck: readDeck(row.data), title: row.title, role: String(role) };
}
