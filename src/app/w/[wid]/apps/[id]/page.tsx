import type { Metadata } from "next";
import Link from "next/link";
import { t } from "@/i18n";
import { withPaths } from "@/lib/groups";
import { appLogoSrc, readApp } from "@/lib/apps";
import { workspacePath } from "@/lib/paths";
import { dataClient } from "@/lib/team-db/data";
import { getWorkspace } from "@/lib/workspace";
import type { Person } from "@/lib/tasks";
import type { ObjectAccess } from "@/components/access/object-access";
import { AppLogo } from "@/components/apps/app-logo";
import { AppSettings } from "@/components/apps/app-settings";

export const metadata: Metadata = { title: `${t.apps.title} · ${t.app.name}` };

type Row = { id: string; title: string; data: unknown; version: number; workspace_role: string | null; deleted_at: string | null };

// One company app: what it is and a button that opens it in a new tab; owners and
// admins (the database's "owner" of every app) also change it and its access here.
export default async function AppPage({ params }: PageProps<"/w/[wid]/apps/[id]">) {
  const { wid, id } = await params;
  const workspace = await getWorkspace(wid);
  const notFound = (
    <main className="mx-auto w-full max-w-md flex-1 px-4 py-16 text-center">
      <p className="text-muted">{t.apps.notFound}</p>
    </main>
  );
  if (!workspace || !/^[0-9a-f-]{36}$/.test(id)) return notFound;
  const db = await dataClient(wid);
  const [{ data }, { data: role }] = await Promise.all([
    db.from("service_objects").select("id, title, data, version, workspace_role, deleted_at").eq("id", id).eq("service", "apps").maybeSingle(),
    db.rpc("service_object_role", { target_object: id }),
  ]);
  const row = data as Row | null;
  if (!row || !role || row.deleted_at) return notFound;
  const app = readApp(row.data);
  const name = row.title || t.apps.untitled;
  const s = t.apps;

  let access: ObjectAccess | null = null;
  let members: Person[] = [];
  let categories: string[] = [];
  if (role === "owner") {
    const [{ data: people }, { data: groupGrants }, { data: groups }, { data: memberRows }, { data: others }] = await Promise.all([
      db.from("service_object_access").select("user_id, role").eq("object_id", id),
      db.from("service_object_group_access").select("group_id, role").eq("object_id", id),
      db.from("workspace_groups").select("id, name, parent_id").eq("workspace_id", workspace.id).order("name"),
      db
        .from("workspace_members")
        .select("user_id, role, profile:profiles!workspace_members_user_id_fkey(name, email)")
        .eq("workspace_id", workspace.id)
        .eq("status", "active")
        .overrideTypes<{ user_id: string; role: string; profile: { name: string | null; email: string } | null }[], { merge: false }>(),
      db.from("service_objects").select("data").eq("workspace_id", workspace.id).eq("service", "apps").is("deleted_at", null).limit(1000),
    ]);
    access = {
      workspaceRole: row.workspace_role,
      people: (people ?? []) as ObjectAccess["people"],
      groupGrants: (groupGrants ?? []) as ObjectAccess["groupGrants"],
      groups: withPaths((groups ?? []) as { id: string; name: string; parent_id: string | null }[]),
    };
    members = (memberRows ?? []).flatMap((m) => (m.profile ? [{ id: m.user_id, name: m.profile.name, email: m.profile.email, guest: m.role === "guest" }] : []));
    categories = [...new Set((others ?? []).map((o) => readApp(o.data).category).filter((c): c is string => !!c))].sort((x, y) => x.localeCompare(y));
  }

  return (
    <main className="mx-auto w-full max-w-2xl flex-1 px-4 py-8">
      <Link href={workspacePath(workspace.shortId, "/apps")} className="text-sm text-muted hover:text-foreground hover:underline">
        {s.back}
      </Link>
      <div className="mt-4 flex flex-wrap items-start gap-4">
        <AppLogo src={appLogoSrc(workspace.shortId, app)} name={name} size={72} />
        <div className="min-w-0 flex-1">
          <h1 className="break-words text-2xl font-semibold">{name}</h1>
          {app.category && <span className="mt-1 inline-block rounded-full bg-surface px-2 py-0.5 text-xs text-muted">{app.category}</span>}
          {app.description && <p className="mt-2 whitespace-pre-line text-muted">{app.description}</p>}
          <p className="mt-1 truncate text-xs text-muted">{app.url}</p>
        </div>
      </div>
      <a
        href={app.url}
        target="_blank"
        rel="noopener noreferrer"
        title={s.openHint(name)}
        className="mt-4 inline-flex min-h-11 items-center rounded-lg bg-accent px-5 text-sm font-medium text-white md:min-h-9"
        data-app-open
      >
        {s.open}
      </a>
      {role === "owner" && access ? (
        <AppSettings shortId={workspace.shortId} id={row.id} version={row.version} title={row.title} app={app} categories={categories} access={access} members={members} />
      ) : (
        <p className="mt-6 text-sm text-muted">{s.viewOnly}</p>
      )}
    </main>
  );
}
