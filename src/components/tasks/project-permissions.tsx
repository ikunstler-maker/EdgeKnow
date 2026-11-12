"use client";

import { useEffect, useState, useTransition } from "react";
import { t } from "@/i18n";
import { personLabel, type Person } from "@/lib/tasks";
import { loadTaskPermissions, setTaskPermission, type PermissionRow } from "@/app/task-actions";

const p = t.tasks.permissions;
// In groups, as the screen shows them.
const GROUPS = [
  { name: "tasks", actions: ["create", "edit", "delete", "assign", "be_assigned", "schedule", "transition", "link"] },
  { name: "comments", actions: ["comment_add", "comment_edit_own", "comment_edit_any", "comment_delete_own", "comment_delete_any"] },
  { name: "files", actions: ["file_add", "file_delete_own", "file_delete_any"] },
  { name: "time", actions: ["time_log", "time_edit_own", "time_edit_any"] },
] as const;
const ALL_ROLES = ["editor", "commenter", "viewer"];
const ROLES = ["editor", "commenter", "viewer"] as const;
// The task's author and assignee mean something only for an action on a task that exists.
const ON_A_TASK = (action: string) => action !== "create" && action !== "be_assigned";
// With no row of its own an action follows the usual rule.
const USUAL_ROLES: Record<string, string[]> = {
  be_assigned: ALL_ROLES,
  comment_edit_own: ALL_ROLES,
  comment_delete_own: ALL_ROLES,
  file_delete_own: ALL_ROLES,
  time_edit_own: ALL_ROLES,
  comment_add: ["editor", "commenter"],
  comment_edit_any: [],
  comment_delete_any: [],
  time_edit_any: [],
};
const usual = (action: string): Omit<PermissionRow, "action"> => ({ roles: USUAL_ROLES[action] ?? ["editor"], groups: [], members: [], reporter: false, assignee: false });

// Who may do what with the project's tasks, action by action: roles, units, named people,
// the task's author, its assignee. The project's owners always may. Set by an owner.
export function ProjectPermissions({ projectId, members, groups }: { projectId: string; members: Person[]; groups: { id: string; name: string }[] }) {
  const [rows, setRows] = useState<PermissionRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  useEffect(() => {
    let live = true;
    void loadTaskPermissions(projectId).then((list) => live && setRows(list));
    return () => {
      live = false;
    };
  }, [projectId]);
  if (!rows) return null;
  const save = (action: string, holders: Omit<PermissionRow, "action"> | null) => {
    // Shown at once; put back if the server refuses.
    const before = rows;
    setRows(holders ? [...rows.filter((r) => r.action !== action), { action, ...holders }] : rows.filter((r) => r.action !== action));
    startTransition(async () => {
      const result = await setTaskPermission(projectId, action, holders);
      setError(result.ok ? null : (t.tasks.errors[result.error] ?? t.common.unknownError));
      if (!result.ok) setRows(before);
    });
  };
  const toggle = (list: string[], value: string) => (list.includes(value) ? list.filter((x) => x !== value) : [...list, value]);
  return (
    <details className="border-t border-border pt-4" data-project-permissions>
      <summary className="min-h-11 cursor-pointer text-sm font-medium md:min-h-8">{p.title}</summary>
      <p className="mt-1 text-xs text-muted">{p.hint}</p>
      {GROUPS.map((group) => (
        <div key={group.name} data-permission-group-of={group.name}>
          <h4 className="mt-3 text-xs font-medium uppercase tracking-wide text-muted">{p.groups[group.name]}</h4>
      <ul className="mt-2 space-y-3">
        {group.actions.map((action) => {
          const own = rows.find((r) => r.action === action);
          const now = own ?? { action, ...usual(action) };
          const set = (changes: Partial<Omit<PermissionRow, "action">>) => save(action, { roles: now.roles, groups: now.groups, members: now.members, reporter: now.reporter, assignee: now.assignee, ...changes });
          const extra = [...now.groups.map((id) => groups.find((g) => g.id === id)?.name ?? "—"), ...now.members.map((id) => personLabel(members.find((m) => m.id === id)) || "—")];
          return (
            <li key={action} className="rounded-lg border border-border p-2 text-sm" data-permission={action}>
              <div className="flex flex-wrap items-center gap-2">
                <span className="min-w-0 flex-1 font-medium">{p.actions[action]}</span>
                {own ? (
                  <button type="button" disabled={pending} onClick={() => save(action, null)} className="min-h-11 text-xs text-muted hover:text-foreground hover:underline md:min-h-6" data-permission-reset>
                    {p.reset}
                  </button>
                ) : (
                  <span className="text-xs text-muted">{p.usual}</span>
                )}
              </div>
              <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1">
                {ROLES.map((role) => (
                  <label key={role} className="flex min-h-11 items-center gap-1.5 md:min-h-7">
                    <input type="checkbox" checked={now.roles.includes(role)} disabled={pending} onChange={() => set({ roles: toggle(now.roles, role) })} data-permission-role={role} />
                    {t.tasks.roles[role]}
                  </label>
                ))}
                {ON_A_TASK(action) && (
                  <>
                    <label className="flex min-h-11 items-center gap-1.5 md:min-h-7">
                      <input type="checkbox" checked={now.reporter} disabled={pending} onChange={() => set({ reporter: !now.reporter })} data-permission-reporter />
                      {p.reporter}
                    </label>
                    <label className="flex min-h-11 items-center gap-1.5 md:min-h-7">
                      <input type="checkbox" checked={now.assignee} disabled={pending} onChange={() => set({ assignee: !now.assignee })} data-permission-assignee />
                      {p.assignee}
                    </label>
                  </>
                )}
              </div>
              <details className="mt-1 text-xs">
                <summary className="min-h-11 cursor-pointer text-muted md:min-h-6">{extra.length ? p.also(extra.join(", ")) : p.addPeople}</summary>
                <div className="mt-1 grid max-h-44 gap-x-4 overflow-y-auto sm:grid-cols-2">
                  {groups.map((g) => (
                    <label key={g.id} className="flex min-h-11 items-center gap-1.5 md:min-h-6">
                      <input type="checkbox" checked={now.groups.includes(g.id)} disabled={pending} onChange={() => set({ groups: toggle(now.groups, g.id) })} data-permission-group={g.name} />
                      {g.name}
                    </label>
                  ))}
                  {members
                    .filter((m) => !m.guest)
                    .map((m) => (
                      <label key={m.id} className="flex min-h-11 items-center gap-1.5 md:min-h-6">
                        <input type="checkbox" checked={now.members.includes(m.id)} disabled={pending} onChange={() => set({ members: toggle(now.members, m.id) })} data-permission-member={m.email} />
                        {personLabel(m)}
                      </label>
                    ))}
                </div>
              </details>
            </li>
          );
        })}
      </ul>
        </div>
      ))}
      <p className="mt-2 text-xs text-muted">{p.owners}</p>
      {error && (
        <p role="alert" className="mt-1 text-sm text-danger">
          {error}
        </p>
      )}
    </details>
  );
}
