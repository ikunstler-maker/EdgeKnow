"use client";

import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { t } from "@/i18n";
import { RULE_EVENTS, RULE_ROLES, type RuleEvent, type RuleRole, type TaskRule } from "@/lib/notifications";
import { personLabel, type Person, type StatusCategory, type TaskBoardInfo, type TaskStatus } from "@/lib/tasks";
import { deleteTaskRule, loadTaskRules, saveTaskRule } from "@/app/notification-actions";
import { usePages } from "@/components/pages/pages-provider";
import { Icon } from "@/components/ui/icon";

const r = t.notifications.rules;
const k = t.tasks;
const CATEGORIES: StatusCategory[] = ["todo", "doing", "review", "done"];
const inputClass = "min-h-11 rounded-lg border border-border bg-background px-2 text-base hover:border-border-strong md:h-9 md:min-h-0 md:text-sm";

// The project owner's rules: "when this happens to a task, tell these people".
export function TaskRulesDialog({
  projectId,
  statuses,
  boards = [],
  members,
  onClose,
}: {
  projectId: string;
  statuses: TaskStatus[];
  boards?: TaskBoardInfo[];
  members: Person[];
  onClose: () => void;
}) {
  const { workspace } = usePages();
  const [rules, setRules] = useState<TaskRule[] | null>(null);
  const [groups, setGroups] = useState<{ id: string; name: string }[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [event, setEvent] = useState<RuleEvent>("enter_category");
  const [category, setCategory] = useState<StatusCategory>("review");
  const [statusId, setStatusId] = useState(statuses[0]?.id ?? "");
  const [roles, setRoles] = useState<RuleRole[]>([]);
  const [users, setUsers] = useState<string[]>([]);
  const [groupIds, setGroupIds] = useState<string[]>([]);
  const [moveTo, setMoveTo] = useState("");

  const reload = useCallback(async () => {
    const data = await loadTaskRules(workspace.shortId, projectId, workspace.id);
    setRules(data.rules);
    setGroups(data.groups);
  }, [projectId, workspace.id, workspace.shortId]);
  useEffect(() => {
    // Loads once the dialog opens (an async read, not a cascade of renders).
    // eslint-disable-next-line react-hooks/set-state-in-effect
    reload();
  }, [reload]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  // Columns grouped by board, so a rule can hand a task to another team's board.
  const boardName = (id: string | null | undefined) => boards.find((x) => x.id === id)?.name ?? t.tasks.boards.main;
  const statusOptions = [null, ...boards.map((x) => x.id)].map((board) => {
    const columns = statuses.filter((s) => (s.board_id ?? null) === board);
    return columns.length ? (
      <optgroup key={board ?? "main"} label={boardName(board)}>
        {columns.map((s) => (
          <option key={s.id} value={s.id}>
            {s.name}
          </option>
        ))}
      </optgroup>
    ) : null;
  });
  const toggle = <T,>(list: T[], value: T, on: boolean) => (on ? [...list, value] : list.filter((v) => v !== value));
  const nameOf = (id: string) => {
    const m = members.find((p) => p.id === id);
    return m ? personLabel(m) : "—";
  };
  const describe = (rule: TaskRule) => {
    const when =
      rule.event === "enter_category"
        ? `${r.events.enter_category} «${(k.categories as Record<string, string>)[rule.category ?? ""] ?? rule.category}»`
        : rule.event === "enter_status"
          ? `${r.events.enter_status} «${statuses.find((s) => s.id === rule.status_id)?.name ?? "—"}»`
          : r.events[rule.event];
    const who = [
      ...rule.notify_roles.map((role) => r.roles[role]),
      ...rule.notify_users.map(nameOf),
      ...rule.notify_groups.map((g) => groups.find((x) => x.id === g)?.name ?? "—"),
    ].join(", ");
    const moved = rule.move_to_status ? statuses.find((s) => s.id === rule.move_to_status) : null;
    return { when, who: [who, moved ? `${t.tasks.boards.moveTo}: ${boardName(moved.board_id)} / ${moved.name}` : ""].filter(Boolean).join(" · ") };
  };

  const add = async () => {
    if (!roles.length && !users.length && !groupIds.length && !moveTo) return setError(r.needSomeone);
    const result = await saveTaskRule(workspace.shortId, projectId, {
      event,
      ...(event === "enter_category" ? { category } : {}),
      ...(event === "enter_status" ? { status_id: statusId } : {}),
      roles,
      users,
      groups: groupIds,
      ...(moveTo ? { move_to_status: moveTo } : {}),
    });
    if (!result.ok) return setError(k.errors[result.error] ?? t.common.unknownError);
    setError(null);
    setRoles([]);
    setUsers([]);
    setGroupIds([]);
    setMoveTo("");
    reload();
  };
  const remove = async (id: string) => {
    const result = await deleteTaskRule(workspace.shortId, id);
    if (!result.ok) return setError(k.errors[result.error] ?? t.common.unknownError);
    reload();
  };

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center" onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-label={r.title} onClick={(e) => e.stopPropagation()} className="flex max-h-[85vh] w-full max-w-lg flex-col rounded-t-xl bg-background shadow-xl sm:rounded-xl" data-task-rules>
        <div className="flex items-center border-b border-border px-4 py-3">
          <h2 className="flex-1 font-semibold"><Icon name="bell" className="mr-1.5 inline" />{r.title}</h2>
          <button type="button" onClick={onClose} aria-label={t.common.close} className="min-h-11 min-w-11">
            <Icon name="close" />
          </button>
        </div>
        <div className="flex-1 space-y-4 overflow-y-auto p-4 text-sm">
          <p className="text-muted">{r.intro}</p>
          {error && (
            <p role="alert" className="rounded-lg border border-danger/40 bg-danger/10 px-3 py-2">
              {error}
            </p>
          )}
          {rules && !rules.length && <p className="text-muted">{r.empty}</p>}
          <ul className="space-y-2">
            {rules?.map((rule) => {
              const { when, who } = describe(rule);
              return (
                <li key={rule.id} className="flex items-start gap-2 rounded-lg border border-border p-2" data-task-rule>
                  <span className="flex-1">
                    <b>{r.when}</b> {when} → <b>{r.notify}</b>: {who}
                  </span>
                  <button type="button" onClick={() => remove(rule.id)} aria-label={r.remove} title={r.remove} className="min-h-9 min-w-9 text-danger">
                    <Icon name="trash" />
                  </button>
                </li>
              );
            })}
          </ul>

          <fieldset className="space-y-2 rounded-lg border border-border p-3">
            <legend className="px-1 font-medium">{r.add}</legend>
            <label className="flex flex-col gap-1">
              {r.when}
              <select value={event} onChange={(e) => setEvent(e.target.value as RuleEvent)} className={inputClass} data-rule-event>
                {RULE_EVENTS.map((ev) => (
                  <option key={ev} value={ev}>
                    {r.events[ev]}
                  </option>
                ))}
              </select>
            </label>
            {event === "enter_category" && (
              <select value={category} onChange={(e) => setCategory(e.target.value as StatusCategory)} aria-label={r.events.enter_category} className={inputClass} data-rule-category>
                {CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {k.categories[c]}
                  </option>
                ))}
              </select>
            )}
            {event === "enter_status" && (
              <select value={statusId} onChange={(e) => setStatusId(e.target.value)} aria-label={r.events.enter_status} className={inputClass}>
                {statuses.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            )}
            <p className="pt-1">{r.notify}</p>
            <div className="flex flex-wrap gap-x-4">
              {RULE_ROLES.map((role) => (
                <label key={role} className="flex min-h-9 items-center gap-2">
                  <input type="checkbox" checked={roles.includes(role)} onChange={(e) => setRoles(toggle(roles, role, e.target.checked))} data-rule-role={role} />
                  {r.roles[role]}
                </label>
              ))}
            </div>
            {groups.length > 0 && (
              <details>
                <summary className="min-h-9 cursor-pointer py-2">
                  {r.groups} {groupIds.length ? `(${groupIds.length})` : ""}
                </summary>
                {groups.map((g) => (
                  <label key={g.id} className="flex min-h-9 items-center gap-2">
                    <input type="checkbox" checked={groupIds.includes(g.id)} onChange={(e) => setGroupIds(toggle(groupIds, g.id, e.target.checked))} data-rule-group={g.name} />
                    {g.name}
                  </label>
                ))}
              </details>
            )}
            <details>
              <summary className="min-h-9 cursor-pointer py-2">
                {r.people} {users.length ? `(${users.length})` : ""}
              </summary>
              {members.map((m) => (
                <label key={m.id} className="flex min-h-9 items-center gap-2">
                  <input type="checkbox" checked={users.includes(m.id)} onChange={(e) => setUsers(toggle(users, m.id, e.target.checked))} />
                  {personLabel(m)}
                </label>
              ))}
            </details>
            {(event === "enter_category" || event === "enter_status") && (
              <label className="flex flex-col gap-1 pt-1">
                {t.tasks.boards.moveTo}
                <select value={moveTo} onChange={(e) => setMoveTo(e.target.value)} className={inputClass} data-rule-move>
                  <option value="">{t.tasks.boards.noMove}</option>
                  {statusOptions}
                </select>
              </label>
            )}
            <button type="button" onClick={add} className="min-h-11 rounded-lg bg-accent px-4 font-medium text-white md:min-h-9" data-rule-add>
              {r.add}
            </button>
          </fieldset>
        </div>
      </div>
    </div>,
    document.body,
  );
}
