"use client";

import { useEffect, useState } from "react";
import { t } from "@/i18n";
import { searchChipTargets } from "@/app/chip-actions";
import { searchTasksForChip } from "@/app/task-wiki-actions";
import { pagePath, workspacePath } from "@/lib/paths";
import { vaultFileHref } from "@/lib/vault-links";
import { usePages } from "@/components/pages/pages-provider";
import { Dialog } from "@/components/ui/dialog";
import { ServiceIcon, type ServiceIconId } from "@/components/services/service-icon";
import { Icon } from "@/components/ui/icon";

// "Insert chip" in a table (UI-2): find a page, task, table, board, map, slide deck, survey,
// app, wishlist or Vault file the person sees; the cell gets its link (drawn as a chip).

export type PickedChip = { path: string; service: ServiceIconId; title: string };

export function ChipPicker({ onPick, onClose }: { onPick: (picked: PickedChip) => void; onClose: () => void }) {
  const { workspace, pages } = usePages();
  const shortId = workspace.shortId;
  const [query, setQuery] = useState("");
  const [found, setFound] = useState<PickedChip[]>([]);
  const c = t.sheets.chips;

  useEffect(() => {
    const words = query.trim();
    let alive = true;
    const timer = setTimeout(async () => {
      const lower = words.toLowerCase();
      const pageHits: PickedChip[] = pages
        .filter((p) => !lower || (p.title || "").toLowerCase().includes(lower))
        .slice(0, 6)
        .map((p) => ({ path: pagePath(shortId, p.id), service: "wiki", title: p.title || t.pages.untitled }));
      if (words.length < 2) {
        if (alive) setFound(pageHits);
        return;
      }
      const [tasks, targets] = await Promise.all([
        searchTasksForChip(shortId, words).then((r) => r.tasks).catch(() => []),
        searchChipTargets(shortId, words).catch(() => []),
      ]);
      if (!alive) return;
      setFound([
        ...pageHits,
        ...tasks.slice(0, 6).map((task) => ({ path: workspacePath(shortId, `/tasks/${task.projectKey}/${task.number}`), service: "tasks" as const, title: `${task.key} ${task.title}` })),
        ...targets.map((hit) =>
          hit.kind === "file"
            ? { path: vaultFileHref(shortId, hit.id), service: "files" as const, title: hit.title }
            : { path: workspacePath(shortId, `/${hit.service}/${hit.id}`), service: (hit.service === "wishlists" ? "home" : hit.service) as ServiceIconId, title: hit.title },
        ),
      ]);
    }, 200);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [query, pages, shortId]);

  return (
    <Dialog title={c.pickTitle} onClose={onClose}>
      <input
        autoFocus
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder={c.searchPlaceholder}
        aria-label={c.searchPlaceholder}
        className="min-h-11 w-full rounded-lg border border-border bg-background px-3 text-sm md:min-h-9"
        data-chip-picker-search
      />
      <ul className="mt-2 max-h-80 overflow-y-auto" data-chip-picker-results>
        {found.map((hit) => (
          <li key={hit.path}>
            <button
              type="button"
              onClick={() => onPick(hit)}
              className="flex min-h-11 w-full items-center gap-2 rounded-lg px-2 text-left text-sm hover:bg-surface md:min-h-9"
              data-chip-picker-item={hit.title}
            >
              {hit.service === "home" ? <Icon name="gift" size={16} /> : <ServiceIcon serviceId={hit.service} size={16} />}
              <span className="truncate">{hit.title}</span>
            </button>
          </li>
        ))}
        {!found.length && <li className="px-2 py-3 text-sm text-muted">{c.none}</li>}
      </ul>
    </Dialog>
  );
}
