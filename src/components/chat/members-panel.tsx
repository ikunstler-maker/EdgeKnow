"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { t } from "@/i18n";
import type { ChatChannel, ChatMember, ChatPerson } from "@/lib/chat";
import { addMembers, loadMembers, removeMember, setMemberCanPost, setMemberHistory, setMemberRole } from "@/app/chat-actions";
import { Icon } from "@/components/ui/icon";
import { iconButtonClass, inputClass } from "@/components/ui/button";

const c = () => t.chat.members;

// The channel's people (right panel): who was added or joined, owners first; adding
// people (anyone in the channel; guests only by who manages it); roles and removal.
export function MembersPanel({
  shortId,
  channel,
  people,
  units,
  canManage,
  guest,
  onClose,
  onChanged,
  onError,
}: {
  shortId: string;
  channel: ChatChannel;
  people: ChatPerson[];
  units: { id: string; name: string }[];
  canManage: boolean;
  guest: boolean;
  onClose: () => void;
  onChanged: () => void;
  onError: (code: string) => void;
}) {
  const [members, setMembers] = useState<ChatMember[] | null>(null);
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  // Someone about to be added while the earlier history is hidden: show it to them?
  const [asking, setAsking] = useState<ChatPerson | null>(null);
  const byId = useMemo(() => new Map(people.map((p) => [p.id, p])), [people]);

  const reload = useCallback(async () => setMembers(await loadMembers(shortId, channel.id)), [shortId, channel.id]);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void reload();
  }, [reload]);

  const sorted = useMemo(
    () =>
      [...(members ?? [])].sort(
        (a, b) => (a.role === b.role ? 0 : a.role === "owner" ? -1 : 1) || (byId.get(a.user_id)?.name ?? "").localeCompare(byId.get(b.user_id)?.name ?? ""),
      ),
    [members, byId],
  );
  const invited = new Set((members ?? []).filter((m) => m.invited).map((m) => m.user_id));
  const candidates = query.trim()
    ? people
        .filter((p) => !invited.has(p.id) && (!p.guest || canManage || channel.visibility === "direct") && p.name.toLowerCase().includes(query.trim().toLowerCase()))
        .slice(0, 8)
    : [];
  const unit = channel.unit_id ? units.find((u) => u.id === channel.unit_id) : undefined;
  // A conversation of two takes nobody more (a new group conversation is opened instead).
  const pair = channel.visibility === "direct" && (channel.people?.length ?? 0) <= 2;
  const hidesHistory = channel.visibility !== "open" && !channel.history_visible;
  const add = (person: ChatPerson, showHistory: boolean | null) => {
    setQuery("");
    setAsking(null);
    void run(() => addMembers(shortId, channel.id, [person.id], showHistory));
  };

  const run = async (action: () => Promise<{ ok: boolean; error?: string }>) => {
    setBusy(true);
    const result = await action();
    setBusy(false);
    if (!result.ok) onError(result.error ?? "unknown");
    await reload();
    onChanged();
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex h-12 shrink-0 items-center gap-2 border-b border-border px-3">
        <h3 className="flex-1 text-sm font-semibold">{c().title}</h3>
        <button type="button" onClick={onClose} aria-label={t.common.close} className={iconButtonClass("ghost")}>
          <Icon name="close" size={18} />
        </button>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        {channel.visibility === "open" && <p className="mb-3 text-xs text-muted">{c().openNote}</p>}
        {unit && <p className="mb-3 text-xs text-muted">{c().unitNote(unit.name)}</p>}
        {pair && <p className="mb-3 text-xs text-muted">{c().pairNote}</p>}
        {asking && (
          <div role="alertdialog" aria-label={t.chat.history.ask(asking.name)} className="mb-3 rounded-lg border border-border bg-surface p-3 text-sm" data-chat-history-ask>
            <p className="mb-2">{t.chat.history.ask(asking.name)}</p>
            <div className="flex flex-wrap gap-2">
              <button type="button" onClick={() => add(asking, true)} className="min-h-11 rounded-md bg-accent px-3 text-sm text-white md:min-h-8" data-chat-history-yes>
                {t.chat.history.show}
              </button>
              <button type="button" onClick={() => add(asking, false)} className="min-h-11 rounded-md border border-border px-3 text-sm md:min-h-8" data-chat-history-no>
                {t.chat.history.onlyNew}
              </button>
              <button type="button" onClick={() => setAsking(null)} className="min-h-11 rounded-md px-3 text-sm text-muted md:min-h-8">
                {t.common.cancel}
              </button>
            </div>
          </div>
        )}
        {(!guest || channel.visibility === "direct") && !channel.archived_at && !pair && (
          <div className="mb-3">
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={c().addPlaceholder}
              aria-label={c().add}
              className={inputClass}
              data-chat-member-search
            />
            {candidates.length > 0 && (
              <ul className="mt-1 rounded-lg border border-border bg-overlay p-1">
                {candidates.map((p) => (
                  <li key={p.id}>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => (hidesHistory ? setAsking(p) : add(p, null))}
                      className="flex min-h-11 w-full items-center gap-2 rounded-md px-2 text-left text-sm hover:bg-hover md:min-h-8"
                    >
                      <Icon name="plus" size={14} />
                      <span className="flex-1 truncate">{p.name}</span>
                      {p.guest && <span className="text-[10px] uppercase text-muted">{t.chat.guest}</span>}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
        {members === null ? (
          <p className="text-sm text-muted">{t.chat.loading}</p>
        ) : (
          <ul className="flex flex-col gap-0.5">
            {sorted.map((m) => {
              const person = byId.get(m.user_id);
              return (
                <li key={m.user_id} className="flex min-h-11 items-center gap-2 rounded-md px-1 md:min-h-9" data-chat-member={m.user_id}>
                  <span className="min-w-0 flex-1 truncate text-sm">{person?.name ?? t.chat.formerMember}</span>
                  {person?.guest && <span className="text-[10px] uppercase text-muted">{t.chat.guest}</span>}
                  {m.role === "owner" && <span className="text-xs text-muted">{c().owner}</span>}
                  {channel.post_policy === "chosen" && m.can_post && m.role !== "owner" && <span className="text-xs text-muted">{t.chat.publish.publisher}</span>}
                  {channel.post_policy === "chosen" && canManage && m.role !== "owner" && (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void run(() => setMemberCanPost(shortId, channel.id, m.user_id, !m.can_post))}
                      aria-pressed={m.can_post}
                      aria-label={m.can_post ? t.chat.publish.revoke(person?.name ?? t.chat.formerMember) : t.chat.publish.grant(person?.name ?? t.chat.formerMember)}
                      title={m.can_post ? t.chat.publish.revoke(person?.name ?? t.chat.formerMember) : t.chat.publish.grant(person?.name ?? t.chat.formerMember)}
                      className={iconButtonClass(m.can_post ? "subtle" : "ghost")}
                      data-chat-can-post
                    >
                      <Icon name="send" size={15} />
                    </button>
                  )}
                  {m.history_from && canManage && (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void run(() => setMemberHistory(shortId, channel.id, m.user_id, true))}
                      aria-label={t.chat.history.showFor(person?.name ?? t.chat.formerMember)}
                      title={t.chat.history.showFor(person?.name ?? t.chat.formerMember)}
                      className={iconButtonClass("ghost")}
                      data-chat-show-history
                    >
                      <Icon name="history" size={15} />
                    </button>
                  )}
                  {canManage && m.invited && !person?.guest && channel.visibility !== "direct" && (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void run(() => setMemberRole(shortId, channel.id, m.user_id, m.role === "owner" ? "member" : "owner"))}
                      aria-label={m.role === "owner" ? c().makeMember : c().makeOwner}
                      title={m.role === "owner" ? c().makeMember : c().makeOwner}
                      className={iconButtonClass("ghost")}
                    >
                      <Icon name="shield" size={15} />
                    </button>
                  )}
                  {canManage && !pair && (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void run(() => removeMember(shortId, channel.id, m.user_id))}
                      aria-label={c().remove}
                      title={c().remove}
                      className={iconButtonClass("ghost")}
                    >
                      <Icon name="close" size={15} />
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
