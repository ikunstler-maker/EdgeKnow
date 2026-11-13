import type { Metadata } from "next";
import Link from "next/link";
import { t } from "@/i18n";
import { activeConnection } from "@/lib/drive/storage";
import { withPaths } from "@/lib/groups";
import { workspacePath } from "@/lib/paths";
import { SERVICE_BRANDS } from "@/lib/services";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Person } from "@/lib/tasks";
import { dataClient } from "@/lib/team-db/data";
import { VAULT_LIMIT, listVaultFiles, type VaultListing } from "@/lib/vault";
import { getWorkspace } from "@/lib/workspace";
import { VaultBrowser } from "@/components/files/vault-browser";
import { VaultDrive } from "@/components/files/vault-drive";
import { VaultGoogle } from "@/components/files/vault-google";
import { browseContext } from "@/lib/drive/vault-browse";
import { ServiceIcon } from "@/components/services/service-icon";
import { Hint } from "@/components/ui/hint";
import { Icon, type IconName } from "@/components/ui/icon";
import { formatBytes } from "@/lib/format-bytes";

export const metadata: Metadata = { title: `${SERVICE_BRANDS.files.name} · ${t.app.name}` };

type Tab = "files" | "google" | "all" | "bin";
const TABS: { key: Tab; icon: IconName }[] = [
  { key: "files", icon: "folder" },
  { key: "google", icon: "globe" },
  { key: "all", icon: "layers" },
  { key: "bin", icon: "trash" },
];

// Vault: the team's own folders and files (VAULT-2), every file seen in the services
// (VAULT-1), and the person's bin. Guests have only "All files" (what they see elsewhere).
export default async function FilesPage({ params, searchParams }: PageProps<"/w/[wid]/files">) {
  const { wid } = await params;
  const query = await searchParams;
  const workspace = await getWorkspace(wid);
  if (!workspace) return null;
  const guest = workspace.role === "guest";
  // Back from Google's screen (VAULT-7): the Drive tab with what happened.
  const driveNotice = typeof query.drive === "string" && /^[a-z_]{1,20}$/.test(query.drive) ? query.drive : null;
  const asked = (typeof query.tab === "string" ? query.tab : driveNotice ? "google" : "files") as Tab;
  // The team Drive tab: members while the owner keeps it on; the owner always (to switch it).
  const browse = guest ? null : await browseContext(wid);
  const showGoogle = Boolean(browse && (browse.owner || !(!browse.state.ok && browse.state.error === "off")));
  const tabs = TABS.filter((x) => x.key !== "google" || showGoogle);
  const tab: Tab = guest ? "all" : tabs.some((x) => x.key === asked) ? asked : "files";
  let folder = typeof query.folder === "string" && /^[0-9a-f-]{36}$/.test(query.folder) ? query.folder : null;
  const db = await dataClient(wid);
  // A link to one file (from a card in another service): its folder, with the file marked.
  const focus = typeof query.file === "string" && /^[0-9a-f-]{36}$/.test(query.file) ? query.file : null;
  if (focus && tab === "files") {
    const { data: file } = await db.from("vault_items").select("parent_id").eq("id", focus).is("deleted_at", null).maybeSingle();
    if (file) folder = (file.parent_id as string | null) ?? null;
  }
  const base = workspacePath(workspace.shortId, "/files");
  const v = t.vault;

  return (
    <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-6 md:py-8">
      <header className="flex flex-wrap items-center gap-2">
        <h1 className="flex min-w-0 flex-1 items-center gap-2 text-xl font-semibold tracking-tight">
          <ServiceIcon serviceId="files" size={28} />
          <span className="truncate">{SERVICE_BRANDS.files.name}</span>
          <Hint label={SERVICE_BRANDS.files.name} text={tab === "all" ? v.intro : v.driveIntro} />
        </h1>
        {!guest && (
          <nav aria-label={v.tabsLabel} className="inline-flex shrink-0 rounded-lg border border-border bg-hover p-0.5" data-vault-tabs>
            {tabs.map((x) => (
              <Link
                key={x.key}
                href={x.key === "files" ? base : `${base}?tab=${x.key}`}
                aria-current={tab === x.key ? "page" : undefined}
                className={`inline-flex min-h-11 items-center gap-1.5 rounded-md px-3 text-[13px] font-medium md:h-7 md:min-h-0 ${tab === x.key ? "bg-background shadow-sm" : "text-muted hover:text-foreground"}`}
                data-vault-tab={x.key}
              >
                <Icon name={x.icon} size={14} />
                {v.tabs[x.key]}
              </Link>
            ))}
          </nav>
        )}
      </header>
      {tab === "files" && !folder && (workspace.role === "owner" || workspace.role === "admin") && <Usage db={db} workspaceId={workspace.id} team={Boolean(workspace.hasTeamDatabase)} />}
      {tab === "google" && browse ? (
        <VaultGoogle
          shortId={workspace.shortId}
          workspaceId={workspace.id}
          state={browse.state}
          owner={browse.owner}
          browseOn={browse.state.ok || browse.state.error !== "off"}
          notice={driveNotice}
        />
      ) : tab === "all" ? <AllFiles db={db} workspaceId={workspace.id} shortId={workspace.shortId} /> : <Drive db={db} workspaceId={workspace.id} shortId={workspace.shortId} folder={tab === "bin" ? null : folder} bin={tab === "bin"} focus={focus} />}
    </main>
  );
}

