import type { Metadata } from "next";
import Link from "next/link";
import { dateLocale, t } from "@/i18n";
import { getCurrentUser } from "@/lib/auth";
import { workspacePath } from "@/lib/paths";
import { createClient } from "@/lib/supabase/server";
import { driveConfigured } from "@/lib/drive/google-drive";
import { getWorkspace, isWorkspaceAdmin } from "@/lib/workspace";
import { StoragePanel, type StorageStatus } from "./storage-panel";
import {
  DomainsPanel,
  GeneralPanel,
  LeaveButton,
  MembersPanel,
  type DepartedOwner,
  type DomainItem,
  type InvitationItem,
  type MemberItem,
} from "./settings-panels";

// Read per request, so the title follows the interface language.
export async function generateMetadata(): Promise<Metadata> {
  return { title: `${t.workspace.settings} · ${t.app.name}` };
}

const TABS = ["general", "members", "domains", "storage", "log"] as const;
type Tab = (typeof TABS)[number];

type MemberRow = {
  user_id: string;
  role: MemberItem["role"];
  joined_via: MemberItem["joinedVia"];
  profile: { name: string | null; email: string } | null;
};
type DomainRow = { domain: string; is_active: boolean };
type InvitationRow = { id: string; email: string; role: string; expires_at: string };
type LogRow = {
  id: number;
  action: string;
  details: Record<string, unknown>;
  created_at: string;
  actor: { email: string } | null;
};

const dateFormat = () => new Intl.DateTimeFormat(dateLocale(), { dateStyle: "short", timeStyle: "short" });

