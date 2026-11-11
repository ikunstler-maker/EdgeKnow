"use client";

import { useState, useTransition } from "react";
import { DndContext, KeyboardSensor, PointerSensor, TouchSensor, useDraggable, useDroppable, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { t } from "@/i18n";
import type { ActionResult } from "@/lib/action-result";
import { createGroup, deleteGroup, moveGroup, renameGroup, setGroupLead, setGroupMember } from "@/app/workspace-actions";
import { Icon } from "@/components/ui/icon";

export type GroupItem = { id: string; name: string; memberIds: string[]; leadIds?: string[]; parentId: string | null; position: number };
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
  const [parent, setParent] = useState("");
  // Units in tree order with their depth (sub-units under their parent, by position, then name).
  const known = new Set(groups.map((x) => x.id));
  const childrenOf = (id: string | null) =>
    groups
      .filter((x) => (id === null ? !x.parentId || !known.has(x.parentId) : x.parentId === id))
      .sort((a, b) => a.position - b.position || a.name.localeCompare(b.name));
  const ordered: { group: GroupItem; depth: number }[] = [];
  const walk = (id: string | null, depth: number) => {
    for (const child of childrenOf(id)) {
      ordered.push({ group: child, depth });
      if (depth < 10) walk(child.id, depth + 1);
    }
  };
  walk(null, 0);
  const below = (id: string): Set<string> => {
    const out = new Set<string>([id]);
    for (let grew = true; grew; ) {
      grew = false;
      for (const x of groups)
        if (x.parentId && out.has(x.parentId) && !out.has(x.id)) {
          out.add(x.id);
          grew = true;
        }
    }
    return out;
  };
  const move = (id: string, to: string | null) => {
    if (to && below(id).has(to)) return setError(t.settings.errors.group_cycle);
    run(() => moveGroup(workspaceId, id, to, null));
  };
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }), useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 6 } }), useSensor(KeyboardSensor));
  const onDragEnd = (event: DragEndEvent) => {
    const id = String(event.active.id);
    const over = event.over ? String(event.over.id) : null;
    if (!over) return;
    const to = over === "top" ? null : over;
    if (to === id || (groups.find((x) => x.id === id)?.parentId ?? null) === to) return;
    move(id, to);
  };
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
          run(() => createGroup(workspaceId, name, parent || null), () => setName(""));
        }}
      >
        <label className="flex min-w-0 flex-1 flex-col gap-1 text-sm">
          {g.newName}
          <input value={name} onChange={(e) => setName(e.target.value)} required maxLength={60} placeholder={g.placeholder} className={inputClass} />
        </label>
        <label className="flex min-w-0 flex-col gap-1 text-sm sm:w-56">
          {g.inside}
          <select value={parent} onChange={(e) => setParent(e.target.value)} className={inputClass}>
            <option value="">{g.topLevel}</option>
            {ordered.map(({ group, depth }) => (
              <option key={group.id} value={group.id}>
                {"— ".repeat(depth)}
                {group.name}
              </option>
            ))}
          </select>
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
        <DndContext sensors={sensors} onDragEnd={onDragEnd}>
        <TopDrop />
        <ul className="mt-2 space-y-3" data-group-tree>
          {ordered.map(({ group, depth }) => {
            const inGroup = people.filter((p) => group.memberIds.includes(p.userId));
            const others = people.filter((p) => !group.memberIds.includes(p.userId));
            return (
              <UnitCard key={group.id} group={group} depth={depth} disabled={pending}>
                <div className="flex flex-wrap items-center gap-2">
                  <p className="min-w-0 flex-1 font-medium">
                    <Icon name={depth === 0 ? "home" : "users"} className="mr-1.5 inline text-muted" />
              {group.name} <span className="text-sm font-normal text-muted">· {g.count(inGroup.length)}</span>
                  </p>
                  <button
                    type="button"
                    disabled={pending}
                    className={buttonClass}
                    onClick={() => {
                      const next = prompt(g.subPrompt(group.name))?.trim();
                      if (next) run(() => createGroup(workspaceId, next, group.id));
                    }}
                    data-group-add-sub
                  >
                    <Icon name="plus" className="mr-1 inline" />
                    {g.addSub}
                  </button>
                  <select
                    value=""
                    disabled={pending}
                    aria-label={g.moveTo(group.name)}
                    onChange={(e) => e.target.value && move(group.id, e.target.value === "top" ? null : e.target.value)}
                    className={`${inputClass} max-w-48`}
                  >
                    <option value="">{g.moveLabel}</option>
                    {group.parentId && <option value="top">{g.topLevel}</option>}
                    {ordered
                      .filter((x) => !below(group.id).has(x.group.id) && x.group.id !== group.parentId)
                      .map((x) => (
                        <option key={x.group.id} value={x.group.id}>
                          {"— ".repeat(x.depth)}
                          {x.group.name}
                        </option>
                      ))}
                  </select>
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
                        {group.leadIds?.includes(p.userId) && <span className="ml-1 rounded bg-accent/15 px-1 text-xs text-accent" data-group-lead>{g.lead}</span>}
                      </span>
                      <button
                        type="button"
                        disabled={pending}
                        className={buttonClass}
                        aria-pressed={!!group.leadIds?.includes(p.userId)}
                        title={g.leadHint}
                        onClick={() => run(() => setGroupLead(workspaceId, group.id, p.userId, !group.leadIds?.includes(p.userId)))}
                        data-group-lead-toggle
                      >
                        {group.leadIds?.includes(p.userId) ? g.unsetLead : g.setLead}
                      </button>
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
              </UnitCard>
            );
          })}
        </ul>
        </DndContext>
      )}
    </section>
  );
}

// Dropping a unit here puts it at the top level.
function TopDrop() {
  const { setNodeRef, isOver } = useDroppable({ id: "top" });
  return (
    <div ref={setNodeRef} className={`mt-4 rounded-lg border border-dashed px-3 py-2 text-xs text-muted ${isOver ? "border-accent bg-accent/10" : "border-border"}`}>
      {g.dropTop}
    </div>
  );
}

// A unit: dragged by its handle onto another unit to go inside it.
function UnitCard({ group, depth, disabled, children }: { group: GroupItem; depth: number; disabled: boolean; children: React.ReactNode }) {
  const { setNodeRef: setDropRef, isOver } = useDroppable({ id: group.id });
  const { setNodeRef, transform, isDragging, listeners, attributes } = useDraggable({ id: group.id, disabled });
  const style = { marginLeft: `${Math.min(depth, 7) * 1.25}rem`, ...(transform ? { transform: `translate3d(${transform.x}px, ${transform.y}px, 0)` } : {}) };
  return (
    <li
      ref={(node) => {
        setDropRef(node);
        setNodeRef(node);
      }}
      style={style}
      className={`flex gap-2 rounded-lg border p-3 ${isDragging ? "relative z-20 border-accent bg-background shadow-lg" : isOver ? "border-accent bg-accent/5" : "border-border"}`}
      data-group={group.name}
      data-group-depth={depth}
    >
      <button type="button" {...listeners} {...attributes} disabled={disabled} aria-label={g.dragUnit(group.name)} className="h-11 w-7 shrink-0 cursor-grab touch-none rounded text-muted hover:bg-surface">
        <Icon name="drag" />
      </button>
      <div className="min-w-0 flex-1">{children}</div>
    </li>
  );
}
