"use client";

import { useState, useSyncExternalStore } from "react";
import { dateLocale, t } from "@/i18n";
import { pageStats, type PageStats } from "@/lib/page-stats";
import { Popover } from "@/components/ui/popover";

// The editor publishes its document here (counted with a short delay while
// typing); the counter next to the page dates shows the result.
let stats: PageStats | null = null;
let timer: ReturnType<typeof setTimeout> | undefined;
const listeners = new Set<() => void>();
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};
const notify = () => listeners.forEach((listener) => listener());

export function publishPageStats(document: unknown[] | null, immediately = false) {
  clearTimeout(timer);
  const update = () => {
    stats = document ? pageStats(document) : null;
    notify();
  };
  if (immediately || !document) update();
  else timer = setTimeout(update, 300);
}

function usePageStats() {
  return useSyncExternalStore(
    subscribe,
    () => stats,
    () => null,
  );
}

export function PageStatsButton() {
  const current = usePageStats();
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  if (!current) return null;
  const number = new Intl.NumberFormat(dateLocale());
  const rows: [string, number][] = [
    [t.pageStats.characters, current.characters],
    [t.pageStats.charactersNoSpaces, current.charactersNoSpaces],
    [t.pageStats.words, current.words],
    [t.pageStats.paragraphs, current.paragraphs],
    [t.pageStats.headings, current.headings],
    [t.pageStats.images, current.images],
    [t.pageStats.links, current.links],
    [t.pageStats.tables, current.tables],
    [t.pageStats.diagrams, current.diagrams],
  ];
  return (
    <>
      <button
        type="button"
        title={t.pageStats.open}
        aria-expanded={Boolean(anchor)}
        onClick={(event) => setAnchor(anchor ? null : event.currentTarget)}
        className="rounded px-1 hover:bg-surface hover:text-foreground"
      >
        📊 {t.pageStats.summary(current.words, number.format(current.words), current.readingMinutes)}
      </button>
      {anchor && (
        <Popover anchor={anchor} onClose={() => setAnchor(null)} width={260}>
          <div className="p-2 text-sm">
            <p className="mb-2 font-medium">{t.pageStats.title}</p>
            <dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-1">
              {rows.map(([label, value]) => (
                <div key={label} className="contents">
                  <dt className="text-muted">{label}</dt>
                  <dd className="text-right tabular-nums">{number.format(value)}</dd>
                </div>
              ))}
              <dt className="text-muted">{t.pageStats.reading}</dt>
              <dd className="text-right tabular-nums">{t.pageStats.minutes(current.readingMinutes)}</dd>
            </dl>
          </div>
        </Popover>
      )}
    </>
  );
}
