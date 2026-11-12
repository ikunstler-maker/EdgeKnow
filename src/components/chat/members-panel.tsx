"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { t } from "@/i18n";
import type { ChatChannel, ChatMember, ChatPerson } from "@/lib/chat";
import { addMembers, loadMembers, removeMember, setMemberRole } from "@/app/chat-actions";
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
    ? people.filter((p) => !invited.has(p.id) && (!p.guest || canManage) && p.name.toLowerCase().includes(query.trim().toLowerCase())).slice(0, 8)
    : [];
  const unit = channel.unit_id ? units.find((u) => u.id === channel.unit_id) : undefined;

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
        {!guest && !channel.archived_at && (
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
                      onClick={() => {
                        setQuery("");
                        void run(() => addMembers(shortId, channel.id, [p.id]));
                      }}
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
                  {canManage && m.invited && !person?.guest && (
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
                  {canManage && (
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
