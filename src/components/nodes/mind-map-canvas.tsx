"use client";

import "@xyflow/react/dist/style.css";
import { createContext, memo, use, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Background, BackgroundVariant, Handle, Position, ReactFlow, ReactFlowProvider, ViewportPortal, useReactFlow, type Edge, type Node, type NodeProps } from "@xyflow/react";
import { t } from "@/i18n";
import { useResolvedTheme } from "@/lib/use-theme";
import { useRouter } from "next/navigation";
import { workspacePath } from "@/lib/paths";
import { createNodeMap } from "@/app/node-actions";
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

const n = t.nodes;

type NodeView = { text: string; color: NodeColor; selected: boolean; editing: boolean; root: boolean; hidden: number; collapsed: boolean; hasChildren: boolean };
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

const nodeTypes = { map: MapNodeView };

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
type CanvasProps = { shortId: string; map: MapData; editable: boolean; onChange: (next: MapData) => void; onLocalChange: (next: MapData) => void; compact?: boolean };

function Canvas({ shortId, map, editable, onChange, onLocalChange, compact = false }: CanvasProps) {
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

  const tool = "min-h-11 rounded-md border border-border bg-background px-3 text-sm hover:bg-surface disabled:opacity-40 md:min-h-9";
  return (
    <div className="mt-3 flex flex-1 flex-col gap-2">
      <div role="toolbar" aria-label={n.toolbar} className="flex flex-wrap items-center gap-1" data-map-toolbar>
        {editable && !compact && (
          <>
            <button type="button" title={n.addChildHint} onClick={() => grow(addChild(map, node.id))} className={tool}>
              {n.addChild}
            </button>
            <button type="button" title={n.addSiblingHint} onClick={() => grow(addSibling(map, node.id))} className={tool}>
              {n.addSibling}
            </button>
            <button type="button" aria-label={n.edit} title={n.edit} onClick={() => edit(node.id)} className={tool}>
              ✏️
            </button>
          </>
        )}
        {editable && compact && (
          <button type="button" aria-label={n.edit} title={n.edit} onClick={() => edit(node.id)} className={tool}>
            ✏️
          </button>
        )}
        <button type="button" disabled={!childrenOf(map, node.id).length} aria-label={node.collapsed ? n.expand : n.collapse} title={node.collapsed ? n.expand : n.collapse} onClick={() => callbacks.toggle(node.id)} className={tool}>
          {node.collapsed ? "⊞" : "⊟"}
        </button>
        {editable && !compact && (
          <>
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
              🗑
            </button>
          </>
        )}
        <button type="button" onClick={() => flow.fitView({ duration: 200, padding: 0.2 })} className={tool}>
          ⤢ {n.fit}
        </button>
        {!compact && (<>
        <button
          type="button"
          onClick={async () => {
            await navigator.clipboard.writeText(mapToOutline(mapRef.current)).catch(() => {});
            setNotice(n.outlineCopied);
          }}
          className={tool}
        >
          📋 {n.asList}
        </button>
        {editable && (
          <button type="button" onClick={() => setPasting(true)} className={tool}>
            📥 {n.fromList}
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
          🔀 {n.toFlow}
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
        onKeyDown={onKey}
        aria-label={t.nodes.kinds.mindmap}
        data-mind-map
        className={`relative ${compact ? "h-96" : "h-[65vh] min-h-80"} overflow-hidden rounded-xl border border-border outline-none focus-visible:ring-2 focus-visible:ring-accent`}
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
        >
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
  );
}

export default function MindMapCanvas(props: CanvasProps) {
  return (
    <ReactFlowProvider>
      <Canvas {...props} />
    </ReactFlowProvider>
  );
}