export default async function WorkspaceSettingsPage({
  params,
  searchParams,
}: PageProps<"/w/[wid]/settings">) {
  const { wid } = await params;
  const { tab: tabParam, drive: driveParam } = await searchParams;
  const [user, workspace] = await Promise.all([getCurrentUser(), getWorkspace(wid)]);
  if (!workspace) return null;

  const admin = isWorkspaceAdmin(workspace);
  const tab: Tab = TABS.includes(tabParam as Tab) ? (tabParam as Tab) : "general";

  if (!admin) {
    return (
      <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-10">
        <p className="text-sm text-muted">{workspace.name}</p>
        <h1 className="text-2xl font-semibold">{t.workspace.settings}</h1>
        <p className="mt-3 text-muted">{t.settings.memberOnly}</p>
        <div className="mt-6">
          <LeaveButton workspaceId={workspace.id} workspaceName={workspace.name} userId={user.id} />
        </div>
      </main>
    );
  }

  const supabase = await createClient();
  // Each query is limited by RLS to this workspace and to admins.
  const [members, domains, invitations, log, storage, departed] = await Promise.all([
    tab === "general" || tab === "members"
      ? supabase
          .from("workspace_members")
          .select("user_id, role, joined_via, profile:profiles!workspace_members_user_id_fkey(name, email)")
          .eq("workspace_id", workspace.id)
          .eq("status", "active")
          .order("joined_at")
          .overrideTypes<MemberRow[], { merge: false }>()
      : null,
    tab === "domains"
      ? supabase
          .from("workspace_domains")
          .select("domain, is_active")
          .eq("workspace_id", workspace.id)
          .order("added_at")
          .overrideTypes<DomainRow[], { merge: false }>()
      : null,
    tab === "members"
      ? supabase
          .from("invitations")
          .select("id, email, role, expires_at")
          .eq("workspace_id", workspace.id)
          .is("accepted_at", null)
          .is("revoked_at", null)
          .gt("expires_at", new Date().toISOString())
          .order("created_at", { ascending: false })
          .overrideTypes<InvitationRow[], { merge: false }>()
      : null,
    tab === "log"
      ? supabase
          .from("audit_log")
          .select("id, action, details, created_at, actor:profiles(email)")
          .eq("workspace_id", workspace.id)
          .order("created_at", { ascending: false })
          .limit(100)
          .overrideTypes<LogRow[], { merge: false }>()
      : null,
    tab === "storage" ? supabase.rpc("workspace_storage_status", { ws: workspace.id }) : null,
    // Only counts per former member: admins don't see other people's pages.
    tab === "members" ? supabase.rpc("departed_page_owners", { ws: workspace.id }) : null,
  ]);
  const departedData = departed?.data as
    | { ok: boolean; owners?: { user_id: string; name: string | null; email: string; pages: number }[] }
    | null
    | undefined;
  const departedItems: DepartedOwner[] = (departedData?.owners ?? []).map((d) => ({
    userId: d.user_id,
    name: d.name,
    email: d.email,
    pages: d.pages,
  }));

  const memberItems: MemberItem[] = (members?.data ?? []).map((m) => ({
    userId: m.user_id,
    name: m.profile?.name ?? null,
    email: m.profile?.email ?? "",
    role: m.role,
    joinedVia: m.joined_via,
  }));
  const domainItems: DomainItem[] = (domains?.data ?? []).map((d) => ({
    domain: d.domain,
    isActive: d.is_active,
  }));
  const invitationItems: InvitationItem[] = (invitations?.data ?? []).map((i) => ({
    id: i.id,
    email: i.email,
    role: i.role,
    expiresLabel: t.settings.members.expires(
      new Intl.DateTimeFormat(dateLocale(), { dateStyle: "medium" }).format(new Date(i.expires_at)),
    ),
  }));

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-10">
      <p className="text-sm text-muted">{workspace.name}</p>
      <h1 className="text-2xl font-semibold">{t.workspace.settings}</h1>

      <nav className="mt-6 flex gap-1 overflow-x-auto border-b border-border" aria-label={t.workspace.settings}>
        {TABS.map((key) => (
          <Link
            key={key}
            href={workspacePath(workspace.shortId, `/settings?tab=${key}`)}
            aria-current={tab === key ? "page" : undefined}
            className={`min-h-11 whitespace-nowrap border-b-2 px-3 py-2 text-sm ${
              tab === key ? "border-accent font-medium" : "border-transparent text-muted hover:text-foreground"
            }`}
          >
            {t.settings.tabs[key]}
          </Link>
        ))}
      </nav>

      <div className="mt-6">
        {tab === "general" && (
          <GeneralPanel
            workspace={workspace}
            members={memberItems.filter((m) => m.userId !== user.id)}
          />
        )}
        {tab === "members" && (
          <MembersPanel
            workspace={workspace}
            currentUserId={user.id}
            members={memberItems}
            invitations={invitationItems}
            departed={departedItems}
          />
        )}
        {tab === "domains" && (
          <DomainsPanel
            workspaceId={workspace.id}
            domains={domainItems}
            ownDomain={user.email.split("@")[1] ?? ""}
          />
        )}
        {tab === "storage" && storage?.data && (
          <StoragePanel
            workspaceId={workspace.id}
            status={storage.data as StorageStatus}
            isOwner={workspace.role === "owner"}
            configured={driveConfigured()}
            notice={driveParam === "connected" ? "connected" : driveParam === "error" ? "error" : null}
          />
        )}
        {tab === "log" && (
          <>
            <h2 className="text-lg font-semibold">{t.settings.log.heading}</h2>
            {!log?.data?.length ? (
              <p className="mt-3 text-muted">{t.settings.access.auditEmpty}</p>
            ) : (
              <div className="mt-3 overflow-x-auto rounded-lg border border-border">
                <table className="w-full min-w-[480px] text-left text-sm">
                  <thead className="bg-surface text-muted">
                    <tr>
                      <th className="px-3 py-2 font-medium">{t.settings.access.auditColumns.when}</th>
                      <th className="px-3 py-2 font-medium">{t.settings.access.auditColumns.who}</th>
                      <th className="px-3 py-2 font-medium">{t.settings.access.auditColumns.what}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {log.data.map((row) => (
                      <tr key={row.id} className="border-t border-border">
                        <td className="whitespace-nowrap px-3 py-2">{dateFormat().format(new Date(row.created_at))}</td>
                        <td className="px-3 py-2">{row.actor?.email ?? "—"}</td>
                        <td className="px-3 py-2">
                          {t.settings.access.actions[row.action] ?? row.action}{" "}
                          {["domain", "email", "name", "from", "to"].map((key) =>
                            typeof row.details[key] === "string" ? (
                              <span key={key} className="font-mono">
                                {String(row.details[key])}{" "}
                              </span>
                            ) : null,
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </div>
    </main>
  );
}
