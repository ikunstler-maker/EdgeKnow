"use client";

import { useState, useTransition } from "react";
import { t } from "@/i18n";
import type { ActionResult } from "@/lib/action-result";
import { createGroup, deleteGroup, renameGroup, setGroupMember } from "@/app/workspace-actions";

export type GroupItem = { id: string; name: string; memberIds: string[] };
export type GroupPerson = { userId: string; name: string | null; email: string };

const g = t.settings.groups;
const inputClass = "min-h-11 rounded-md border border-border bg-background px-3 text-base md:text-sm";
const buttonClass = "min-h-11 rounded-md border border-border px-3 text-sm hover:bg-surface disabled:opacity-60";
const primaryClass = "min-h-11 rounded-md bg-accent px-4 text-sm font-medium text-white disabled:opacity-60";

// Groups of people (owner and admins): who is in each; pages are shared with a
// group from the page's "Share" dialog.
export function GroupsPanel({ workspaceId, groups, people }: { workspaceId: string; groups: GroupItem[]; people: GroupPerson[] }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState("");
  const run = (action: () => Promise<ActionResult>, onOk?: () => void) =>
    startTransition(async () => {
      const result = await action();
      setError(result.ok ? null : (t.settings.errors[result.error] ?? t.common.unknownError));
      if (result.ok) onOk?.();
    });
  const label = (p: GroupPerson) => p.name || p.email;

  return (
    <section>
      <h2 className="text-lg font-semibold">{g.heading}</h2>
      <p className="mt-1 text-sm text-muted">{g.intro}</p>
      <form
        className="mt-4 flex flex-wrap items-end gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          run(() => createGroup(workspaceId, name), () => setName(""));
        }}
      >
        <label className="flex min-w-0 flex-1 flex-col gap-1 text-sm">
          {g.newName}
          <input value={name} onChange={(e) => setName(e.target.value)} required maxLength={60} placeholder={g.placeholder} className={inputClass} />
        </label>
        <button type="submit" disabled={pending || !name.trim()} className={primaryClass}>
          {g.create}
        </button>
      </form>
      {error && (
        <p role="alert" className="mt-3 text-sm text-danger">
          {error}
        </p>
      )}
      {groups.length === 0 ? (
        <p className="mt-4 text-sm text-muted">{g.none}</p>
      ) : (
        <ul className="mt-4 space-y-3">
          {groups.map((group) => {
            const inGroup = people.filter((p) => group.memberIds.includes(p.userId));
            const others = people.filter((p) => !group.memberIds.includes(p.userId));
            return (
              <li key={group.id} className="rounded-lg border border-border p-3" data-group={group.name}>
                <div className="flex flex-wrap items-center gap-2">
                  <p className="min-w-0 flex-1 font-medium">
                    👥 {group.name} <span className="text-sm font-normal text-muted">· {g.count(inGroup.length)}</span>
                  </p>
                  <button
                    type="button"
                    disabled={pending}
                    className={buttonClass}
                    onClick={() => {
                      const next = prompt(g.renamePrompt, group.name);
                      if (next && next.trim() !== group.name) run(() => renameGroup(workspaceId, group.id, next));
                    }}
                  >
                    {g.rename}
                  </button>
                  <button
                    type="button"
                    disabled={pending}
                    className={`${buttonClass} text-danger`}
                    onClick={() => {
                      if (confirm(g.deleteConfirm(group.name))) run(() => deleteGroup(workspaceId, group.id));
                    }}
                  >
                    {g.delete}
                  </button>
                </div>
                <ul className="mt-2 space-y-1 text-sm">
                  {inGroup.map((p) => (
                    <li key={p.userId} className="flex min-h-11 items-center gap-2">
                      <span className="min-w-0 flex-1 truncate" title={p.email}>
                        {label(p)}
                      </span>
                      <button
                        type="button"
                        disabled={pending}
                        className={buttonClass}
                        aria-label={g.removeFrom(label(p), group.name)}
                        onClick={() => run(() => setGroupMember(workspaceId, group.id, p.userId, false))}
                      >
                        {g.remove}
                      </button>
                    </li>
                  ))}
                </ul>
                {others.length > 0 && (
                  <select
                    value=""
                    disabled={pending}
                    aria-label={g.addTo(group.name)}
                    onChange={(event) => {
                      const userId = event.target.value;
                      if (userId) run(() => setGroupMember(workspaceId, group.id, userId, true));
                    }}
                    className={`${inputClass} mt-2 w-full`}
                  >
                    <option value="">{g.addPerson}</option>
                    {others.map((p) => (
                      <option key={p.userId} value={p.userId}>
                        {p.name ? `${p.name} (${p.email})` : p.email}
                      </option>
                    ))}
                  </select>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
