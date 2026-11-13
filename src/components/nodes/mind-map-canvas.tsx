"use client";

import "@xyflow/react/dist/style.css";
import { createContext, memo, use, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Background, BackgroundVariant, Handle, Position, ReactFlow, ReactFlowProvider, ViewportPortal, useReactFlow, useViewport, type Edge, type Node, type NodeProps } from "@xyflow/react";
import type { LiveDoc } from "@/lib/live/use-live-doc";
import { t } from "@/i18n";
import { useResolvedTheme } from "@/lib/use-theme";
import { useRouter } from "next/navigation";
import { workspacePath } from "@/lib/paths";
import { createNodeMap } from "@/app/node-actions";
import { useOptionalPages } from "@/components/pages/pages-provider";
import {
  MAX_NODES,
  NODE_COLORS,
  NODE_COLOR_STYLES,
  NODE_WIDTH,
  addChild,
  addSibling,
  childrenOf,
  insertOutline,
  layoutMap,
  mapToDiagram,
  mapToOutline,
  parseOutline,
  neighbour,
  removeNode,
  rootOf,
  updateNode,
  type MapData,
  type NodeColor,
} from "@/lib/nodes";
import { Icon } from "@/components/ui/icon";
import { ServiceIcon } from "@/components/services/service-icon";
import { cellChipOf, onCellChips, rememberCellChip } from "@/components/sheets/sheet-chips";
import { ChipPicker } from "@/components/sheets/chip-picker";

const n = t.nodes;

type NodeView = { text: string; color: NodeColor; selected: boolean; editing: boolean; root: boolean; hidden: number; collapsed: boolean; hasChildren: boolean; link?: string };
type Callbacks = { select: (id: string) => void; startEdit: (id: string) => void; commit: (id: string, text: string, then?: "child" | "sibling") => void; cancel: () => void; toggle: (id: string) => void };

const CallbacksContext = createContext<Callbacks | null>(null);

const MapNodeView = memo(function MapNodeView({ id, data }: NodeProps<Node<NodeView>>) {
  const colors = NODE_COLOR_STYLES[data.color];
  const cb = use(CallbacksContext)!;
  return (
    <div
      data-map-node={data.text || "…"}
      data-selected={data.selected ? "" : undefined}
      className={`relative rounded-xl border-2 px-3 py-2 text-sm shadow-sm ${data.root ? "text-base font-semibold" : ""} ${data.selected ? "ring-2 ring-accent ring-offset-1" : ""}`}
      style={{ width: NODE_WIDTH, background: colors.bg, borderColor: colors.border, color: data.color === "default" ? "var(--foreground)" : "#111827" }}
    >
      <Handle type="target" position={Position.Left} className="!opacity-0" isConnectable={false} />
      <span className={`block break-words ${data.editing ? "invisible" : ""}`}>{data.text || "…"}</span>
      <NodeChip link={data.link ?? (/^https?:\/\/\S+$/.test(data.text.trim()) ? data.text.trim() : undefined)} />
      {data.hasChildren && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            cb.toggle(id);
          }}
          aria-label={data.collapsed ? n.expand : n.collapse}
          className="nodrag absolute -right-3 top-1/2 flex h-6 min-w-6 -translate-y-1/2 items-center justify-center rounded-full border border-border bg-background px-1 text-xs text-muted hover:text-foreground"
        >
          {data.collapsed ? n.hidden(data.hidden) : "−"}
        </button>
      )}
      <Handle type="source" position={Position.Right} className="!opacity-0" isConnectable={false} />
    </div>
  );
});

