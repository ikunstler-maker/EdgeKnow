import type { Metadata } from "next";
import { withPaths } from "@/lib/groups";
import { t } from "@/i18n";
import { dataClient } from "@/lib/team-db/data";
import { getWorkspace } from "@/lib/workspace";
import type { ObjectAccess } from "@/components/access/object-access";
import { DeckScreen } from "@/components/slides/deck-screen";
import type { Person } from "@/lib/tasks";

export const metadata: Metadata = { title: `${t.slides.title} · ${t.app.name}` };

type Row = { id: string; title: string; data: unknown; version: number; workspace_role: string | null; deleted_at: string | null };

export default async function DeckPage({ params }: PageProps<"/w/[wid]/slides/[id]">) {
  const { wid, id } = await params;
  const workspace = await getWorkspace(wid);
  const notFound = (
    <main className="mx-auto w-full max-w-md flex-1 px-4 py-16 text-center">
      <p className="text-muted">{t.slides.notFound}</p>
    </main>
  );
  if (!workspace || !/^[0-9a-f-]{36}$/.test(id)) return notFound;
  const db = await dataClient(wid);
  const [{ data }, { data: role }] = await Promise.all([
    db.from("service_objects").select("id, title, data, version, workspace_role, deleted_at").eq("id", id).eq("service", "slides").maybeSingle(),
    db.rpc("service_object_role", { target_object: id }),
  ]);
  const deck = data as Row | null;
  if (!deck || !role || deck.deleted_at) return notFound;

  // What the access dialog needs (only for those who manage the table).
  let access: ObjectAccess | null = null;
  let members: Person[] = [];
  if (role === "owner") {
    const [{ data: people }, { data: groupGrants }, { data: groups }, { data: memberRows }] = await Promise.all([
      db.from("service_object_access").select("user_id, role").eq("object_id", id),
      db.from("service_object_group_access").select("group_id, role").eq("object_id", id),
      db.from("workspace_groups").select("id, name, parent_id").eq("workspace_id", workspace.id).order("name"),
      db
        .from("workspace_members")
        .select("user_id, role, profile:profiles!workspace_members_user_id_fkey(name, email)")
        .eq("workspace_id", workspace.id)
        .eq("status", "active")
        .overrideTypes<{ user_id: string; role: string; profile: { name: string | null; email: string } | null }[], { merge: false }>(),
    ]);
    access = {
      workspaceRole: deck.workspace_role,
      people: (people ?? []) as ObjectAccess["people"],
      groupGrants: (groupGrants ?? []) as ObjectAccess["groupGrants"],
      groups: withPaths((groups ?? []) as { id: string; name: string; parent_id: string | null }[]),
    };
    members = (memberRows ?? []).flatMap((m) => (m.profile ? [{ id: m.user_id, name: m.profile.name, email: m.profile.email, guest: m.role === "guest" }] : []));
  }

  return (
    <main className="flex w-full min-w-0 flex-1 flex-col" data-deck-page>
      <DeckScreen
        key={deck.id}
        shortId={workspace.shortId}
        id={deck.id}
        initialTitle={deck.title}
        initialData={deck.data}
        initialVersion={deck.version}
        role={String(role)}
        access={access}
        members={members}
      />
    </main>
  );
}
