import type { Metadata } from "next";
import Link from "next/link";
import { t } from "@/i18n";
import { getCurrentUser } from "@/lib/auth";
import { workspacePath } from "@/lib/paths";
import { createClient } from "@/lib/supabase/server";
import { RegistrationToggle } from "./registration-toggle";

export const metadata: Metadata = { title: `${t.platform.title} · ${t.app.name}` };

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
};

const dateFormat = new Intl.DateTimeFormat("uk-UA", { dateStyle: "medium" });
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
  const [{ data: stats }, { data: settings }] = await Promise.all([
    supabase.rpc("platform_workspaces"),
    supabase.from("platform_settings").select("open_registration").maybeSingle(),
  ]);
  const c = t.platform.columns;

  return (
    <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-10">
      {back}
      <h1 className="mt-4 text-2xl font-semibold">{t.platform.title}</h1>
      <p className="mt-2 text-muted">{t.platform.intro}</p>

      <section className="mt-8 rounded-lg border border-border p-4">
        <h2 className="font-semibold">{t.platform.registrationHeading}</h2>
        <RegistrationToggle open={Boolean(settings?.open_registration)} />
      </section>

      <div className="mt-8 overflow-x-auto rounded-lg border border-border">
        <table className="w-full min-w-[640px] text-left text-sm">
          <thead className="bg-surface text-muted">
            <tr>
              <th className="px-3 py-2 font-medium">{c.name}</th>
              <th className="px-3 py-2 font-medium">{c.owner}</th>
              <th className="px-3 py-2 text-right font-medium">{c.members}</th>
              <th className="px-3 py-2 text-right font-medium">{c.pages}</th>
              <th className="px-3 py-2 text-right font-medium">{c.storage}</th>
              <th className="px-3 py-2 font-medium">{c.created}</th>
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
                <td className="whitespace-nowrap px-3 py-2">{dateFormat.format(new Date(w.created_at))}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </main>
  );
}
