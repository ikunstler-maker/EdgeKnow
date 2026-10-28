import type { Metadata } from "next";
import Link from "next/link";
import { t } from "@/i18n";
import { PreferencesSwitch } from "@/components/prefs/preferences-switch";

export async function generateMetadata(): Promise<Metadata> {
  return { title: `${t.help.link} · ${t.app.name}` };
}

// Built into the service, the same for every team and in both languages: nobody
// can delete it by accident, and a new team has it from day one. Open without
// signing in too (it holds no team data).
export default function HelpPage() {
  const h = t.help;
  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-10 md:px-8">
      <div className="mb-6 flex flex-wrap items-center gap-3">
        <Link href="/" className="text-sm text-muted hover:text-foreground hover:underline">
          ← {h.back}
        </Link>
        <span className="flex-1" />
        <PreferencesSwitch compact />
      </div>
      <h1 className="text-3xl font-bold">❓ {h.title}</h1>
      <p className="mt-3 text-muted">{h.intro}</p>

      <nav aria-label={h.contents} className="mt-8 rounded-lg border border-border bg-surface p-4">
        <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted">{h.contents}</p>
        <ol className="grid gap-1 text-sm sm:grid-cols-2">
          {h.sections.map((section, i) => (
            <li key={section.id}>
              <a href={`#${section.id}`} className="hover:text-accent hover:underline">
                {i + 1}. {section.title}
              </a>
            </li>
          ))}
        </ol>
      </nav>

      {h.sections.map((section, i) => (
        <section key={section.id} id={section.id} aria-labelledby={`${section.id}-title`} className="mt-10 scroll-mt-6">
          <h2 id={`${section.id}-title`} className="text-xl font-semibold">
            {i + 1}. {section.title}
          </h2>
          <ul className="mt-3 list-disc space-y-2 pl-5 leading-relaxed">
            {section.items.map((item, j) => (
              <li key={j}>{item}</li>
            ))}
          </ul>
        </section>
      ))}
    </main>
  );
}
