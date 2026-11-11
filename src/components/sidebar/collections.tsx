"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { DndContext, KeyboardSensor, PointerSensor, TouchSensor, useDraggable, useDroppable, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { t } from "@/i18n";
import type { ActionResult } from "@/lib/action-result";
import type { CollectionItem, CollectionSummary, ObjectSummary } from "@/lib/tasks";
import { deleteCollection, saveCollection, setCollectionItem } from "@/app/collection-actions";
import { Icon } from "@/components/ui/icon";

export type Collections = { list: CollectionSummary[]; items: CollectionItem[] };

const c = t.sidebar.collections;
const rowClass = (here: boolean) => `flex min-h-11 min-w-0 flex-1 items-center gap-2 rounded-md px-2 text-sm hover:bg-surface md:min-h-9 ${here ? "bg-surface font-medium" : ""}`;
const iconButton = "flex h-11 w-9 shrink-0 items-center justify-center rounded text-muted hover:bg-surface md:h-8 md:w-7";

// A service's objects in the sidebar: the workspace's collections of them (one object can
// be in several; it is the same object, the same link), then all of them. Members and
// admins make, rename, reorder and delete collections and drag objects into them.
export function ServiceCollections({
  workspaceId,
  service,
  base,
  objects,
  collections,
  canManage,
  pathname,
  onNavigate,
}: {
  workspaceId: string;
  service: string;
  base: string;
  objects: ObjectSummary[];
  collections: Collections;
  canManage: boolean;
  pathname: string;
  onNavigate?: () => void;
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  // Shown at once; the server's answer replaces it on refresh.
  const [state, setState] = useState(collections);
  const [fromServer, setFromServer] = useState(collections);
  if (fromServer !== collections) {
    setFromServer(collections);
    setState(collections);
  }
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [adding, setAdding] = useState(false);
  const [menuFor, setMenuFor] = useState<string | null>(null);

  const list = state.list.filter((x) => x.service === service).sort((a, b) => a.position - b.position);
  const byId = new Map(objects.map((o) => [o.id, o]));
  const itemsOf = (id: string) => state.items.filter((i) => i.collection_id === id && byId.has(i.object_id)).sort((a, b) => a.position - b.position);

  const run = (next: Collections, action: () => Promise<ActionResult>) => {
    const before = state;
    setState(next);
    startTransition(async () => {
      const result = await action();
      if (!result.ok) {
        setState(before);
        setError(c.errors[result.error] ?? t.common.unknownError);
      } else setError(null);
      router.refresh();
    });
  };
  const put = (collectionId: string, objectId: string, inside: boolean) => {
    const has = state.items.some((i) => i.collection_id === collectionId && i.object_id === objectId);
    if (has === inside) return;
    const items = inside
      ? [...state.items, { collection_id: collectionId, object_id: objectId, position: Math.max(0, ...itemsOf(collectionId).map((i) => i.position)) + 1 }]
      : state.items.filter((i) => !(i.collection_id === collectionId && i.object_id === objectId));
    if (inside) setOpen(new Set(open).add(collectionId));
    run({ ...state, items }, () => setCollectionItem(collectionId, objectId, inside));
  };
  const create = (name: string) => {
    const id = `new-${crypto.randomUUID()}`;
    const position = Math.max(0, ...list.map((x) => x.position)) + 1;
    run({ ...state, list: [...state.list, { id, service, name, position }] }, () => saveCollection(workspaceId, null, service, name, position));
  };
  const rename = (item: CollectionSummary) => {
    const name = prompt(c.renamePrompt, item.name)?.trim();
    if (!name || name === item.name) return;
    run({ ...state, list: state.list.map((x) => (x.id === item.id ? { ...x, name } : x)) }, () => saveCollection(workspaceId, item.id, null, name, null));
  };
  const remove = (item: CollectionSummary) => {
    if (!confirm(c.deleteConfirm(item.name))) return;
    run({ list: state.list.filter((x) => x.id !== item.id), items: state.items.filter((i) => i.collection_id !== item.id) }, () => deleteCollection(item.id));
  };

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }), useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 6 } }), useSensor(KeyboardSensor));
  const onDragEnd = (event: DragEndEvent) => {
    const active = String(event.active.id);
    const target = event.over ? String(event.over.id).replace(/^drop:/, "") : null;
    if (!target) return;
    if (active.startsWith("obj:")) return put(target, active.slice(4), true);
    // A collection dropped on another takes its place (after it when moving down).
    const id = active.slice(4);
    const from = list.findIndex((x) => x.id === id);
    const to = list.findIndex((x) => x.id === target);
    if (from < 0 || to < 0 || from === to) return;
    const rest = list.filter((x) => x.id !== id);
    const at = rest.findIndex((x) => x.id === target) + (from < to ? 1 : 0);
    const prev = rest[at - 1];
    const next = rest[at];
    const position = prev && next ? (prev.position + next.position) / 2 : prev ? prev.position + 1 : next.position - 1;
    const item = list[from];
    run({ ...state, list: state.list.map((x) => (x.id === id ? { ...x, position } : x)) }, () => saveCollection(workspaceId, id, null, item.name, position));
  };

  const objectLink = (o: ObjectSummary, key: string, extra?: React.ReactNode) => {
    const href = `${base}/${o.id}`;
    const here = pathname === href || pathname.startsWith(`${href}/`);
    return (
      <li key={key} className="flex items-center">
        <Link prefetch={false} href={href} onClick={onNavigate} data-angler-here={here ? "" : undefined} className={rowClass(here)} data-sidebar-object>
          <span className="truncate">{o.title || t.pages.untitled}</span>
        </Link>
        {extra}
      </li>
    );
  };

  return (
    <DndContext sensors={sensors} onDragEnd={onDragEnd}>
      <div className="mb-1" data-collections>
        <div className="flex items-center px-3 pb-1 pt-2">
          <span className="flex-1 text-xs font-medium uppercase tracking-wide text-muted">{c.title}</span>
          {canManage && (
            <button type="button" onClick={() => setAdding(true)} aria-label={c.add} title={c.add} className={iconButton} data-collection-add>
              <Icon name="plus" />
            </button>
          )}
        </div>
        {adding && (
          <form
            className="px-2 pb-1"
            onSubmit={(e) => {
              e.preventDefault();
              const name = String(new FormData(e.currentTarget).get("name") ?? "").trim();
              setAdding(false);
              if (name) create(name);
            }}
          >
            <input name="name" autoFocus maxLength={80} aria-label={c.namePlaceholder} placeholder={c.namePlaceholder} onBlur={() => setAdding(false)} onKeyDown={(e) => e.key === "Escape" && setAdding(false)} className="min-h-11 w-full rounded-md border border-border bg-background px-2 text-base md:min-h-9 md:text-sm" />
          </form>
        )}
        {error && (
          <p role="alert" className="px-3 text-xs text-danger">
            {error}
          </p>
        )}
        {list.length === 0 && !adding && <p className="px-3 text-xs text-muted">{canManage ? c.emptyHint : c.empty}</p>}
        <ul>
          {list.map((item) => {
            const isOpen = open.has(item.id);
            const entries = itemsOf(item.id);
            return (
              <CollectionRow key={item.id} item={item} canManage={canManage && !item.id.startsWith("new-")} count={entries.length} isOpen={isOpen} onToggle={() => {
                const next = new Set(open);
                if (isOpen) next.delete(item.id);
                else next.add(item.id);
                setOpen(next);
              }} onRename={() => rename(item)} onDelete={() => remove(item)}>
                {isOpen && (
                  <ul className="ml-5 border-l border-border pl-1">
                    {entries.length === 0 && <li className="px-2 py-1 text-xs text-muted">{canManage ? c.dropHint : c.emptyCollection}</li>}
                    {entries.map((entry) =>
                      objectLink(
                        byId.get(entry.object_id)!,
                        entry.object_id,
                        canManage && (
                          <button type="button" onClick={() => put(item.id, entry.object_id, false)} aria-label={c.removeFrom(item.name)} title={c.removeFrom(item.name)} className={iconButton}>
                            <Icon name="close" size={14} />
                          </button>
                        ),
                      ),
                    )}
                  </ul>
                )}
              </CollectionRow>
            );
          })}
        </ul>
      </div>
      <ul>
        {objects.map((o) =>
          canManage && list.length > 0 ? (
            <DraggableObject key={o.id} id={o.id} title={o.title || t.pages.untitled}>
              {objectLink(
                o,
                o.id,
                <span className="relative">
                  <button type="button" onClick={() => setMenuFor(menuFor === o.id ? null : o.id)} aria-label={c.addTo(o.title || t.pages.untitled)} aria-expanded={menuFor === o.id} className={iconButton} data-collection-menu>
                    ⋯
                  </button>
                  {menuFor === o.id && (
                    <div className="absolute right-0 z-30 mt-1 w-56 rounded-lg border border-border bg-background p-2 shadow-xl" role="group" aria-label={c.inCollections}>
                      <p className="px-1 pb-1 text-xs text-muted">{c.inCollections}</p>
                      {list.filter((x) => !x.id.startsWith("new-")).map((x) => (
                        <label key={x.id} className="flex min-h-11 items-center gap-2 px-1 text-sm md:min-h-8">
                          <input type="checkbox" className="h-5 w-5" checked={state.items.some((i) => i.collection_id === x.id && i.object_id === o.id)} onChange={(e) => put(x.id, o.id, e.target.checked)} />
                          <span className="truncate">{x.name}</span>
                        </label>
                      ))}
                      <button type="button" onClick={() => setMenuFor(null)} className="mt-1 min-h-11 w-full rounded-md border border-border text-sm hover:bg-surface md:min-h-8">
                        {t.common.close}
                      </button>
                    </div>
                  )}
                </span>,
              )}
            </DraggableObject>
          ) : (
            objectLink(o, o.id)
          ),
        )}
      </ul>
    </DndContext>
  );
}