// A linked thing under the node's text (UI-3): its live title with the viewer's access.
function NodeChip({ link }: { link?: string }) {
  const pages = useOptionalPages();
  const [, setTick] = useState(0);
  useEffect(() => {
    const off = onCellChips(() => setTick((x) => x + 1));
    return () => {
      off();
    };
  }, []);
  if (!link || !pages) return null;
  const chip = cellChipOf(link, pages.workspace.shortId, pages.workspace.id);
  if (!chip) return null;
  if (chip.state !== "ok")
    return (
      <span className="mt-1 inline-flex items-center gap-1 rounded-full border border-border bg-surface px-2 py-0.5 text-xs text-muted" data-node-chip={chip.state}>
        {chip.state === "none" ? <Icon name="lock" size={12} /> : null}
        {chip.state === "none" ? t.editor.chips.noAccess : "…"}
      </span>
    );
  return (
    <a
      href={chip.href}
      onClick={(e) => e.stopPropagation()}
      className="nodrag mt-1 inline-flex max-w-full items-center gap-1 truncate rounded-full border border-border bg-background px-2 py-0.5 text-xs text-foreground hover:bg-surface"
      data-node-chip={chip.title}
    >
      {chip.service === "home" ? <Icon name="gift" size={12} /> : <ServiceIcon serviceId={chip.service} size={12} />}
      <span className="truncate">{chip.title || t.editor.chips.untitledObject}</span>
    </a>
  );
}

const nodeTypes = { map: MapNodeView };

// Others in the room (CORE-4): their cursors with names and the node they have selected, in
// their colour; drawn in map coordinates, kept the same size at any zoom.
function LiveCursors({ live, positions }: { live: LiveDoc<MapData>; positions: Map<string, { x: number; y: number }> }) {
  const { zoom } = useViewport();
  const unit = 1 / zoom;
  return (
    <ViewportPortal>
      <div className="pointer-events-none" data-live-layer>
        {live.peers
          .filter((p) => !p.me && live.cursors[p.key]?.at === "map")
          .map((p) => {
            const c = live.cursors[p.key];
            const label = p.name.length > 24 ? `${p.name.slice(0, 23)}…` : p.name;
            return (
              <div key={p.key}>
                {c.sel.map((id) => {
                  const at = positions.get(id);
                  if (!at) return null;
                  return <div key={id} className="absolute rounded-xl border-2 border-dashed" style={{ left: at.x - 4, top: at.y - 4, width: NODE_WIDTH + 8, height: 48, borderColor: p.color }} data-live-selection />;
                })}
                {Number.isFinite(c.x) && Number.isFinite(c.y) && (
                  <div className="absolute" style={{ left: c.x, top: c.y, transform: `scale(${unit})`, transformOrigin: "0 0", transition: "left 180ms linear, top 180ms linear" }} data-live-cursor={p.name}>
                    <svg width="14" height="21" viewBox="0 0 14 21" aria-hidden>
                      <path d="M0,0 L0,17 L4.5,13 L7.5,20 L10.5,18.8 L7.6,12 L13,12 Z" fill={p.color} stroke="#fff" strokeWidth={1.2} />
                    </svg>
                    <span className="absolute left-3 top-[18px] whitespace-nowrap rounded px-1.5 py-0.5 text-xs text-white" style={{ background: p.color }}>
                      {label}
                    </span>
                  </div>
                )}
              </div>
            );
          })}
      </div>
    </ViewportPortal>
  );
}

// The text field of the node being typed in: over the node, there from the first
// moment (a new node is hidden by React Flow until it is measured).
function EditField({ text, x, y, root, onCommit }: { text: string; x: number; y: number; root: boolean; onCommit: (text: string, then?: "child" | "sibling") => void }) {
  const field = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => {
    field.current?.focus({ preventScroll: true });
    field.current?.select();
  }, []);
  return (
    <textarea
      ref={field}
      defaultValue={text}
      rows={1}
      maxLength={500}
      aria-label={n.edit}
      data-map-edit
      className={`nodrag nopan pointer-events-auto absolute resize-none rounded-xl border-2 border-accent bg-background px-3 py-2 text-sm text-foreground shadow-md outline-none [field-sizing:content] ${root ? "text-base font-semibold" : ""}`}
      style={{ transform: `translate(${x}px, ${y}px)`, width: NODE_WIDTH, zIndex: 10 }}
      onKeyDown={(e) => {
        e.stopPropagation();
        // Esc finishes typing and keeps the text.
        if (e.key === "Escape") onCommit(e.currentTarget.value);
        if (e.key === "Enter" && !e.shiftKey) {
          e.preventDefault();
          onCommit(e.currentTarget.value, "sibling");
        }
        if (e.key === "Tab") {
          e.preventDefault();
          onCommit(e.currentTarget.value, "child");
        }
      }}
      onBlur={(e) => onCommit(e.currentTarget.value)}
    />
  );
}

