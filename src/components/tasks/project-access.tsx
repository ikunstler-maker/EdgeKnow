"use client";

import { useEffect, useState, useTransition } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { t } from "@/i18n";
import type { ActionResult } from "@/lib/action-result";
import { personLabel, type Person } from "@/lib/tasks";
import { setTaskProjectGroupRole, setTaskProjectMemberRole, updateTaskProject } from "@/app/task-actions";

export type ProjectAccess = {
  workspaceRole: string | null;
  people: { user_id: string; role: string }[];
  groupGrants: { group_id: string; role: string }[];
  groups: { id: string; name: string }[];
};

const a = t.tasks.access;
const ROLES = ["owner", "editor", "commenter", "viewer"] as const;
const WORKSPACE_ROLES = ["editor", "commenter", "viewer"] as const;
const selectClass = "min-h-11 rounded-md border border-border bg-background px-2 text-base md:min-h-9 md:text-sm";
const buttonClass = "min-h-11 rounded-md border border-border px-3 text-sm hover:bg-surface disabled:opacity-60 md:min-h-9";

// Who may do what in a project: the whole workspace, people and groups — like sharing a page.
export function ProjectAccessButton({
  project,
  access,
  members,
}: {
  project: { id: string; name: string };
  access: ProjectAccess;
  members: Person[];
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className={buttonClass}>
        ⚙️ {t.tasks.settings}
      </button>
      {open && <AccessDialog project={project} access={access} members={members} onClose={() => setOpen(false)} />}
    </>
  );
}

