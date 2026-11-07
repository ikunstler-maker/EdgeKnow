import type { Metadata } from "next";
import { currentLocale, t } from "@/i18n";
import { RELEASES } from "@/lib/changelog";
import { ChangelogView, type ShownRelease } from "@/components/changelog/changelog-view";

export async function generateMetadata(): Promise<Metadata> {
  return { title: `${t.changelog.title} · ${t.app.name}`, description: t.changelog.intro };
}

// «What's new»: open to everyone (no team data), newest release first.
export default function ChangelogPage() {
  const locale = currentLocale() === "en" ? "en" : "uk";
  const releases: ShownRelease[] = RELEASES.map((r) => ({
    id: r.id,
    version: r.version,
    date: r.date,
    title: r.summaryTitle[locale],
    description: r.summaryDescription?.[locale] ?? null,
    media: r.media ? { src: r.media.src, kind: r.media.kind, alt: r.media.alt[locale] } : null,
    items: r.items.map((i) => ({ id: i.id, type: i.type, scope: i.scope, title: i.title[locale], description: i.description?.[locale] ?? null })),
  }));
  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-10" data-changelog>
      <h1 className="text-3xl font-semibold">✦ {t.changelog.title}</h1>
      <p className="mt-2 text-muted">{t.changelog.intro}</p>
      <ChangelogView releases={releases} />
    </main>
  );
}
