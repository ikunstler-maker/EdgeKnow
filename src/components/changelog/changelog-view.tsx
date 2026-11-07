"use client";

import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { dateLocale, t } from "@/i18n";
import { ACTION_TYPES, releaseAnchor, type ServiceScope, type UpdateActionType } from "@/lib/changelog";

const c = t.changelog;

export type ShownRelease = {
  id: string;
  version: string;
  date: string;
  title: string;
  description: string | null;
  media: { src: string; kind: "image" | "video"; alt: string } | null;
  items: { id: string; type: UpdateActionType; scope: ServiceScope; title: string; description: string | null }[];
};

// One colour per kind of change, readable in both themes.
const TYPE_CLASS: Record<UpdateActionType, string> = {
  added: "bg-emerald-500/10 text-emerald-700 border-emerald-500/30 dark:text-emerald-300",
  improved: "bg-blue-500/10 text-blue-700 border-blue-500/30 dark:text-blue-300",
  fixed: "bg-amber-500/10 text-amber-800 border-amber-500/30 dark:text-amber-300",
  visual: "bg-purple-500/10 text-purple-700 border-purple-500/30 dark:text-purple-300",
  deprecated: "bg-zinc-500/10 text-zinc-700 border-zinc-500/30 dark:text-zinc-300",
};
const chip = "inline-flex min-h-11 shrink-0 items-center rounded-full border px-3 text-sm md:min-h-9";

const readParams = () => {
  const p = new URLSearchParams(window.location.search);
  return { scope: p.get("scope") ?? "all", type: p.get("type") ?? "all", q: p.get("q") ?? "" };
};