function AccessDialog({ project, access, members, onClose }: { project: { id: string; name: string }; access: ProjectAccess; members: Person[]; onClose: () => void }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [person, setPerson] = useState("");
  const [personRole, setPersonRole] = useState("editor");
  const [group, setGroup] = useState("");
  const [groupRole, setGroupRole] = useState("viewer");
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);
  const run = (action: () => Promise<ActionResult>) =>
    startTransition(async () => {
      const result = await action();
      setError(result.ok ? null : (t.tasks.errors[result.error] ?? t.common.unknownError));
      router.refresh();
    });
  const personOf = new Map(members.map((m) => [m.id, m]));
  const groupName = new Map(access.groups.map((g) => [g.id, g.name]));
  const listedPeople = new Set(access.people.map((p) => p.user_id));
  const listedGroups = new Set(access.groupGrants.map((g) => g.group_id));

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center" onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-label={a.title} onClick={(e) => e.stopPropagation()} className="flex max-h-[85vh] w-full max-w-lg flex-col rounded-t-xl bg-background shadow-xl sm:rounded-xl">
        <div className="flex items-center border-b border-border px-4 py-3">
          <h2 className="flex-1 font-semibold">
            {a.title}: {project.name}
          </h2>
          <button type="button" onClick={onClose} aria-label={t.common.close} className="min-h-11 min-w-11">
            ✕
          </button>
        </div>
        <div className="flex-1 space-y-5 overflow-y-auto p-4 text-sm">
          {error && (
            <p role="alert" className="rounded-lg border border-danger/40 bg-danger/10 px-3 py-2">
              {error}
            </p>
          )}
          <p className="text-muted">{a.admins}</p>
          <label className="flex flex-wrap items-center gap-2">
            <span className="flex-1">{a.workspace}</span>
            <select
              value={access.workspaceRole ?? ""}
              disabled={pending}
              onChange={(e) => run(() => updateTaskProject(project.id, { workspace_role: e.target.value || null }))}
              className={selectClass}
            >
              <option value="">{a.noAccess}</option>
              {WORKSPACE_ROLES.map((r) => (
                <option key={r} value={r}>
                  {t.tasks.roles[r]}
                </option>
              ))}
            </select>
          </label>

          <section className="space-y-2 border-t border-border pt-4">
            <p className="font-medium">{a.people}</p>
            <div className="flex flex-wrap gap-2">
              <select value={person} onChange={(e) => setPerson(e.target.value)} aria-label={a.people} className={`${selectClass} min-w-0 flex-1`}>
                <option value="">{a.choosePerson}</option>
                {members
                  .filter((m) => !listedPeople.has(m.id))
                  .map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name ? `${m.name} (${m.email})` : m.email}
                      {m.guest ? ` · ${t.workspace.roles.guest}` : ""}
                    </option>
                  ))}
              </select>
              <select value={personRole} onChange={(e) => setPersonRole(e.target.value)} aria-label={t.tasks.roles.editor} className={selectClass}>
                {ROLES.map((r) => (
                  <option key={r} value={r}>
                    {t.tasks.roles[r]}
                  </option>
                ))}
              </select>
              <button
                type="button"
                disabled={!person || pending}
                className={buttonClass}
                onClick={() => {
                  const id = person;
                  setPerson("");
                  run(() => setTaskProjectMemberRole(project.id, id, personRole));
                }}
              >
                {a.add}
              </button>
            </div>
            <ul className="space-y-1">
              {access.people.map((p) => (
                <li key={p.user_id} className="flex min-h-11 items-center gap-2">
                  <span className="min-w-0 flex-1 truncate">{personLabel(personOf.get(p.user_id)) || p.user_id}</span>
                  <select
                    value={p.role}
                    disabled={pending}
                    aria-label={personLabel(personOf.get(p.user_id))}
                    onChange={(e) => run(() => setTaskProjectMemberRole(project.id, p.user_id, e.target.value || null))}
                    className={selectClass}
                  >
                    {/* A guest is never an owner. */}
                    {ROLES.filter((r) => !(r === "owner" && personOf.get(p.user_id)?.guest)).map((r) => (
                      <option key={r} value={r}>
                        {t.tasks.roles[r]}
                      </option>
                    ))}
                    <option value="">{a.remove}</option>
                  </select>
                </li>
              ))}
            </ul>
          </section>

          {access.groups.length > 0 && (
            <section className="space-y-2 border-t border-border pt-4">
              <p className="font-medium">{a.groups}</p>
              <div className="flex flex-wrap gap-2">
                <select value={group} onChange={(e) => setGroup(e.target.value)} aria-label={a.groups} className={`${selectClass} min-w-0 flex-1`}>
                  <option value="">{a.chooseGroup}</option>
                  {access.groups
                    .filter((g) => !listedGroups.has(g.id))
                    .map((g) => (
                      <option key={g.id} value={g.id}>
                        👥 {g.name}
                      </option>
                    ))}
                </select>
                <select value={groupRole} onChange={(e) => setGroupRole(e.target.value)} aria-label={t.tasks.roles.viewer} className={selectClass}>
                  {ROLES.map((r) => (
                    <option key={r} value={r}>
                      {t.tasks.roles[r]}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  disabled={!group || pending}
                  className={buttonClass}
                  onClick={() => {
                    const id = group;
                    setGroup("");
                    run(() => setTaskProjectGroupRole(project.id, id, groupRole));
                  }}
                >
                  {a.add}
                </button>
              </div>
              <ul className="space-y-1">
                {access.groupGrants.map((g) => (
                  <li key={g.group_id} className="flex min-h-11 items-center gap-2">
                    <span className="min-w-0 flex-1 truncate">👥 {groupName.get(g.group_id)}</span>
                    <select
                      value={g.role}
                      disabled={pending}
                      aria-label={groupName.get(g.group_id)}
                      onChange={(e) => run(() => setTaskProjectGroupRole(project.id, g.group_id, e.target.value || null))}
                      className={selectClass}
                    >
                      {ROLES.map((r) => (
                        <option key={r} value={r}>
                          {t.tasks.roles[r]}
                        </option>
                      ))}
                      <option value="">{a.remove}</option>
                    </select>
                  </li>
                ))}
              </ul>
            </section>
          )}

          <div className="border-t border-border pt-4">
            <button
              type="button"
              disabled={pending}
              className={`${buttonClass} text-danger`}
              onClick={() => {
                if (confirm(t.tasks.archiveConfirm(project.name))) run(() => updateTaskProject(project.id, { archived: true }));
              }}
            >
              {t.tasks.archive}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
