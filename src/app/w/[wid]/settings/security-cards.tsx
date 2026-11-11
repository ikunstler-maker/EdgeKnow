import { t } from "@/i18n";

const sec = t.settings.security;
const badgeClass = "rounded border border-border px-1.5 text-[11px] font-semibold uppercase text-muted";

// Roles & security: settings announced but not working yet (shown greyed out, decision 2026-12-14).
export function SecurityCards() {
  return (
    <>
      <section className="flex flex-col gap-3 rounded-2xl border border-dashed border-border p-4 sm:p-5" data-device-limit>
        <div>
          <h2 className="flex flex-wrap items-center gap-2 text-lg font-semibold">
            {sec.devicesHeading} <span className={badgeClass}>{sec.soon}</span>
          </h2>
          <p className="mt-1 text-sm text-muted">{sec.devicesIntro}</p>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border pt-3 text-sm">
          <span>{sec.devicesLimit}</span>
          <span className="font-medium">{sec.devicesValue}</span>
        </div>
        <fieldset disabled className="flex flex-col gap-1 border-t border-border pt-3 text-sm opacity-70">
          <legend className="sr-only">{sec.devicesWhenFull}</legend>
          <span aria-hidden className="mb-1">{sec.devicesWhenFull}</span>
          <label className="flex min-h-11 items-center gap-2">
            <input type="radio" name="device-limit-mode" defaultChecked className="size-5" /> {sec.devicesOldest}
          </label>
          <label className="flex min-h-11 items-center gap-2">
            <input type="radio" name="device-limit-mode" className="size-5" /> {sec.devicesBlock}
          </label>
        </fieldset>
      </section>

      <section className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-dashed border-border p-4 sm:p-5" data-sso>
        <div className="min-w-0 flex-1 basis-64">
          <h2 className="flex flex-wrap items-center gap-2 text-lg font-semibold">
            {sec.ssoHeading} <span className={badgeClass}>{sec.soon} · {sec.pro}</span>
          </h2>
          <p className="mt-1 text-sm text-muted">{sec.ssoIntro}</p>
        </div>
        <button type="button" disabled className="min-h-11 rounded-lg border border-border px-3 text-sm opacity-60">
          {sec.configure}
        </button>
      </section>
    </>
  );
}