// The timeline with its filters: where, what kind, and a search, all kept in the address.
export function ChangelogView({ releases }: { releases: ShownRelease[] }) {
  const [scope, setScope] = useState("all");
  const [type, setType] = useState("all");
  const [query, setQuery] = useState("");
  const [copied, setCopied] = useState<string | null>(null);
  const [media, setMedia] = useState<ShownRelease["media"]>(null);
  // The address is written back only once it has been read.
  const [loaded, setLoaded] = useState(false);

  // Filters from the address once on load; a release's anchor scrolls into view.
  useEffect(() => {
    const p = readParams();
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the address is only readable in the browser
    setScope(p.scope);
    setType(p.type);
    setQuery(p.q);
    setLoaded(true);
    const target = window.location.hash.slice(1);
    if (target) requestAnimationFrame(() => document.getElementById(target)?.scrollIntoView());
  }, []);
  useEffect(() => {
    if (!loaded) return;
    const p = new URLSearchParams();
    if (scope !== "all") p.set("scope", scope);
    if (type !== "all") p.set("type", type);
    if (query.trim()) p.set("q", query.trim());
    const next = `${window.location.pathname}${p.size ? `?${p}` : ""}${window.location.hash}`;
    window.history.replaceState(null, "", next);
  }, [loaded, scope, type, query]);

  // Only places that have at least one update are offered.
  const scopes = useMemo(() => [...new Set(releases.flatMap((r) => r.items.map((i) => i.scope)))], [releases]);
  const words = query.trim().toLowerCase();
  const shown = releases
    .map((r) => {
      const releaseHit = !words || `${r.title} ${r.description ?? ""}`.toLowerCase().includes(words);
      const items = r.items.filter(
        (i) => (scope === "all" || i.scope === scope) && (type === "all" || i.type === type) && (releaseHit || `${i.title} ${i.description ?? ""}`.toLowerCase().includes(words)),
      );
      return { ...r, items };
    })
    .filter((r) => r.items.length);

  const copy = async (id: string) => {
    const url = `${window.location.origin}${window.location.pathname}#${releaseAnchor(id)}`;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(id);
      setTimeout(() => setCopied(null), 1500);
    } catch {
      window.history.replaceState(null, "", `#${releaseAnchor(id)}`);
    }
  };
  const date = (iso: string) => new Date(`${iso}T12:00:00`).toLocaleDateString(dateLocale(), { day: "numeric", month: "long", year: "numeric" });

  return (
    <>
      <div className="sticky top-0 z-10 -mx-4 mt-6 space-y-3 border-b border-border bg-background/95 px-4 py-3 backdrop-blur" data-changelog-filters>
        <div className="flex gap-2 overflow-x-auto pb-1" role="radiogroup" aria-label={c.scopeFilter}>
          {["all", ...scopes].map((value) => (
            <button
              key={value}
              type="button"
              role="radio"
              aria-checked={scope === value}
              onClick={() => setScope(value)}
              className={`${chip} ${scope === value ? "border-accent bg-accent text-white" : "border-border hover:bg-surface"}`}
              data-changelog-scope={value}
            >
              {value === "all" ? c.all : c.scopes[value]}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap gap-2">
          <select value={type} onChange={(e) => setType(e.target.value)} aria-label={c.typeFilter} className="min-h-11 rounded-md border border-border bg-background px-2 text-base md:min-h-9 md:text-sm" data-changelog-type>
            {["all", ...ACTION_TYPES].map((value) => (
              <option key={value} value={value}>
                {c.typeFilters[value]}
              </option>
            ))}
          </select>
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={c.search}
            aria-label={c.search}
            className="min-h-11 min-w-0 flex-1 rounded-md border border-border bg-background px-3 text-base md:min-h-9 md:text-sm"
            data-changelog-search
          />
        </div>
      </div>

      {!shown.length && <p className="mt-8 text-center text-muted">{c.nothing}</p>}
      <ol className="relative mt-6 space-y-8 border-l border-border pl-5">
        {shown.map((r) => (
          <li key={r.id} id={releaseAnchor(r.id)} className="relative scroll-mt-40" data-release={r.id}>
            <span className="absolute -left-[27px] top-1.5 h-3 w-3 rounded-full border-2 border-background bg-accent" aria-hidden />
            <article className="rounded-xl border border-border bg-background p-4 shadow-sm">
              <header className="flex flex-wrap items-center gap-x-2 text-sm text-muted">
                <time dateTime={r.date}>{date(r.date)}</time>
                <span aria-hidden>•</span>
                <span>{c.version(r.version)}</span>
                <button type="button" onClick={() => copy(r.id)} className="ml-auto min-h-11 rounded px-2 text-xs hover:bg-surface md:min-h-8" aria-label={`${c.copyLink}: ${r.title}`} data-release-link>
                  {copied === r.id ? `✓ ${c.copied}` : `🔗 ${c.copyLink}`}
                </button>
              </header>
              <h2 className="mt-2 text-lg font-semibold">✦ {r.title}</h2>
              {r.description && <p className="mt-1 text-muted">{r.description}</p>}
              {r.media && (
                <button type="button" onClick={() => setMedia(r.media)} aria-label={c.openMedia} className="mt-3 block w-full overflow-hidden rounded-lg border border-border">
                  {r.media.kind === "video" ? (
                    <video src={r.media.src} muted loop playsInline autoPlay className="w-full" aria-label={r.media.alt} />
                  ) : (
                    // eslint-disable-next-line @next/next/no-img-element -- our own static picture
                    <img src={r.media.src} alt={r.media.alt} loading="lazy" className="w-full" />
                  )}
                </button>
              )}
              <ul className="mt-3 space-y-3">
                {r.items.map((i) => (
                  <li key={i.id} data-update={i.type}>
                    <div className="flex flex-wrap gap-1.5">
                      <span className={`rounded-full border px-2 py-0.5 text-xs font-medium ${TYPE_CLASS[i.type]}`}>{c.types[i.type]}</span>
                      <span className="rounded-md border border-border bg-surface px-2 py-0.5 text-xs font-medium text-muted">{c.scopes[i.scope]}</span>
                    </div>
                    <p className="mt-1">• {i.title}</p>
                    {i.description && <p className="text-sm text-muted">{i.description}</p>}
                  </li>
                ))}
              </ul>
            </article>
          </li>
        ))}
      </ol>
      {media && <MediaBox media={media} onClose={() => setMedia(null)} />}
    </>
  );
}

function MediaBox({ media, onClose }: { media: NonNullable<ShownRelease["media"]>; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);
  return createPortal(
    <div role="dialog" aria-modal="true" aria-label={media.alt} className="fixed inset-0 z-[60] flex items-center justify-center bg-black/90 p-4" onClick={onClose} data-changelog-lightbox>
      <button type="button" onClick={onClose} aria-label={c.close} className="absolute right-4 top-4 min-h-11 min-w-11 rounded-full bg-white/15 text-2xl text-white">
        ✕
      </button>
      {media.kind === "video" ? (
        <video src={media.src} controls autoPlay className="max-h-[85vh] max-w-full" onClick={(e) => e.stopPropagation()} />
      ) : (
        // eslint-disable-next-line @next/next/no-img-element -- our own static picture
        <img src={media.src} alt={media.alt} className="max-h-[85vh] max-w-full object-contain" />
      )}
    </div>,
    document.body,
  );
}
