"use client";

import { useEffect, useState } from "react";
import { t } from "@/i18n";
import { groupChannels, type ChatCategory, type ChatChannel } from "@/lib/chat";
import { Icon } from "@/components/ui/icon";
import { iconButtonClass } from "@/components/ui/button";

const c = () => t.chat;

// Folded categories are remembered per browser (a convenience only).
const FOLDED_KEY = "chat-folded-categories";
function readFolded(): string[] {
  try {
    return JSON.parse(localStorage.getItem(FOLDED_KEY) ?? "[]") as string[];
  } catch {
    return [];
  }
}

// The chat's own left column: channels the person is in, under their categories;
// open channels not joined yet are found through "Browse".
export function ChannelList({
  channels,
  categories,
  activeId,
  admin,
  canCreate,
  onSelect,
  onCreate,
  onBrowse,
  onCategories,
}: {
  channels: ChatChannel[];
  categories: ChatCategory[];
  activeId: string | null;
  admin: boolean;
  canCreate: boolean;
  onSelect: (id: string) => void;
  onCreate: () => void;
  onBrowse: () => void;
  onCategories: () => void;
}) {
  const [folded, setFolded] = useState<string[]>([]);
  // After the first paint: the server has no browser storage.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setFolded(readFolded());
  }, []);
  const toggle = (id: string) => {
    const next = folded.includes(id) ? folded.filter((f) => f !== id) : [...folded, id];
    setFolded(next);
    try {
      localStorage.setItem(FOLDED_KEY, JSON.stringify(next));
    } catch {
      // Private window: folding just isn't remembered.
    }
  };
  const mine = channels.filter((ch) => ch.joined && !ch.archived_at);
  const { loose, groups } = groupChannels(mine, categories);
  const notJoined = channels.filter((ch) => !ch.joined && !ch.archived_at).length;

  return (
    <nav aria-label={c().channels} className="flex h-full min-h-0 flex-col" data-chat-channels>
      <div className="flex h-12 shrink-0 items-center gap-1 border-b border-border px-3">
        <h1 className="flex-1 truncate text-sm font-semibold">{c().title}</h1>
        {admin && <button type="button" onClick={onCategories} aria-label={c().categories.manage} title={c().categories.manage} className={iconButtonClass("ghost")} data-chat-categories><Icon name="layers" size={18} /></button>}
        {canCreate && <button type="button" onClick={onCreate} aria-label={c().create.title} title={c().create.title} className={iconButtonClass("ghost")} data-chat-create><Icon name="plus" size={18} /></button>}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        {mine.length === 0 && <p className="px-2 py-3 text-sm text-muted">{c().noChannels}</p>}
        {loose.length > 0 && (
          <ul className="mb-2">
            {loose.map((ch) => <ChannelRow key={ch.id} channel={ch} active={ch.id === activeId} onSelect={onSelect} />)}
          </ul>
        )}
        {groups.map(({ category, channels: list }) => {
          if (!list.length) return null;
          const closed = folded.includes(category.id);
          const unread = list.reduce((sum, ch) => sum + (ch.notify === "none" ? 0 : ch.unread), 0);
          return (
            <section key={category.id} className="mb-2" aria-label={category.name}>
              <button
                type="button"
                onClick={() => toggle(category.id)}
                aria-expanded={!closed}
                className="flex min-h-11 w-full items-center gap-1 rounded-md px-1.5 text-xs font-semibold uppercase tracking-wide text-muted hover:text-foreground md:min-h-7"
              >
                <Icon name={closed ? "chevron-right" : "chevron-down"} size={14} />
                <span className="flex-1 truncate text-left">{category.name}</span>
                {category.restricted && <Icon name="lock" size={12} />}
                {closed && unread > 0 && <span className="rounded-full bg-accent px-1.5 text-[11px] font-semibold text-white normal-case">{unread > 99 ? "99+" : unread}</span>}
              </button>
              {!closed && (
                <ul>
                  {list.map((ch) => <ChannelRow key={ch.id} channel={ch} active={ch.id === activeId} onSelect={onSelect} />)}
                </ul>
              )}
            </section>
          );
        })}
        <button type="button" onClick={onBrowse} className="mt-1 flex min-h-11 w-full items-center gap-2 rounded-lg px-2.5 text-sm text-muted hover:bg-hover hover:text-foreground md:min-h-8" data-chat-browse>
          <Icon name="search" size={16} />
          <span className="flex-1 text-left">{c().browse.title}</span>
          {notJoined > 0 && <span className="text-xs">{notJoined}</span>}
        </button>
      </div>
    </nav>
  );
}

function ChannelRow({ channel, active, onSelect }: { channel: ChatChannel; active: boolean; onSelect: (id: string) => void }) {
  const unread = channel.notify === "none" ? 0 : channel.unread;
  const loud = unread > 0 && (channel.notify === "all" || channel.mentioned);
  return (
    <li>
      <button
        type="button"
        onClick={() => onSelect(channel.id)}
        aria-current={active ? "page" : undefined}
        className={`flex min-h-11 w-full items-center gap-2 rounded-lg px-2.5 text-sm md:min-h-8 ${
          active ? "bg-hover font-medium text-foreground" : loud ? "font-semibold text-foreground hover:bg-hover" : "text-muted hover:bg-hover hover:text-foreground"
        }`}
        data-chat-channel={channel.id}
      >
        <Icon name={channel.visibility === "closed" ? "lock" : "hash"} size={15} />
        <span className="min-w-0 flex-1 truncate text-left">{channel.name}</span>
        {channel.mentioned && unread > 0 ? (
          <span className="rounded-full bg-accent px-1.5 text-[11px] font-semibold text-white" aria-label={c().mentioned}>@</span>
        ) : loud ? (
          <span className="rounded-full bg-accent px-1.5 text-[11px] font-semibold text-white" aria-label={c().unread(unread)}>{unread > 99 ? "99+" : unread}</span>
        ) : null}
      </button>
    </li>
  );
}
