"use client";

import { useEffect, useState, type ReactNode } from "react";
import { t } from "@/i18n";
import type { ActionResult } from "@/lib/action-result";
import type { ChatCategory, ChatChannel, ChatNotify, ChatPerson } from "@/lib/chat";
import {
  archiveChannel,
  createChannel,
  deleteCategory,
  deleteChannel,
  joinChannel,
  leaveChannel,
  loadCategoryAccess,
  reorderCategories,
  saveCategory,
  setCategoryAccess,
  setNotify,
  updateChannel,
} from "@/app/chat-actions";
import { Dialog } from "@/components/ui/dialog";
import { Segmented } from "@/components/ui/segmented";
import { Icon } from "@/components/ui/icon";
import { buttonClass, iconButtonClass, inputClass } from "@/components/ui/button";

const c = () => t.chat;
const errorText = (code: string) => (c().errors as Record<string, string>)[code] ?? c().errors.unknown;

function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <label className="flex flex-col gap-1 text-sm">
      <span className="font-medium">{label}</span>
      {children}
      {hint && <span className="text-xs text-muted">{hint}</span>}
    </label>
  );
}

function ErrorLine({ error }: { error: string | null }) {
  return error ? <p role="alert" className="text-sm text-danger">{error}</p> : null;
}

const selectClass = `${inputClass} pr-8`;

// ---------------------------------------------------------------- create

export function CreateChannelDialog({
  shortId,
  workspaceId,
  categories,
  units,
  canOpen,
  canClosed,
  onClose,
  onCreated,
}: {
  shortId: string;
  workspaceId: string;
  categories: ChatCategory[];
  units: { id: string; name: string }[];
  canOpen: boolean;
  canClosed: boolean;
  onClose: () => void;
  onCreated: (id: string) => void;
}) {
  const [name, setName] = useState("");
  const [topic, setTopic] = useState("");
  const [kind, setKind] = useState<"open" | "closed">(canOpen ? "open" : "closed");
  const [categoryId, setCategoryId] = useState("");
  const [unitId, setUnitId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const options = [
    ...(canOpen ? [{ value: "open" as const, label: c().create.open, icon: "hash" as const }] : []),
    ...(canClosed ? [{ value: "closed" as const, label: c().create.closed, icon: "lock" as const }] : []),
  ];

  const submit = async () => {
    setBusy(true);
    setError(null);
    const result = await createChannel(shortId, workspaceId, {
      name,
      topic,
      closed: kind === "closed",
      categoryId: categoryId || null,
      unitId: kind === "closed" ? unitId || null : null,
    });
    setBusy(false);
    if (!result.ok) return setError(errorText(result.error));
    onCreated(result.id);
  };

  return (
    <Dialog
      title={c().create.title}
      onClose={onClose}
      footer={
        <>
          <button type="button" onClick={onClose} className={buttonClass("ghost")}>{t.common.cancel}</button>
          <button type="button" onClick={submit} disabled={busy || !name.trim()} className={buttonClass("primary")} data-chat-create-submit>
            {c().create.submit}
          </button>
        </>
      }
    >
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (name.trim()) void submit();
        }}
      >
        <Field label={c().create.name}>
          <input value={name} onChange={(e) => setName(e.target.value)} maxLength={80} className={inputClass} autoFocus data-chat-create-name />
        </Field>
        <Field label={c().create.topic}>
          <input value={topic} onChange={(e) => setTopic(e.target.value)} maxLength={250} className={inputClass} />
        </Field>
        {options.length > 1 ? (
          <Segmented label={c().create.kind} value={kind} options={options} onChange={setKind} />
        ) : null}
        <p className="text-xs text-muted">{kind === "open" ? c().create.openHint : c().create.closedHint}</p>
        {categories.length > 0 && (
          <Field label={c().create.category}>
            <select value={categoryId} onChange={(e) => setCategoryId(e.target.value)} className={selectClass}>
              <option value="">{c().create.noCategory}</option>
              {categories.map((k) => (
                <option key={k.id} value={k.id}>{k.name}</option>
              ))}
            </select>
          </Field>
        )}
        {kind === "closed" && units.length > 0 && (
          <Field label={c().create.unit} hint={c().create.unitHint}>
            <select value={unitId} onChange={(e) => setUnitId(e.target.value)} className={selectClass} data-chat-create-unit>
              <option value="">{c().create.noUnit}</option>
              {units.map((u) => (
                <option key={u.id} value={u.id}>{u.name}</option>
              ))}
            </select>
          </Field>
        )}
        <ErrorLine error={error} />
      </form>
    </Dialog>
  );
}

