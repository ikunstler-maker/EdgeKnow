import type { Metadata } from "next";
import Link from "next/link";
import { t } from "@/i18n";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { filesHome } from "@/lib/drive/task-files";
import { readSurvey } from "@/lib/surveys";
import { PublicSurvey } from "@/components/surveys/public-survey";
import { Icon } from "@/components/ui/icon";

export const metadata: Metadata = { title: `${t.surveys.publicPage.title} · ${t.app.name}`, robots: { index: false, follow: false } };

type PublicData = { ok: true; id: string; title: string; data: unknown; anonymous: boolean; once: boolean; closed: boolean } | { ok: false };

// A survey through its link for anyone (step О3): open to everyone, signed in or
// not. Read with the secret key, but only what the database gives for a link
// that is on: the title and the questions — nothing else of the workspace.
export default async function PublicSurveyPage({ params }: PageProps<"/f/[ws]/[token]">) {
  const { ws, token } = await params;
  const p = t.surveys.publicPage;
  const missing = (
    <main className="mx-auto w-full max-w-md flex-1 px-4 py-16 text-center">
      <p className="text-4xl" aria-hidden="true">
        <Icon name="file-text" />
      </p>
      <p className="mt-3 text-muted" data-public-survey-missing>
        {p.notFound}
      </p>
    </main>
  );
  const admin = createAdminClient();
  if (!admin || !/^[a-z0-9]{4,16}$/.test(ws) || !/^[0-9a-f]{32}$/.test(token)) return missing;
  const { data: workspace } = await admin.from("workspaces").select("id").eq("short_id", ws).maybeSingle();
  if (!workspace) return missing;
  const { rows } = await filesHome(admin, workspace.id).catch(() => ({ rows: null }));
  if (!rows) return missing;
  const { data } = await rows.rpc("public_survey", { token });
  const survey = data as PublicData | null;
  if (!survey?.ok) return missing;

  const central = await createClient();
  const { data: claims } = await central.auth.getClaims();
  let who: string | null = null;
  if (claims?.claims?.sub) {
    const { data: profile } = await admin.from("profiles").select("name, email").eq("id", String(claims.claims.sub)).maybeSingle();
    who = profile ? profile.name || profile.email : null;
  }
  const form = readSurvey(survey.data);

  return (
    <main className="mx-auto w-full max-w-2xl flex-1 px-4 py-8" data-public-survey>
      <h1 className="text-2xl font-semibold">{survey.title || t.surveys.untitled}</h1>
      {form.description && <p className="mt-2 whitespace-pre-line text-muted">{form.description}</p>}
      <p className="mt-3 text-xs text-muted">
        {who && `${p.signedInAs(who)} `}
        {survey.anonymous ? p.anonymousNote : p.namedNote}
      </p>
      <div className="mt-6">
        <PublicSurvey
          shortId={ws}
          token={token}
          id={survey.id}
          survey={form}
          anonymous={survey.anonymous}
          once={survey.once}
          closed={survey.closed}
          signedIn={Boolean(claims?.claims?.sub)}
          turnstileSiteKey={process.env.TURNSTILE_SECRET_KEY ? (process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY ?? null) : null}
        />
      </div>
      <p className="mt-10 text-center text-xs text-muted">
        <Link href="/about" className="hover:underline">
          {p.by}
        </Link>
      </p>
    </main>
  );
}