// compact: inside a wiki page — fold branches and rename nodes only, a smaller canvas.
type CanvasProps = { shortId: string; map: MapData; editable: boolean; onChange: (next: MapData) => void; onLocalChange: (next: MapData) => void; compact?: boolean; live?: LiveDoc<MapData> | null };

function Canvas({ shortId, map, editable, onChange, onLocalChange, compact = false, live = null }: CanvasProps) {
  const guest = useOptionalPages()?.workspace.role === "guest";
  const router = useRouter();
  const [pasting, setPasting] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const theme = useResolvedTheme();
  const flow = useReactFlow();
  const wrapper = useRef<HTMLDivElement>(null);
  const [selected, setSelected] = useState<string>(() => rootOf(map).id);
  const [editing, setEditing] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // The latest map and node being typed in, read by every action: a field that
  // goes away (blur after Tab/Enter) must never save an older map over a newer one.
  const mapRef = useRef(map);
  const editingRef = useRef<string | null>(null);
  const lastClick = useRef({ id: "", at: 0 });
  useEffect(() => {
    mapRef.current = map;
  }, [map]);
  const edit = (id: string | null) => {
    editingRef.current = id;
    setEditing(id);
  };

  // Folding is allowed to readers too, but only editors' folds are saved.
  const change = (next: MapData) => {
    mapRef.current = next;
    if (editable) onChange(next);
    else onLocalChange(next);
  };
  const grow = (made: [MapData, string]) => {
    if (made[0].nodes.length > MAX_NODES) return setError(n.tooBig);
    change(made[0]);
    setSelected(made[1]);
    edit(made[1]);
  };

  const callbacks: Callbacks = {
    select: (id) => {
      setSelected(id);
      wrapper.current?.focus({ preventScroll: true });
    },
    startEdit: (id) => {
      if (!editable) return;
      setSelected(id);
      edit(id);
    },
    commit: (id, text, then) => {
      if (editingRef.current !== id) return;
      edit(null);
      const latest = mapRef.current;
      const current = latest.nodes.find((node) => node.id === id);
      const clean = text.trim().slice(0, 500);
      const next = current && current.text !== clean ? updateNode(latest, id, { text: clean }) : latest;
      if (then === "child" && !compact) return grow(addChild(next, id));
      if (then === "sibling" && !compact) return grow(addSibling(next, id));
      if (next !== latest) change(next);
      wrapper.current?.focus({ preventScroll: true });
    },
    cancel: () => {
      edit(null);
      wrapper.current?.focus({ preventScroll: true });
    },
    toggle: (id) => {
      const latest = mapRef.current;
      const node = latest.nodes.find((x) => x.id === id);
      if (node) change(updateNode(latest, id, { collapsed: node.collapsed ? undefined : true }));
    },
  };

  // Double-click opens a node's text; listened to directly, because inside a wiki
  // page the page editor would take the double-click first.
  const startEditRef = useRef(callbacks.startEdit);
  useEffect(() => {
    startEditRef.current = callbacks.startEdit;
  });
  useEffect(() => {
    const element = wrapper.current;
    if (!element) return;
    const onDouble = (event: MouseEvent) => {
      const id = (event.target as HTMLElement | null)?.closest<HTMLElement>(".react-flow__node")?.dataset.id;
      event.stopPropagation();
      if (id) startEditRef.current(id);
    };
    // The page editor reads the second press of a double-click to select text and take the focus.
    const onSecondPress = (event: MouseEvent) => {
      if (event.detail >= 2) event.stopPropagation();
    };
    element.addEventListener("dblclick", onDouble);
    element.addEventListener("mousedown", onSecondPress);
    return () => {
      element.removeEventListener("dblclick", onDouble);
      element.removeEventListener("mousedown", onSecondPress);
    };
  }, []);

  const positions = useMemo(() => layoutMap(map), [map]);

  // ---- Live (CORE-4): own cursor with the selected node and the middle of the view.
  const pointer = useRef<{ x: number; y: number } | null>(null);
  const sendCursor = () => {
    if (!live?.active || !wrapper.current) return;
    const box = wrapper.current.getBoundingClientRect();
    const middle = flow.screenToFlowPosition({ x: box.left + box.width / 2, y: box.top + box.height / 2 });
    live.sendCursor({ x: pointer.current?.x ?? Number.NaN, y: pointer.current?.y ?? Number.NaN, at: "map", sel: [selected], view: { x: middle.x, y: middle.y, z: flow.getZoom() } });
  };
  // Following someone: the view goes where theirs goes; any own action stops it.
  const followView = live?.following ? live.cursors[live.following]?.view : undefined;
  useEffect(() => {
    if (followView) void flow.setCenter(followView.x, followView.y, { zoom: followView.z, duration: 150 });
  }, [flow, followView]);
  const stopFollowing = () => {
    if (live?.following) live.follow(null);
  };
  // The selected node shows at the others' at once.
  useEffect(() => {
    sendCursor();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected, live?.active]);
  const nodes: Node<NodeView>[] = useMemo(
    () =>
      map.nodes
        .filter((node) => positions.has(node.id))
        .map((node) => ({
          id: node.id,
          type: "map",
          position: { x: positions.get(node.id)!.x, y: positions.get(node.id)!.y },
          draggable: false,
          data: {
            text: node.text,
            color: node.color ?? "default",
            selected: node.id === selected,
            editing: node.id === editing,
            root: node.parent === null,
            hidden: positions.get(node.id)!.hidden,
            collapsed: Boolean(node.collapsed),
            hasChildren: map.nodes.some((x) => x.parent === node.id),
            link: node.link,
          },
        })),
    [map, positions, selected, editing],
  );
  const edges: Edge[] = useMemo(
    () =>
      map.nodes
        .filter((node) => node.parent && positions.has(node.id))
        .map((node) => ({ id: `${node.parent}-${node.id}`, source: node.parent!, target: node.id, type: "smoothstep", style: { strokeWidth: 2, stroke: NODE_COLOR_STYLES[node.color ?? "default"].border } })),
    [map, positions],
  );

  // A newly added node is brought into view.
  useEffect(() => {
    const at = positions.get(selected);
    if (at && editing === selected) flow.setCenter(at.x + NODE_WIDTH / 2, at.y + 20, { zoom: flow.getZoom(), duration: 200 });
  }, [editing, selected, positions, flow]);

  const node = map.nodes.find((x) => x.id === selected) ?? rootOf(map);
  const isRoot = node.parent === null;
  const onKey = (e: React.KeyboardEvent) => {
    if (editing) return;
    const go = (dir: "parent" | "child" | "up" | "down") => {
      const to = neighbour(map, node.id, dir);
      if (to) setSelected(to);
      e.preventDefault();
    };
    if (e.key === "ArrowLeft") return go("parent");
    if (e.key === "ArrowRight") return go("child");
    if (e.key === "ArrowUp") return go("up");
    if (e.key === "ArrowDown") return go("down");
    if (e.key === " " && childrenOf(map, node.id).length) {
      e.preventDefault();
      return callbacks.toggle(node.id);
    }
    if (!editable) return;
    if (compact) {
      if (e.key === "F2") {
        e.preventDefault();
        edit(node.id);
      }
      return;
    }
    if (e.key === "Tab") {
      e.preventDefault();
      return grow(addChild(map, node.id));
    }
    if (e.key === "Enter") {
      e.preventDefault();
      return grow(addSibling(map, node.id));
    }
    if (e.key === "F2") {
      e.preventDefault();
      return edit(node.id);
    }
    if ((e.key === "Delete" || e.key === "Backspace") && !isRoot) {
      e.preventDefault();
      setSelected(node.parent!);
      return change(removeNode(map, node.id));
    }
  };

  const chipPages = useOptionalPages();
  const [pickingChip, setPickingChip] = useState(false);
  const tool = "min-h-11 rounded-md border border-border bg-background px-3 text-sm hover:bg-surface disabled:opacity-40 md:min-h-9";
  const canChip = Boolean(chipPages);
  return (
    <>
    {pickingChip && chipPages && (
      <ChipPicker
        onClose={() => setPickingChip(false)}
        onPick={(picked) => {
          setPickingChip(false);
          const url = `${window.location.origin}${picked.path}`;
          rememberCellChip(url, chipPages.workspace.shortId, { state: "ok", service: picked.service, title: picked.title, href: picked.path });
          change(updateNode(map, node.id, { link: url }));
        }}
      />
    )}
    <div className={compact ? "mt-3 flex flex-1 flex-col gap-2" : "flex min-h-0 flex-1 flex-col"}>
      <div role="toolbar" aria-label={n.toolbar} className={`flex flex-wrap items-center gap-1 ${compact ? "" : "shrink-0 border-b border-border px-2 py-1"}`} data-map-toolbar>
        {editable && !compact && (
          <>
            <button type="button" title={n.addChildHint} onClick={() => grow(addChild(map, node.id))} className={tool}>
              {n.addChild}
            </button>
            <button type="button" title={n.addSiblingHint} onClick={() => grow(addSibling(map, node.id))} className={tool}>
              {n.addSibling}
            </button>
            <button type="button" aria-label={n.edit} title={n.edit} onClick={() => edit(node.id)} className={tool}>
              <Icon name="edit" />
            </button>
          </>
        )}
        {editable && compact && (
          <button type="button" aria-label={n.edit} title={n.edit} onClick={() => edit(node.id)} className={tool}>
            <Icon name="edit" />
          </button>
        )}
        <button type="button" disabled={!childrenOf(map, node.id).length} aria-label={node.collapsed ? n.expand : n.collapse} title={node.collapsed ? n.expand : n.collapse} onClick={() => callbacks.toggle(node.id)} className={tool}>
          {node.collapsed ? "⊞" : "⊟"}
        </button>
        {editable && !compact && (
          <>
            {canChip && (
              <button
                type="button"
                title={node.link ? n.chipRemove : n.chipHint}
                onClick={() => (node.link ? change(updateNode(map, node.id, { link: undefined })) : setPickingChip(true))}
                className={tool}
                data-map-chip
              >
                {node.link ? n.chipRemove : n.chip}
              </button>
            )}
            <select
              value={node.color ?? "default"}
              aria-label={n.color}
              onChange={(e) => change(updateNode(map, node.id, { color: e.target.value === "default" ? undefined : (e.target.value as NodeColor) }))}
              className={tool}
            >
              {NODE_COLORS.map((c) => (
                <option key={c} value={c}>
                  {n.colors[c]}
                </option>
              ))}
            </select>
            <button
              type="button"
              disabled={isRoot}
              aria-label={n.remove}
              title={n.remove}
              onClick={() => {
                setSelected(node.parent!);
                change(removeNode(map, node.id));
              }}
              className={`${tool} text-danger`}
            >
              <Icon name="trash" />
            </button>
          </>
        )}
        <button type="button" onClick={() => flow.fitView({ duration: 200, padding: 0.2 })} className={tool}>
          ⤢ {n.fit}
        </button>
        {!compact && (<>
        {/* A guest doesn't take the map away as text. */}
        {!guest && <button
          type="button"
          onClick={async () => {
            await navigator.clipboard.writeText(mapToOutline(mapRef.current)).catch(() => {});
            setNotice(n.outlineCopied);
          }}
          className={tool}
        >
          <Icon name="template" className="mr-1 inline" />
          {n.asList}
        </button>}
        {editable && (
          <button type="button" onClick={() => setPasting(true)} className={tool}>
            <Icon name="download" className="mr-1 inline" />
            {n.fromList}
          </button>
        )}
        <button
          type="button"
          onClick={async () => {
            const made = await createNodeMap(shortId, "flow", mapToDiagram(mapRef.current), rootOf(mapRef.current).text);
            if (made.ok) router.push(workspacePath(shortId, `/nodes/${made.id}`));
            else setError(n.errors[made.error] ?? t.common.unknownError);
          }}
          className={tool}
        >
          <Icon name="layers" className="mr-1 inline" />
          {n.toFlow}
        </button>
        </>)}
        <span className="hidden text-xs text-muted lg:inline">{editable ? (compact ? n.keysCompact : n.keys) : ""}</span>
      </div>
      {notice && (
        <p role="status" className="text-sm text-muted">
          {notice}
        </p>
      )}
      {pasting && (
        <form
          className="space-y-2 rounded-lg border border-border p-3 text-sm"
          aria-label={n.fromListTitle}
          onSubmit={(e) => {
            e.preventDefault();
            const text = new FormData(e.currentTarget).get("outline")?.toString() ?? "";
            const items = parseOutline(text);
            if (items.length) {
              const next = insertOutline(mapRef.current, node.id, items);
              if (next.nodes.length > MAX_NODES) setError(n.tooBig);
              else change(next);
            }
            setPasting(false);
          }}
        >
          <p className="font-medium">{n.fromListTitle}</p>
          <p className="text-xs text-muted">{n.fromListHint(node.text || "…")}</p>
          <textarea name="outline" rows={6} aria-label={n.fromListTitle} placeholder={"- Ідея\n  - Деталь\n- Ще одна"} className="w-full rounded-md border border-border bg-background px-2 py-1 font-mono text-base md:text-sm" />
          <div className="flex gap-2">
            <button type="submit" className="min-h-11 rounded-md bg-accent px-3 font-medium text-white md:min-h-9">
              {n.addBranches}
            </button>
            <button type="button" onClick={() => setPasting(false)} className={tool}>
              {t.common.cancel}
            </button>
          </div>
        </form>
      )}
      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
      <div
        ref={wrapper}
        tabIndex={0}
        onKeyDown={(e) => {
          stopFollowing();
          onKey(e);
        }}
        onPointerDownCapture={stopFollowing}
        onWheelCapture={stopFollowing}
        onPointerMove={(e) => {
          if (!live?.active) return;
          pointer.current = flow.screenToFlowPosition({ x: e.clientX, y: e.clientY });
          sendCursor();
        }}
        onPointerLeave={() => {
          pointer.current = null;
          if (live?.active) live.sendCursor(null);
        }}
        aria-label={t.nodes.kinds.mindmap}
        data-mind-map
        className={`relative ${compact ? "h-96 rounded-xl border border-border" : "min-h-80 flex-1"} overflow-hidden outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent`}
      >
        <CallbacksContext value={callbacks}>
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          colorMode={theme}
          fitView
          fitViewOptions={{ padding: 0.3 }}
          minZoom={0.2}
          maxZoom={2}
          nodesConnectable={false}
          nodesDraggable={false}
          // Selectable so clicks reach the nodes; selection, deleting and moving stay ours.
          elementsSelectable
          nodesFocusable={false}
          edgesFocusable={false}
          deleteKeyCode={null}
          selectionKeyCode={null}
          multiSelectionKeyCode={null}
          disableKeyboardA11y
          onlyRenderVisibleElements
          proOptions={{ hideAttribution: true }}
          onPaneClick={() => wrapper.current?.focus({ preventScroll: true })}
          // Clicks reach the nodes only with these (they aren't selectable or draggable).
          // A second click on the same node opens its text (inside a wiki page the
          // browser's double-click goes to the page editor, so it is counted here).
          onNodeClick={(_, clicked) => {
            const now = Date.now();
            const twice = lastClick.current.id === clicked.id && now - lastClick.current.at < 450;
            lastClick.current = { id: clicked.id, at: now };
            if (twice) callbacks.startEdit(clicked.id);
            else callbacks.select(clicked.id);
          }}
          zoomOnDoubleClick={false}
          onMoveEnd={() => sendCursor()}
        >
          {live?.active && <LiveCursors live={live} positions={positions} />}
          <Background variant={BackgroundVariant.Dots} gap={20} size={1} />
          {editing && positions.get(editing) && (
            <ViewportPortal>
              <EditField
                key={editing}
                text={map.nodes.find((x) => x.id === editing)?.text ?? ""}
                x={positions.get(editing)!.x}
                y={positions.get(editing)!.y}
                root={map.nodes.find((x) => x.id === editing)?.parent === null}
                onCommit={(text, then) => callbacks.commit(editing, text, then)}
              />
            </ViewportPortal>
          )}
        </ReactFlow>
        </CallbacksContext>
      </div>
    </div>
    </>
  );
}

export default function MindMapCanvas(props: CanvasProps) {
  return (
    <ReactFlowProvider>
      <Canvas {...props} />
    </ReactFlowProvider>
  );
}
