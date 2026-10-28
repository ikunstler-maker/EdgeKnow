"use client";

import { useSyncExternalStore, useTransition } from "react";
import { currentLocale, t } from "@/i18n";
import type { Locale, Theme } from "@/lib/preferences";
import { savePreferences } from "@/app/preferences-actions";

const THEME_ICONS: Record<Theme, string> = { system: "🖥", light: "☀️", dark: "🌙" };

function readTheme(): Theme {
  const picked = document.documentElement.dataset.theme;
  return picked === "light" || picked === "dark" ? picked : "system";
}

function subscribeTheme(onChange: () => void) {
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
  return () => observer.disconnect();
}

// Theme (system / light / dark) and interface language (UA | EN).
export function PreferencesSwitch({ compact = false }: { compact?: boolean }) {
  const [pending, startTransition] = useTransition();
  const theme = useSyncExternalStore(subscribeTheme, readTheme, () => "system" as Theme);
  const locale = currentLocale();

  const pickTheme = (next: Theme) =>
    startTransition(async () => {
      // On screen at once; the server remembers it for the next visit.
      if (next === "system") delete document.documentElement.dataset.theme;
      else document.documentElement.dataset.theme = next;
      await savePreferences({ theme: next });
    });

  const pickLocale = (next: Locale) =>
    startTransition(async () => {
      if (next === locale) return;
      await savePreferences({ locale: next });
      // Every text on the page changes, so the page loads again in the new language.
      window.location.reload();
    });

  const segment = (active: boolean) =>
    `flex h-8 min-w-8 items-center justify-center rounded px-1.5 text-xs ${active ? "bg-background font-semibold shadow-sm" : "text-muted hover:text-foreground"}`;

  return (
    <div className={`flex flex-wrap items-center gap-2 ${compact ? "" : "px-3"}`}>
      <div role="radiogroup" aria-label={t.prefs.theme} className="flex gap-0.5 rounded-md bg-surface p-0.5">
        {(["system", "light", "dark"] as const).map((value) => (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={theme === value}
            aria-label={t.prefs.themes[value]}
            title={t.prefs.themes[value]}
            disabled={pending}
            onClick={() => pickTheme(value)}
            className={segment(theme === value)}
          >
            {THEME_ICONS[value]}
          </button>
        ))}
      </div>
      <div role="radiogroup" aria-label={t.prefs.language} className="flex items-center gap-0.5 rounded-md bg-surface p-0.5">
        <button type="button" role="radio" aria-checked={locale === "uk"} lang="uk" title="Українська" disabled={pending} onClick={() => pickLocale("uk")} className={segment(locale === "uk")}>
          UA
        </button>
        <span aria-hidden="true" className="text-xs text-muted">
          |
        </span>
        <button type="button" role="radio" aria-checked={locale === "en"} lang="en" title="English" disabled={pending} onClick={() => pickLocale("en")} className={segment(locale === "en")}>
          EN
        </button>
      </div>
    </div>
  );
}
