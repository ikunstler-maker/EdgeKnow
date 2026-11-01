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
    <section className="mt-10 rounded-lg border border-border p-4" aria-label={a.appearance} data-appearance>
      <h2 className="font-semibold">{a.appearance}</h2>
      <p className="mt-1 text-sm text-muted">{a.appearanceIntro}</p>
      <label className="mt-3 flex min-h-11 items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={appearance.showMascot}
          onChange={(event) => change({ ...appearance, showMascot: event.target.checked })}
          className="h-5 w-5"
        />
        {a.showFish}
      </label>
      <fieldset className="mt-2 text-sm">
        <legend className="mb-1">{a.lure}</legend>
        {MODES.map((mode) => (
          <label key={mode} className="flex min-h-11 items-center gap-2">
            <input type="radio" name="ek-lure" checked={appearance.lure === mode} onChange={() => change({ ...appearance, lure: mode })} className="h-5 w-5" />
            {a.lureModes[mode]}
          </label>
        ))}
      </fieldset>
      {appearance.lure === "hidden" && <p className="mt-1 text-xs text-muted">{a.lureHiddenHint}</p>}
    </section>
  );
}