// ---------------------------------------------------------------- settings

export function ChannelSettingsDialog({
  shortId,
  channel,
  categories,
  units,
  canManage,
  onClose,
  onChanged,
  onGone,
}: {
  shortId: string;
  channel: ChatChannel;
  categories: ChatCategory[];
  units: { id: string; name: string }[];
  canManage: boolean;
  onClose: () => void;
  onChanged: () => Promise<void> | void;
  onGone: () => void;
}) {
  const [name, setName] = useState(channel.name);
  const [topic, setTopic] = useState(channel.topic);
  const [categoryId, setCategoryId] = useState(channel.category_id ?? "");
  const [unitId, setUnitId] = useState(channel.unit_id ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const run = async (action: () => Promise<ActionResult>, after?: () => void) => {
    setBusy(true);
    setError(null);
    setSaved(false);
    const result = await action();
    setBusy(false);
    if (!result.ok) return setError(errorText(result.error));
    await onChanged();
    if (after) after();
    else setSaved(true);
  };
  const category = categories.find((k) => k.id === categoryId);
  const moving = categoryId !== (channel.category_id ?? "") && category?.restricted;

  return (
    <Dialog title={c().settings.title} onClose={onClose} width={520}>
      <div className="flex flex-col gap-5">
        {canManage && !channel.archived_at && (
          <section className="flex flex-col gap-3">
            <Field label={c().create.name}>
              <input value={name} onChange={(e) => setName(e.target.value)} maxLength={80} className={inputClass} />
            </Field>
            <Field label={c().create.topic}>
              <input value={topic} onChange={(e) => setTopic(e.target.value)} maxLength={250} className={inputClass} />
            </Field>
            {categories.length > 0 && (
              <Field label={c().create.category} hint={moving ? c().settings.restrictedWarning : undefined}>
                <select value={categoryId} onChange={(e) => setCategoryId(e.target.value)} className={selectClass}>
                  <option value="">{c().create.noCategory}</option>
                  {categories.map((k) => (
                    <option key={k.id} value={k.id}>{k.name}</option>
                  ))}
                </select>
              </Field>
            )}
            {channel.visibility === "closed" && units.length > 0 && (
              <Field label={c().create.unit} hint={c().create.unitHint}>
                <select value={unitId} onChange={(e) => setUnitId(e.target.value)} className={selectClass}>
                  <option value="">{c().create.noUnit}</option>
                  {units.map((u) => (
                    <option key={u.id} value={u.id}>{u.name}</option>
                  ))}
                </select>
              </Field>
            )}
            <div>
              <button
                type="button"
                disabled={busy || !name.trim()}
                onClick={() => run(() => updateChannel(shortId, channel.id, { name, topic, categoryId: categoryId || null, unitId: unitId || null }))}
                className={buttonClass("primary")}
              >
                {t.common.save}
              </button>
            </div>
          </section>
        )}

        {channel.joined && (
          <Field label={c().settings.notify}>
            <select
              value={channel.notify}
              disabled={busy}
              onChange={(e) => run(() => setNotify(shortId, channel.id, e.target.value as ChatNotify))}
              className={selectClass}
              data-chat-notify
            >
              <option value="all">{c().settings.notifyAll}</option>
              <option value="mentions">{c().settings.notifyMentions}</option>
              <option value="none">{c().settings.notifyNone}</option>
            </select>
          </Field>
        )}

        {saved && <p role="status" className="text-sm text-muted">{c().settings.saved}</p>}
        <ErrorLine error={error} />

        <section className="flex flex-wrap gap-2 border-t border-border pt-4">
          {channel.joined && channel.role !== null && (
            <button type="button" disabled={busy} onClick={() => run(() => leaveChannel(shortId, channel.id), onGone)} className={buttonClass("subtle")}>
              <Icon name="sign-out" size={15} />
              {c().settings.leave}
            </button>
          )}
          {canManage && (
            <button type="button" disabled={busy} onClick={() => run(() => archiveChannel(shortId, channel.id, !channel.archived_at))} className={buttonClass("subtle")}>
              {channel.archived_at ? c().settings.unarchive : c().settings.archive}
            </button>
          )}
          {canManage && (
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                if (window.confirm(c().settings.deleteConfirm(channel.name))) void run(() => deleteChannel(shortId, channel.id), onGone);
              }}
              className={buttonClass("danger")}
              data-chat-delete-channel
            >
              <Icon name="trash" size={15} />
              {c().settings.delete}
            </button>
          )}
        </section>
      </div>
    </Dialog>
  );
}

