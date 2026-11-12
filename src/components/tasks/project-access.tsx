"use client";

import { useEffect, useState, useTransition } from "react";
import { createPortal } from "react-dom";
import { usePathname, useRouter } from "next/navigation";
import { t } from "@/i18n";
import type { ActionResult } from "@/lib/action-result";
import { personLabel, type Person } from "@/lib/tasks";
import { projectTimeReport, setProjectTimeTracking, setTaskProjectGroupRole, setTaskProjectMemberRole, updateTaskProject, type TimeReportRow } from "@/app/task-actions";
import { setTaskProjectKey } from "@/app/task-import-actions";
import { Icon } from "@/components/ui/icon";
import { ImportPeople } from "./import-people";

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
const buttonClass = "inline-flex min-h-11 items-center justify-center gap-1.5 rounded-lg border border-border bg-hover px-3 text-[13px] font-medium hover:border-border-strong disabled:opacity-50 md:h-8 md:min-h-0";

// Who may do what in a project: the whole workspace, people and groups — like sharing a page.
export function ProjectAccessButton({
  project,
  access,
  members,
}: {
  project: { id: string; name: string; key: string; time_tracking?: boolean; time_visibility?: string };
  access: ProjectAccess;
  members: Person[];
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className={buttonClass}>
        <Icon name="settings" className="mr-1 inline" />
        {t.tasks.settings}
      </button>
      {open && <AccessDialog project={project} access={access} members={members} onClose={() => setOpen(false)} />}
    </>
  );
}

function AccessDialog({ project, access, members, onClose }: { project: { id: string; name: string; key: string; time_tracking?: boolean; time_visibility?: string }; access: ProjectAccess; members: Person[]; onClose: () => void }) {
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
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 backdrop-blur-md sm:items-center" onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-label={a.title} onClick={(e) => e.stopPropagation()} className="flex max-h-[85vh] w-full max-w-lg flex-col rounded-t-xl bg-background shadow-xl sm:rounded-xl">
        <div className="flex items-center border-b border-border px-4 py-3">
          <h2 className="flex-1 font-semibold">
            {a.title}: {project.name}
          </h2>
          <button type="button" onClick={onClose} aria-label={t.common.close} className="min-h-11 min-w-11">
            <Icon name="close" />
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
                        {g.name}
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
                    <span className="min-w-0 flex-1 truncate"><Icon name="users" className="mr-1.5 inline" />{groupName.get(g.group_id)}</span>
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

          <TimeSettings project={project} members={members} run={run} pending={pending} />
          <ImportPeople projectId={project.id} members={members} />
          <ProjectKeyForm project={project} />

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

// Time tracking: off or on, who sees the entries, and the time by person for the last 30 days.
function TimeSettings({ project, members, run, pending }: { project: { id: string; time_tracking?: boolean; time_visibility?: string }; members: Person[]; run: (action: () => Promise<ActionResult>) => void; pending: boolean }) {
  const w = t.tasks.time;
  // Shown at once; the project's own values follow when the server has answered.
  const [chosen, setChosen] = useState<{ from: typeof project; on: boolean; visibility: string } | null>(null);
  const on = chosen && chosen.from === project ? chosen.on : project.time_tracking === true;
  const visibility = chosen && chosen.from === project ? chosen.visibility : (project.time_visibility ?? "assignee");
  const set = (nextOn: boolean, nextVisibility: string) => {
    setChosen({ from: project, on: nextOn, visibility: nextVisibility });
    run(() => setProjectTimeTracking(project.id, nextOn, nextVisibility));
  };
  const [report, setReport] = useState<TimeReportRow[] | null>(null);
  useEffect(() => {
    if (!on) return;
    let live = true;
    const from = new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 10);
    void projectTimeReport(project.id, from, null).then((rows) => live && setReport(rows));
    return () => {
      live = false;
    };
  }, [on, project.id]);
  return (
    <section className="space-y-2 border-t border-border pt-4" data-time-settings>
      <h3 className="text-sm font-medium">{w.settings}</h3>
      <label className="flex min-h-11 items-center gap-2 text-sm md:min-h-8">
        <input type="checkbox" checked={on} disabled={pending} onChange={(e) => set(e.target.checked, visibility)} className="h-5 w-5 md:h-4 md:w-4" data-time-enable />
        {w.enable}
      </label>
      {on && (
        <>
          <label className="flex flex-col gap-1 text-sm">
            {w.visibility}
            <select value={visibility} disabled={pending} onChange={(e) => set(true, e.target.value)} className={selectClass} data-time-visibility>
              {(["owners", "assignee", "all"] as const).map((value) => (
                <option key={value} value={value}>
                  {w.visibilityOptions[value]}
                </option>
              ))}
            </select>
          </label>
          <p className="text-xs text-muted">{w.ownHint}</p>
          {report && (
            <div className="text-sm" data-time-report>
              <p className="text-xs text-muted">{w.report}</p>
              {report.length === 0 ? (
                <p className="text-xs text-muted">{w.reportNone}</p>
              ) : (
                <ul className="mt-1 space-y-0.5">
                  {report.map((row, i) => (
                    <li key={row.user_id ?? `seat-${i}`}>{w.reportRow(row.user_id ? personLabel(members.find((m) => m.id === row.user_id)) || t.tasks.someone : row.name ? t.tasks.importer.fromTracker(row.name) : t.tasks.someone, w.duration(row.minutes), row.tasks)}</li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </>
      )}
    </section>
  );
}

// The project's key (the "MKT" of MKT-12) can change: tasks keep their numbers under the new one.
function ProjectKeyForm({ project }: { project: { id: string; key: string } }) {
  const router = useRouter();
  const pathname = usePathname();
  const [key, setKey] = useState(project.key);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const c = t.tasks.keyChange;
  return (
    <form
      className="border-t border-border pt-4"
      aria-label={c.label}
      onSubmit={(e) => {
        e.preventDefault();
        const next = key.trim().toUpperCase();
        if (next === project.key || !confirm(c.confirm(project.key, next))) return;
        startTransition(async () => {
          const result = await setTaskProjectKey(project.id, next);
          if (!result.ok) return setError(t.tasks.importer.errors[result.error] ?? t.common.unknownError);
          // The address carries the key: go to the project's new one.
          router.replace(pathname.replace(`/tasks/${project.key}`, `/tasks/${result.key}`));
          router.refresh();
        });
      }}
      data-project-key-form
    >
      <label className="flex flex-col gap-1 text-sm">
        <span className="font-medium">{c.label}</span>
        <span className="flex flex-wrap gap-2">
          <input value={key} onChange={(e) => setKey(e.target.value.toUpperCase())} maxLength={10} className={`${selectClass} w-32 font-mono`} data-project-key />
          <button type="submit" disabled={pending || key.trim().toUpperCase() === project.key || !key.trim()} className={buttonClass} data-project-key-save>
            {c.change}
          </button>
        </span>
        <span className="text-xs text-muted">{c.hint}</span>
      </label>
      {error && (
        <p role="alert" className="mt-2 text-sm text-danger">
          {error}
        </p>
      )}
    </form>
  );
}
