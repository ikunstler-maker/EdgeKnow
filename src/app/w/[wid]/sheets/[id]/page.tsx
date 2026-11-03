import type { Metadata } from "next";
import Link from "next/link";
import { t } from "@/i18n";
import { workspacePath } from "@/lib/paths";
import { dataClient } from "@/lib/team-db/data";
import { getWorkspace } from "@/lib/workspace";
import type { ObjectAccess } from "@/components/access/object-access";
import { SheetScreen } from "@/components/sheets/sheet-screen";
import type { Person } from "@/lib/tasks";

export const metadata: Metadata = { title: `${t.sheets.title} · ${t.app.name}` };

type Row = { id: string; title: string; data: unknown; version: number; workspace_role: string | null; deleted_at: string | null };

export default async function SheetPage({ params }: PageProps<"/w/[wid]/sheets/[id]">) {
  const { wid, id } = await params;
  const workspace = await getWorkspace(wid);
  const notFound = (
    <main className="mx-auto w-full max-w-md flex-1 px-4 py-16 text-center">
      <p className="text-muted">{t.sheets.notFound}</p>
    </main>
  );
  if (!workspace || !/^[0-9a-f-]{36}$/.test(id)) return notFound;
  const db = await dataClient(wid);
  const [{ data }, { data: role }] = await Promise.all([
    db.from("service_objects").select("id, title, data, version, workspace_role, deleted_at").eq("id", id).eq("service", "sheets").maybeSingle(),
    db.rpc("service_object_role", { target_object: id }),
  ]);
  const sheet = data as Row | null;
  if (!sheet || !role || sheet.deleted_at) return notFound;

  // What the access dialog needs (only for those who manage the table).
  let access: ObjectAccess | null = null;
  let members: Person[] = [];
  if (role === "owner") {
    const [{ data: people }, { data: groupGrants }, { data: groups }, { data: memberRows }] = await Promise.all([
      db.from("service_object_access").select("user_id, role").eq("object_id", id),
      db.from("service_object_group_access").select("group_id, role").eq("object_id", id),
      db.from("workspace_groups").select("id, name").eq("workspace_id", workspace.id).order("name"),
      db
        .from("workspace_members")
        .select("user_id, role, profile:profiles!workspace_members_user_id_fkey(name, email)")
        .eq("workspace_id", workspace.id)
        .eq("status", "active")
        .overrideTypes<{ user_id: string; role: string; profile: { name: string | null; email: string } | null }[], { merge: false }>(),
    ]);
    access = {
      workspaceRole: sheet.workspace_role,
      people: (people ?? []) as ObjectAccess["people"],
      groupGrants: (groupGrants ?? []) as ObjectAccess["groupGrants"],
      groups: (groups ?? []) as ObjectAccess["groups"],
    };
    members = (memberRows ?? []).flatMap((m) => (m.profile ? [{ id: m.user_id, name: m.profile.name, email: m.profile.email, guest: m.role === "guest" }] : []));
  }

  return (
    <main className="flex w-full flex-1 flex-col px-4 py-4">
      <Link href={workspacePath(workspace.shortId, "/sheets")} className="text-sm text-muted hover:text-foreground hover:underline">
        {t.sheets.back}
      </Link>
      <SheetScreen
        key={sheet.id}
        shortId={workspace.shortId}
        id={sheet.id}
        initialTitle={sheet.title}
        initialData={sheet.data}
        initialVersion={sheet.version}
        role={String(role)}
        access={access}
        members={members}
      />
    </main>
  );
}