// ---------------------------------------------------------------- browse

export function BrowseDialog({
  shortId,
  channels,
  onClose,
  onOpen,
  onJoined,
}: {
  shortId: string;
  channels: ChatChannel[];
  onClose: () => void;
  onOpen: (id: string) => void;
  onJoined: () => Promise<void> | void;
}) {
  const [query, setQuery] = useState("");
  const [showArchived, setShowArchived] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const q = query.trim().toLowerCase();
  const list = channels
    .filter((ch) => (showArchived ? Boolean(ch.archived_at) : !ch.archived_at))
    .filter((ch) => !q || ch.name.toLowerCase().includes(q) || ch.topic.toLowerCase().includes(q))
    .sort((a, b) => a.name.localeCompare(b.name));

  return (
    <Dialog title={c().browse.title} onClose={onClose} width={520}>
      <div className="flex flex-col gap-3">
        <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder={c().browse.search} aria-label={c().browse.search} className={inputClass} autoFocus />
        <label className="flex min-h-11 items-center gap-2 text-sm md:min-h-0">
          <input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} />
          {c().browse.archived}
        </label>
        <ErrorLine error={error} />
        {list.length === 0 && <p className="text-sm text-muted">{c().browse.none}</p>}
        <ul className="flex flex-col gap-1">
          {list.map((ch) => (
            <li key={ch.id} className="flex items-center gap-2 rounded-lg border border-border px-3 py-2" data-chat-browse-row={ch.id}>
              <Icon name={ch.visibility === "closed" ? "lock" : "hash"} size={15} className="text-muted" />
              <button type="button" onClick={() => onOpen(ch.id)} className="min-h-11 min-w-0 flex-1 text-left md:min-h-0">
                <span className="block truncate text-sm font-medium">{ch.name}</span>
                {ch.topic && <span className="block truncate text-xs text-muted">{ch.topic}</span>}
              </button>
              {ch.joined ? (
                <span className="text-xs text-muted">{c().browse.joined}</span>
              ) : (
                !ch.archived_at && (
                  <button
                    type="button"
                    disabled={busy === ch.id}
                    onClick={async () => {
                      setBusy(ch.id);
                      const result = await joinChannel(shortId, ch.id);
                      setBusy(null);
                      if (!result.ok) return setError(errorText(result.error));
                      await onJoined();
                      onOpen(ch.id);
                    }}
                    className={buttonClass("subtle")}
                  >
                    {c().join}
                  </button>
                )
              )}
            </li>
          ))}
        </ul>
      </div>
    </Dialog>
  );
}

// ---------------------------------------------------------------- categories (owner and admins)