function CollectionRow({
  item,
  canManage,
  count,
  isOpen,
  onToggle,
  onRename,
  onDelete,
  children,
}: {
  item: CollectionSummary;
  canManage: boolean;
  count: number;
  isOpen: boolean;
  onToggle: () => void;
  onRename: () => void;
  onDelete: () => void;
  children: React.ReactNode;
}) {
  const drop = useDroppable({ id: `drop:${item.id}`, disabled: !canManage });
  const drag = useDraggable({ id: `col:${item.id}`, disabled: !canManage });
  const style = drag.transform ? { transform: `translate3d(${drag.transform.x}px, ${drag.transform.y}px, 0)` } : undefined;
  return (
    <li
      ref={(node) => {
        drop.setNodeRef(node);
        drag.setNodeRef(node);
      }}
      style={style}
      className={`rounded-md ${drop.isOver ? "bg-accent/10 ring-1 ring-accent" : ""} ${drag.isDragging ? "relative z-20 bg-background shadow-lg" : ""}`}
      data-collection={item.name}
    >
      <div className="flex items-center">
        {canManage && (
          <button type="button" {...drag.listeners} {...drag.attributes} aria-label={c.drag(item.name)} className={`${iconButton} cursor-grab touch-none`}>
            <Icon name="drag" size={14} />
          </button>
        )}
        <button type="button" onClick={onToggle} aria-expanded={isOpen} className={rowClass(false)}>
          <Icon name={isOpen ? "chevron-down" : "chevron-right"} size={12} className="text-muted" />
          <Icon name="folder" className="text-muted" />
          <span className="truncate">{item.name}</span>
          <span className="ml-auto text-xs text-muted">{count}</span>
        </button>
        {canManage && (
          <>
            <button type="button" onClick={onRename} aria-label={c.rename(item.name)} title={c.rename(item.name)} className={iconButton}>
              <Icon name="edit" size={14} />
            </button>
            <button type="button" onClick={onDelete} aria-label={c.remove(item.name)} title={c.remove(item.name)} className={iconButton}>
              <Icon name="trash" size={14} />
            </button>
          </>
        )}
      </div>
      {children}
    </li>
  );
}

function DraggableObject({ id, title, children }: { id: string; title: string; children: React.ReactNode }) {
  const { setNodeRef, transform, isDragging, listeners, attributes } = useDraggable({ id: `obj:${id}` });
  const style = transform ? { transform: `translate3d(${transform.x}px, ${transform.y}px, 0)` } : undefined;
  return (
    <div ref={setNodeRef} style={style} className={`flex items-center ${isDragging ? "relative z-20 rounded-md bg-background shadow-lg" : ""}`}>
      <button type="button" {...listeners} {...attributes} aria-label={c.dragObject(title)} className={`${iconButton} cursor-grab touch-none`}>
        ⠿
      </button>
      <ul className="min-w-0 flex-1">{children}</ul>
    </div>
  );
}
