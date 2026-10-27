import { t } from "@/i18n";
import { getCurrentUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { AppHeader } from "@/components/app-header";
import { DomainManager, type DomainRow } from "./domain-manager";

const s = t.settings.access;

type AuditRow = {
  id: number;
  action: string;
  details: Record<string, unknown>;
  created_at: string;
  actor: { email: string } | null;
};

type DomainQueryRow = {
  domain: string;
  is_active: boolean;
  added_at: string;
  added_by_profile: { email: string } | null;
};

const dateFormat = new Intl.DateTimeFormat("uk-UA", { dateStyle: "short", timeStyle: "short" });

export default async function AccessSettingsPage() {
  const user = await getCurrentUser();

  if (!user.isAdmin) {
    return (
      <>
        <AppHeader user={user} />
        <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-10">
          <h1 className="text-2xl font-semibold">{s.title}</h1>
          <p className="mt-3 text-muted">{s.forbidden}</p>
        </main>
      </>
    );
  }

  const supabase = await createClient();
  const [{ data: domains }, { data: audit }] = await Promise.all([
    supabase
      .from("allowed_domains")
      .select("domain, is_active, added_at, added_by_profile:profiles(email)")
      .order("added_at")
      .overrideTypes<DomainQueryRow[], { merge: false }>(),
    supabase
      .from("admin_audit_log")
      .select("id, action, details, created_at, actor:profiles(email)")
      .order("created_at", { ascending: false })
      .limit(50)
      .overrideTypes<AuditRow[], { merge: false }>(),
  ]);

  const domainRows: DomainRow[] = (domains ?? []).map((d) => ({
    domain: d.domain,
    isActive: d.is_active,
    addedBy: d.added_by_profile?.email ?? null,
  }));

  return (
    <>
      <AppHeader user={user} />
      <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-10">
        <p className="text-sm text-muted">{t.settings.title}</p>
        <h1 className="text-2xl font-semibold">{s.title}</h1>
        <p className="mt-2 text-muted">{s.intro}</p>

        <section className="mt-8">
          <h2 className="text-lg font-semibold">{s.domainsHeading}</h2>
          <DomainManager domains={domainRows} />
        </section>

        <section className="mt-10">
          <h2 className="text-lg font-semibold">{s.auditHeading}</h2>
          {!audit?.length ? (
            <p className="mt-3 text-muted">{s.auditEmpty}</p>
          ) : (
            <div className="mt-3 overflow-x-auto rounded-lg border border-border">
              <table className="w-full min-w-[480px] text-left text-sm">
                <thead className="bg-surface text-muted">
                  <tr>
                    <th className="px-3 py-2 font-medium">{s.auditColumns.when}</th>
                    <th className="px-3 py-2 font-medium">{s.auditColumns.who}</th>
                    <th className="px-3 py-2 font-medium">{s.auditColumns.what}</th>
                  </tr>
                </thead>
                <tbody>
                  {audit.map((row) => (
                    <tr key={row.id} className="border-t border-border">
                      <td className="whitespace-nowrap px-3 py-2">
                        {dateFormat.format(new Date(row.created_at))}
                      </td>
                      <td className="px-3 py-2">{row.actor?.email ?? "—"}</td>
                      <td className="px-3 py-2">
                        {s.actions[row.action] ?? row.action}{" "}
                        {typeof row.details.domain === "string" && (
                          <span className="font-mono">{row.details.domain}</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </main>
    </>
  );
}
