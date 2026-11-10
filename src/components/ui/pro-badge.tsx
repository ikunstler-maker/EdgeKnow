import { t } from "@/i18n";

// Marks a feature of the PRO plan: shown, but greyed out until payments start.
export function ProBadge() {
  return (
    <span className="rounded bg-accent/15 px-1.5 py-0.5 text-[10px] font-semibold uppercase leading-none tracking-wide text-accent" title={t.pageExport.proHint}>
      {t.pageExport.pro}
    </span>
  );
}
