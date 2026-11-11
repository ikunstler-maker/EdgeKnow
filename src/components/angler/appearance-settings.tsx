"use client";

import { t } from "@/i18n";
import { saveAppearance } from "@/app/preferences-actions";
import { useAppearance, type LureMode } from "./appearance";

const MODES: LureMode[] = ["bright", "subtle", "hidden"];

// Profile → Appearance: the angler fish and its lure.
export function AppearanceSettings() {
  const a = t.angler;
  const { appearance, setAppearance } = useAppearance();
  const change = (next: typeof appearance) => {
    setAppearance(next);
    void saveAppearance({ showMascot: next.showMascot, lure: next.lure });
  };
  return (
    <section className="rounded-xl border border-border bg-surface p-4" aria-label={a.appearance} data-appearance>
      <h2 className="text-sm font-semibold">{a.appearance}</h2>
      <p className="mt-1 text-xs text-muted">{a.appearanceIntro}</p>
      <label className="mt-3 flex min-h-11 cursor-pointer items-center gap-3 text-sm">
        <input
          type="checkbox"
          checked={appearance.showMascot}
          onChange={(event) => change({ ...appearance, showMascot: event.target.checked })}
          className="relative h-6 w-10 shrink-0 cursor-pointer appearance-none rounded-full bg-border-strong transition-colors after:absolute after:left-0.5 after:top-0.5 after:h-5 after:w-5 after:rounded-full after:bg-white after:shadow after:transition-transform checked:bg-accent checked:after:translate-x-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
        />
        {a.showFish}
      </label>
      <fieldset className="mt-3 grid gap-2 text-sm sm:grid-cols-3">
        <legend className="mb-2 text-xs text-muted">{a.lure}</legend>
        {MODES.map((mode) => (
          <label key={mode} className="flex min-h-11 cursor-pointer items-center gap-2.5 rounded-lg border border-border px-3 hover:border-border-strong has-[:checked]:border-accent has-[:checked]:bg-accent/5">
            <input type="radio" name="ek-lure" checked={appearance.lure === mode} onChange={() => change({ ...appearance, lure: mode })} className="h-4 w-4 accent-[var(--accent)]" />
            {a.lureModes[mode]}
          </label>
        ))}
      </fieldset>
      {appearance.lure === "hidden" && <p className="mt-1 text-xs text-muted">{a.lureHiddenHint}</p>}
    </section>
  );
}