export function CategoriesDialog({
  shortId,
  workspaceId,
  categories,
  people,
  units,
  onClose,
  onChanged,
}: {
  shortId: string;
  workspaceId: string;
  categories: ChatCategory[];
  people: ChatPerson[];
  units: { id: string; name: string }[];
  onClose: () => void;
  onChanged: () => Promise<void> | void;
}) {
  const [newName, setNewName] = useState("");
  const [editing, setEditing] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const sorted = [...categories].sort((a, b) => a.position - b.position || a.name.localeCompare(b.name));

  const run = async (action: () => Promise<ActionResult>) => {
    setBusy(true);
    setError(null);
    const result = await action();
    setBusy(false);
    if (!result.ok) {
      setError(errorText(result.error));
      return false;
    }
    await onChanged();
    return true;
  };
  const move = (index: number, by: number) => {
    const ids = sorted.map((k) => k.id);
    const [item] = ids.splice(index, 1);
    ids.splice(index + by, 0, item);
    void run(() => reorderCategories(shortId, workspaceId, ids));
  };

  return (
    <Dialog title={c().categories.manage} onClose={onClose} width={560}>
      <div className="flex flex-col gap-4">
        <p className="text-sm text-muted">{c().categories.about}</p>
        <form
          className="flex gap-2"
          onSubmit={async (e) => {
            e.preventDefault();
            if (newName.trim() && (await run(() => saveCategory(shortId, workspaceId, null, newName, false)))) setNewName("");
          }}
        >
          <input value={newName} onChange={(e) => setNewName(e.target.value)} maxLength={60} placeholder={c().categories.newName} aria-label={c().categories.newName} className={inputClass} data-chat-category-name />
          <button type="submit" disabled={busy || !newName.trim()} className={buttonClass("primary")}>{c().categories.add}</button>
        </form>
        <ErrorLine error={error} />
        <ul className="flex flex-col gap-2">
          {sorted.map((k, i) => (
            <li key={k.id} className="rounded-lg border border-border" data-chat-category={k.id}>
              <div className="flex items-center gap-1 px-2 py-1">
                {k.restricted && <Icon name="lock" size={14} className="text-muted" />}
                <span className="min-w-0 flex-1 truncate text-sm font-medium">{k.name}</span>
                <button type="button" disabled={busy || i === 0} onClick={() => move(i, -1)} aria-label={c().categories.up} className={iconButtonClass("ghost")}><Icon name="arrow-up" size={15} /></button>
                <button type="button" disabled={busy || i === sorted.length - 1} onClick={() => move(i, 1)} aria-label={c().categories.down} className={iconButtonClass("ghost")}><Icon name="arrow-down" size={15} /></button>
                <button type="button" onClick={() => setEditing(editing === k.id ? null : k.id)} aria-expanded={editing === k.id} aria-label={c().categories.edit} className={iconButtonClass("ghost")}><Icon name="edit" size={15} /></button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => {
                    if (window.confirm(c().categories.deleteConfirm(k.name))) void run(() => deleteCategory(shortId, workspaceId, k.id));
                  }}
                  aria-label={c().categories.delete}
                  className={iconButtonClass("ghost")}
                >
                  <Icon name="trash" size={15} />
                </button>
              </div>
              {editing === k.id && (
                <CategoryEditor shortId={shortId} workspaceId={workspaceId} category={k} people={people} units={units} busy={busy} run={run} />
              )}
            </li>
          ))}
        </ul>
      </div>
    </Dialog>
  );
}

