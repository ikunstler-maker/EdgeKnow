import { dateLocale, t } from "@/i18n";
import type { ProfileStats } from "@/lib/profile-stats";

function Stat({ label, value, hint }: { label: string; value: number; hint?: string }) {
  return (
    <div className="rounded-xl border border-border bg-surface p-4">
      <p className="text-xs text-muted">{label}</p>
      <p className="mt-1 text-2xl font-semibold tracking-tight tabular-nums">{new Intl.NumberFormat(dateLocale()).format(value)}</p>
      {hint && <p className="mt-1 text-xs text-muted">{hint}</p>}
    </div>
  );
}

// The numbers of one person in one workspace; the page decides who may see them.
export function ProfileView({ stats }: { stats: ProfileStats }) {
  const roles = stats.pagesByRole;
  return (
    <>
      <section aria-labelledby="profile-pages" className="pt-2">
        <h2 id="profile-pages" className="text-xs font-medium uppercase tracking-wide text-muted">{t.profile.pagesHeading}</h2>
        <div className="mt-2 grid grid-cols-2 gap-3 sm:grid-cols-3">
          <Stat label={t.profile.pagesCreated} value={stats.pagesCreated} />
          <Stat label={t.profile.pagesEdited} value={stats.pagesEdited} />
          <Stat label={t.profile.comments} value={stats.comments} />
        </div>
      </section>
      <section aria-labelledby="profile-access" className="pt-2">
        <h2 id="profile-access" className="text-xs font-medium uppercase tracking-wide text-muted">{t.profile.accessHeading}</h2>
        <p className="mt-1 text-sm text-muted">{t.profile.accessIntro}</p>
        <div className="mt-2 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Stat label={t.share.roles.owner} value={roles.owner} />
          <Stat label={t.share.roles.editor} value={roles.editor} />
          <Stat label={t.share.roles.commenter} value={roles.commenter} />
          <Stat label={t.share.roles.viewer} value={roles.viewer} />
        </div>
      </section>
      <section aria-labelledby="profile-text" className="pt-2">
        <h2 id="profile-text" className="text-xs font-medium uppercase tracking-wide text-muted">{t.profile.textHeading}</h2>
        <div className="mt-2 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Stat label={t.profile.charsWritten} value={stats.charsWritten} hint={t.profile.charsWrittenHint} />
          <Stat label={t.profile.charsInOwnPages} value={stats.charsInOwnPages} hint={t.profile.charsInOwnPagesHint} />
        </div>
      </section>
    </>
  );
}
