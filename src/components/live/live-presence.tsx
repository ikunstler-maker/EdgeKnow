"use client";

import { t } from "@/i18n";
import { Icon } from "@/components/ui/icon";
import type { LiveDoc, LivePeer } from "@/lib/live/use-live-doc";
import type { StudioAction } from "@/components/ui/studio-shell";

const s = t.live;
const SHOWN = 4;

function Avatar({ peer, size }: { peer: LivePeer; size: number }) {
  const initials = peer.name
    .split(/\s+/)
    .map((w) => w[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
  return peer.avatarUrl ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={peer.avatarUrl} alt="" width={size} height={size} className="rounded-full object-cover" style={{ width: size, height: size }} />
  ) : (
    <span className="flex items-center justify-center rounded-full text-[11px] font-semibold text-white" style={{ width: size, height: size, background: peer.color }}>
      {initials || "?"}
    </span>
  );
}

// In the studio bar: who else is in the document. A click on someone follows them (your
// view goes where theirs goes); any own action stops it. People following you are shown too.
export function LivePresence<T>({ live }: { live: LiveDoc<T> }) {
  if (!live.active) return null;
  // One entry per person (a person may have two tabs open).
  const seen = new Set<string>();
  const others = live.peers.filter((p) => !p.me && !seen.has(p.userId) && seen.add(p.userId));
  const target = live.peers.find((p) => p.key === live.following);
  return (
    <>
      {others.length > 0 && (
        <div className="flex items-center" role="group" aria-label={s.inDocument} data-live-presence>
          {others.slice(0, SHOWN).map((p, i) => (
            <button
              key={p.key}
              type="button"
              onClick={() => live.follow(live.following === p.key ? null : p.key)}
              title={`${p.name}${p.editor ? "" : ` (${s.viewer})`} · ${live.following === p.key ? s.stopFollowing : s.follow(p.name)}`}
              aria-label={live.following === p.key ? s.stopFollowing : s.follow(p.name)}
              aria-pressed={live.following === p.key}
              className={`relative flex h-11 w-9 shrink-0 items-center justify-center rounded-full md:h-8 md:w-7 ${i >= 2 ? "hidden sm:flex" : ""}`}
              data-live-peer={p.name}
            >
              <span className="rounded-full p-[2px]" style={{ boxShadow: `0 0 0 2px ${live.following === p.key ? p.color : "var(--background)"}`, background: p.color }}>
                <Avatar peer={p} size={24} />
              </span>
            </button>
          ))}
          {others.length > SHOWN && (
            <span className="ml-1 hidden text-xs text-muted sm:inline" title={others.slice(SHOWN).map((p) => p.name).join(", ")}>
              {s.more(others.length - SHOWN)}
            </span>
          )}
        </div>
      )}
      {live.followers.length > 0 && (
        <span className="hidden items-center gap-1 px-1 text-xs text-muted sm:inline-flex" title={s.followers(live.followers.map((p) => p.name).join(", "))} data-live-followers={live.followers.length}>
          <Icon name="eye" size={14} />
          {live.followers.length}
        </span>
      )}
      {target && (
        <div className="fixed left-1/2 top-14 z-40 flex -translate-x-1/2 items-center gap-2 rounded-full border-2 bg-background py-1 pl-3 pr-1 text-sm shadow-lg" style={{ borderColor: target.color }} role="status" data-live-following={target.name}>
          <span className="max-w-[50vw] truncate">{s.following(target.name)}</span>
          <button type="button" onClick={() => live.follow(null)} className="flex h-11 items-center rounded-full px-3 text-xs font-medium hover:bg-hover md:h-7" data-live-unfollow>
            {s.stopFollowing}
          </button>
        </div>
      )}
    </>
  );
}

// "More" menu entries: viewers' cursors (the document's editors) and hiding others' cursors (anyone).
export function liveMenu<T>(live: LiveDoc<T>): StudioAction[] {
  if (!live.active) return [];
  return [
    ...(live.canEdit
      ? [
          {
            label: live.viewerCursors ? s.hideViewerCursors : s.showViewerCursors,
            icon: "users" as const,
            onSelect: () => live.setViewerCursors(!live.viewerCursors),
            attrs: { "data-live-viewer-cursors": live.viewerCursors ? "on" : "off" },
          },
        ]
      : []),
    {
      label: live.hideCursors ? s.showCursors : s.hideCursors,
      icon: "eye" as const,
      onSelect: () => live.setHideCursors(!live.hideCursors),
      attrs: { "data-live-hide-cursors": live.hideCursors ? "on" : "off" },
    },
  ];
}
