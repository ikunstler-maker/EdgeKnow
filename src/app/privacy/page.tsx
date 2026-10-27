import type { Metadata } from "next";
import { t } from "@/i18n";

export const metadata: Metadata = { title: `${t.privacy.title} · ${t.app.name}` };

export default function PrivacyPage() {
  return (
    <main className="mx-auto w-full max-w-2xl flex-1 px-4 py-10">
      <h1 className="text-3xl font-semibold">{t.privacy.title}</h1>
      <p className="mt-2 text-sm text-muted">{t.privacy.updated}</p>
      {t.privacy.sections.map((section) => (
        <section key={section.heading} className="mt-6">
          <h2 className="text-lg font-semibold">{section.heading}</h2>
          <p className="mt-1">{section.body}</p>
        </section>
      ))}
    </main>
  );
}
