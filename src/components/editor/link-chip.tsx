"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { t } from "@/i18n";
import { useOptionalPages } from "@/components/pages/pages-provider";
import { ServiceIcon } from "@/components/services/service-icon";
import { Icon } from "@/components/ui/icon";
import { cellChipOf, onCellChips } from "@/components/sheets/sheet-chips";

// A workspace link shown as a chip (smart chips, UI-3/UI-4): the service's mark and the
// linked thing's live title with the viewer's access; "No access" otherwise; nothing for a
// link that isn't to this workspace.
const noSubscribe = () => () => {};

export function LinkChip({ link, className = "", attr = "data-link-chip" }: { link?: string | null; className?: string; attr?: string }) {
  const pages = useOptionalPages();
  const [, setTick] = useState(0);
  // Drawn in the browser only (the server can't tell which links are this workspace's).
  const inBrowser = useSyncExternalStore(noSubscribe, () => true, () => false);
  useEffect(() => {
    const off = onCellChips(() => setTick((x) => x + 1));
    return () => {
      off();
    };
  }, []);
  if (!link || !pages || !inBrowser) return null;
  const chip = cellChipOf(link, pages.workspace.shortId, pages.workspace.id);
  if (!chip) return null;
  if (chip.state !== "ok")
    return (
      <span className={`inline-flex items-center gap-1 rounded-full border border-border bg-surface px-2 py-0.5 text-xs text-muted ${className}`} {...{ [attr]: chip.state }}>
        {chip.state === "none" ? <Icon name="lock" size={12} /> : null}
        {chip.state === "none" ? t.editor.chips.noAccess : "…"}
      </span>
    );
  return (
    <a
      href={chip.href}
      onClick={(e) => e.stopPropagation()}
      className={`nodrag inline-flex max-w-full items-center gap-1 truncate rounded-full border border-border bg-background px-2 py-0.5 text-xs text-foreground hover:bg-surface ${className}`}
      {...{ [attr]: chip.title }}
    >
      {chip.service === "home" ? <Icon name="gift" size={12} /> : <ServiceIcon serviceId={chip.service} size={12} />}
      <span className="truncate">{chip.title || t.editor.chips.untitledObject}</span>
    </a>
  );
}