async function AllFiles({ db, workspaceId, shortId }: { db: Awaited<ReturnType<typeof dataClient>>; workspaceId: string; shortId: string }) {
  const files = await listVaultFiles(db, workspaceId, shortId);
  const perSource = new Map<string, number>();
  for (const file of files) perSource.set(file.source, (perSource.get(file.source) ?? 0) + 1);
  return <VaultBrowser files={files} limited={[...perSource.values()].some((n) => n >= VAULT_LIMIT)} />;
}

async function Drive({ db, workspaceId, shortId, folder, bin, focus }: { db: Awaited<ReturnType<typeof dataClient>>; workspaceId: string; shortId: string; folder: string | null; bin: boolean; focus: string | null }) {
  const admin = createAdminClient();
  const [{ data: listed }, { data: settings }, { data: groups }, { data: memberRows }, connection] = await Promise.all([
    db.rpc("vault_list", { ws: workspaceId, folder, bin }),
    db.from("vault_settings").select("file_limit_mb").eq("workspace_id", workspaceId).maybeSingle(),
    db.from("workspace_groups").select("id, name, parent_id").eq("workspace_id", workspaceId).order("name"),
    db
      .from("workspace_members")
      .select("user_id, role, profile:profiles!workspace_members_user_id_fkey(name, email)")
      .eq("workspace_id", workspaceId)
      .eq("status", "active")
      .overrideTypes<{ user_id: string; role: string; profile: { name: string | null; email: string } | null }[], { merge: false }>(),
    admin ? activeConnection(admin, workspaceId) : Promise.resolve(null),
  ]);
  const result = listed as ({ ok: true } & VaultListing) | { ok: false; error: string } | null;
  if (!result?.ok) {
    return <p className="mt-5 rounded-xl border border-dashed border-border px-4 py-10 text-center text-sm text-muted">{t.vault.errors[result?.error ?? "unknown"] ?? t.vault.errors.unknown}</p>;
  }
  const members: Person[] = (memberRows ?? []).flatMap((m) => (m.profile ? [{ id: m.user_id, name: m.profile.name, email: m.profile.email, guest: m.role === "guest" }] : []));
  return (
    <VaultDrive
      key={`${folder ?? "top"}-${bin}`}
      shortId={shortId}
      workspaceId={workspaceId}
      listing={result}
      bin={bin}
      focus={focus}
      hasDrive={connection?.status === "ok"}
      limitMb={(settings?.file_limit_mb as number | null | undefined) ?? null}
      members={members}
      groups={withPaths((groups ?? []) as { id: string; name: string; parent_id: string | null }[])}
    />
  );
}

// VAULT-4: what the workspace's files take, by service (owner and admins; sizes only).
// Without a Drive, how much of EdgeKnow's storage is used, of the workspace's limit (a team's own
// storage has no limit of ours).
async function Usage({ db, workspaceId, team }: { db: Awaited<ReturnType<typeof dataClient>>; workspaceId: string; team: boolean }) {
  const admin = createAdminClient();
  const [{ data }, connection, limit] = await Promise.all([
    db.rpc("vault_storage_usage", { ws: workspaceId }),
    admin ? activeConnection(admin, workspaceId) : Promise.resolve(null),
    admin ? admin.from("workspaces").select("storage_limit_mb").eq("id", workspaceId).maybeSingle().then((r) => (r.data?.storage_limit_mb as number | undefined) ?? null) : Promise.resolve(null),
  ]);
  const usage = data as { ok: boolean; services?: Record<string, { bytes: number; stored: number }> } | null;
  if (!usage?.ok || !usage.services) return null;
  const u = t.vault.usage;
  const entries = Object.entries(usage.services).filter(([, x]) => Number(x.bytes) > 0).sort((a, b) => Number(b[1].bytes) - Number(a[1].bytes));
  const label = (key: string) => (key in SERVICE_BRANDS ? SERVICE_BRANDS[key as keyof typeof SERVICE_BRANDS].name : key === "wishlists" ? t.wishlists.title : key);
  const total = entries.reduce((sum, [, x]) => sum + Number(x.bytes), 0);
  const stored = entries.reduce((sum, [, x]) => sum + Number(x.stored), 0);
  return (
    <p className="mt-3 text-xs text-muted" title={u.onlyAdmins} data-vault-usage>
      <span className="font-medium text-foreground">{u.title}:</span> {entries.map(([key, x]) => `${label(key)} ${formatBytes(Number(x.bytes))}`).join(" · ") || formatBytes(0)}
      {entries.length > 1 && ` · ${u.total(formatBytes(total))}`}
      {connection?.status !== "ok" && ` · ${limit && !team ? u.stored(formatBytes(stored), formatBytes(limit * 1048576)) : u.storedNoLimit(formatBytes(stored))}`}
    </p>
  );
}
