import type { Metadata } from "next";
import Link from "next/link";
import { dateLocale, t } from "@/i18n";
import { getCurrentUser } from "@/lib/auth";
import { workspacePath } from "@/lib/paths";
import { createClient } from "@/lib/supabase/server";
import { headers } from "next/headers";
import { oidcConfigured, oidcIssuer } from "@/lib/oidc";
import { teamCheckSql } from "@/lib/oidc-guard";
import { RegistrationToggle } from "./registration-toggle";
import { DomainRequests, type DomainRequest } from "./domain-requests";
import { OwnDatabaseFirst, TeamKeyPanel, WorkspaceControls } from "./platform-controls";
import { createAdminClient } from "@/lib/supabase/admin";
import { teamKeyStatus } from "@/lib/team-db/rekey";
import { TeamLoginPanel } from "./team-login/team-login-panel";

// Read per request, so the title follows the interface language.
export async function generateMetadata(): Promise<Metadata> {
  return { title: `${t.platform.title} · ${t.app.name}` };
}

type WorkspaceStats = {
  id: string;
  short_id: string;
  name: string;
  owner_email: string;
  members: number;
  pages: number;
  storage_bytes: number;
  storage_limit_mb: number;
  created_at: string;
  data_location: "team" | "setup" | null;
  central_allowed: boolean;
  frozen_at: string | null;
  frozen_reason: string | null;
};

const dateFormat = () => new Intl.DateTimeFormat(dateLocale(), { dateStyle: "medium" });
const mb = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(1)} МБ`;

// Platform admin: statistics of every workspace. The database function returns
// counts only, never page titles or contents.
export default async function PlatformAdminPage() {
  const user = await getCurrentUser();
  const back = (
    <Link href="/" className="text-sm text-muted hover:underline">
      ← {t.workspace.toMyWorkspaces}
    </Link>
  );

  if (!user.isPlatformAdmin) {
    return (
      <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-10">
        {back}
        <h1 className="mt-4 text-2xl font-semibold">{t.platform.title}</h1>
        <p className="mt-3 text-muted">{t.platform.forbidden}</p>
      </main>
    );
  }

  const supabase = await createClient();
  const [{ data: stats }, { data: settings }, { data: domainRequests }, { data: size }] = await Promise.all([
    supabase.rpc("platform_workspaces"),
    supabase.from("platform_settings").select("open_registration, email_domain_proof, require_team_database").maybeSingle(),
    supabase.rpc("platform_domain_requests"),
    supabase.rpc("platform_database_size"),
  ]);
  const service = createAdminClient();
  const keyStatus = service ? await teamKeyStatus(service) : null;
  const centralSize = size as { database_bytes: number; storage_bytes: number } | null;
  const c = t.platform.columns;
  const h = await headers();
  const issuer = oidcIssuer(`${h.get("x-forwarded-proto") ?? "https"}://${h.get("host")}`);

  return (
    <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-10">
      {back}
      <h1 className="mt-4 text-2xl font-semibold">{t.platform.title}</h1>
      <p className="mt-2 text-muted">{t.platform.intro}</p>

      <section className="mt-8 rounded-lg border border-border p-4">
        <h2 className="font-semibold">{t.platform.registrationHeading}</h2>
        <RegistrationToggle open={Boolean(settings?.open_registration)} />
      </section>

      <OwnDatabaseFirst
        required={Boolean(settings?.require_team_database)}
        databaseMb={centralSize ? centralSize.database_bytes / 1048576 : null}
        storageMb={centralSize ? centralSize.storage_bytes / 1048576 : null}
      />

      <DomainRequests requests={(domainRequests ?? []) as DomainRequest[]} emailWay={Boolean(settings?.email_domain_proof)} />

      <TeamLoginPanel configured={oidcConfigured()} issuer={issuer} sql={teamCheckSql(issuer)} />

      {keyStatus && <TeamKeyPanel {...keyStatus} />}

      <div className="mt-8 overflow-x-auto rounded-lg border border-border">
        <table className="w-full min-w-[960px] text-left text-sm">
          <thead className="bg-surface text-muted">
            <tr>
              <th className="px-3 py-2 font-medium">{c.name}</th>
              <th className="px-3 py-2 font-medium">{c.owner}</th>
              <th className="px-3 py-2 text-right font-medium">{c.members}</th>
              <th className="px-3 py-2 text-right font-medium">{c.pages}</th>
              <th className="px-3 py-2 text-right font-medium">{c.storage}</th>
              <th className="px-3 py-2 font-medium">{c.created}</th>
              <th className="px-3 py-2 font-medium">{c.data}</th>
              <th className="px-3 py-2 font-medium">{c.actions}</th>
            </tr>
          </thead>
          <tbody>
            {((stats ?? []) as WorkspaceStats[]).map((w) => (
              <tr key={w.id} className="border-t border-border">
                <td className="px-3 py-2">
                  <Link href={workspacePath(w.short_id)} className="hover:underline">
                    {w.name}
                  </Link>{" "}
                  <span className="font-mono text-xs text-muted">{w.short_id}</span>
                </td>
                <td className="px-3 py-2">{w.owner_email}</td>
                <td className="px-3 py-2 text-right">{w.members}</td>
                <td className="px-3 py-2 text-right">{w.pages}</td>
                <td className="px-3 py-2 text-right">
                  {mb(w.storage_bytes)} / {w.storage_limit_mb} МБ
                </td>
                <td className="whitespace-nowrap px-3 py-2">{dateFormat().format(new Date(w.created_at))}</td>
                <td className="px-3 py-2">
                  {w.data_location === "team" ? c.inTeam : w.data_location === "setup" ? c.connecting : w.central_allowed ? c.central : c.noDatabase}
                  {w.frozen_at && <span className="block text-xs text-danger">❄️ {w.frozen_reason || c.frozen}</span>}
                </td>
                <td className="px-3 py-2">
                  <WorkspaceControls id={w.id} name={w.name} centralAllowed={w.central_allowed} frozen={Boolean(w.frozen_at)} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </main>
  );
}