function CategoryEditor({
  shortId,
  workspaceId,
  category,
  people,
  units,
  busy,
  run,
}: {
  shortId: string;
  workspaceId: string;
  category: ChatCategory;
  people: ChatPerson[];
  units: { id: string; name: string }[];
  busy: boolean;
  run: (action: () => Promise<ActionResult>) => Promise<boolean>;
}) {
  const [name, setName] = useState(category.name);
  const [restricted, setRestricted] = useState(category.restricted);
  const [groupIds, setGroupIds] = useState<string[]>([]);
  const [userIds, setUserIds] = useState<string[]>([]);
  const [query, setQuery] = useState("");
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    let live = true;
    void loadCategoryAccess(shortId, category.id).then((rows) => {
      if (!live) return;
      setGroupIds(rows.flatMap((r) => (r.group_id ? [r.group_id] : [])));
      setUserIds(rows.flatMap((r) => (r.user_id ? [r.user_id] : [])));
      setLoaded(true);
    });
    return () => {
      live = false;
    };
  }, [shortId, category.id]);
  const toggle = (list: string[], id: string) => (list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);
  const q = query.trim().toLowerCase();
  const found = q ? people.filter((p) => !userIds.includes(p.id) && p.name.toLowerCase().includes(q)).slice(0, 6) : [];
  const byId = new Map(people.map((p) => [p.id, p]));

  return (
    <div className="flex flex-col gap-3 border-t border-border p-3">
      <Field label={c().categories.name}>
        <input value={name} onChange={(e) => setName(e.target.value)} maxLength={60} className={inputClass} />
      </Field>
      <label className="flex min-h-11 items-center gap-2 text-sm md:min-h-0">
        <input type="checkbox" checked={restricted} onChange={(e) => setRestricted(e.target.checked)} data-chat-category-restricted />
        {c().categories.restricted}
      </label>
      {restricted && (
        <div className="flex flex-col gap-3 rounded-lg bg-surface p-3">
          <p className="text-xs text-muted">{c().categories.restrictedHint}</p>
          {!loaded ? (
            <p className="text-sm text-muted">{c().loading}</p>
          ) : (
            <>
              {units.length > 0 && (
                <fieldset className="flex flex-col gap-1">
                  <legend className="mb-1 text-sm font-medium">{c().categories.units}</legend>
                  {units.map((u) => (
                    <label key={u.id} className="flex min-h-11 items-center gap-2 text-sm md:min-h-7">
                      <input type="checkbox" checked={groupIds.includes(u.id)} onChange={() => setGroupIds((l) => toggle(l, u.id))} />
                      {u.name}
                    </label>
                  ))}
                </fieldset>
              )}
              <div className="flex flex-col gap-1">
                <span className="text-sm font-medium">{c().categories.people}</span>
                <div className="flex flex-wrap gap-1">
                  {userIds.map((id) => (
                    <span key={id} className="inline-flex items-center gap-1 rounded-full border border-border px-2 py-0.5 text-xs">
                      {byId.get(id)?.name ?? t.chat.formerMember}
                      <button type="button" onClick={() => setUserIds((l) => l.filter((x) => x !== id))} aria-label={c().members.remove} className="inline-flex h-6 w-6 items-center justify-center">
                        <Icon name="close" size={12} />
                      </button>
                    </span>
                  ))}
                </div>
                <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder={c().members.addPlaceholder} aria-label={c().categories.people} className={inputClass} />
                {found.length > 0 && (
                  <ul className="rounded-lg border border-border bg-overlay p-1">
                    {found.map((p) => (
                      <li key={p.id}>
                        <button type="button" onClick={() => { setUserIds((l) => [...l, p.id]); setQuery(""); }} className="flex min-h-11 w-full items-center gap-2 rounded-md px-2 text-left text-sm hover:bg-hover md:min-h-8">
                          <Icon name="plus" size={14} />
                          <span className="flex-1 truncate">{p.name}</span>
                          {p.guest && <span className="text-[10px] uppercase text-muted">{t.chat.guest}</span>}
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </>
          )}
        </div>
      )}
      <div>
        <button
          type="button"
          disabled={busy || !name.trim() || (restricted && !loaded)}
          onClick={async () => {
            const ok = await run(() => saveCategory(shortId, workspaceId, category.id, name, restricted));
            if (ok && restricted) await run(() => setCategoryAccess(shortId, workspaceId, category.id, groupIds, userIds));
          }}
          className={buttonClass("primary")}
          data-chat-category-save
        >
          {t.common.save}
        </button>
      </div>
    </div>
  );
}
