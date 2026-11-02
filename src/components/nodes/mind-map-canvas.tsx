"use client";

import "@xyflow/react/dist/style.css";
import { createContext, memo, use, useEffect, useMemo, useRef, useState } from "react";
import { Background, BackgroundVariant, Handle, Position, ReactFlow, ReactFlowProvider, useReactFlow, type Edge, type Node, type NodeProps } from "@xyflow/react";
import { t } from "@/i18n";
import { useResolvedTheme } from "@/lib/use-theme";
import {
  MAX_NODES,
  NODE_COLORS,
  NODE_COLOR_STYLES,
  NODE_WIDTH,
  addChild,
  addSibling,
  childrenOf,
  layoutMap,
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
  const input = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    if (data.editing) {
      input.current?.focus();
      input.current?.select();
    }
  }, [data.editing]);
  const cb = use(CallbacksContext)!;
  return (
    <div
      data-map-node={data.text || "…"}
      data-selected={data.selected ? "" : undefined}
      onClick={() => cb.select(id)}
      onDoubleClick={() => cb.startEdit(id)}
      className={`relative rounded-xl border-2 px-3 py-2 text-sm shadow-sm ${data.root ? "text-base font-semibold" : ""} ${data.selected ? "ring-2 ring-accent ring-offset-1" : ""}`}
      style={{ width: NODE_WIDTH, background: colors.bg, borderColor: colors.border, color: data.color === "default" ? "var(--foreground)" : "#111827" }}
    >
      <Handle type="target" position={Position.Left} className="!opacity-0" isConnectable={false} />
      {data.editing ? (
        <textarea
          ref={input}
          defaultValue={data.text}
          rows={1}
          maxLength={500}
          aria-label={n.edit}
          className="nodrag w-full resize-none bg-transparent outline-none [field-sizing:content]"
          onKeyDown={(e) => {
            e.stopPropagation();
            // Esc finishes typing and keeps the text.
            if (e.key === "Escape") cb.commit(id, e.currentTarget.value);
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              cb.commit(id, e.currentTarget.value, "sibling");
            }
            if (e.key === "Tab") {
              e.preventDefault();
              cb.commit(id, e.currentTarget.value, "child");
            }
          }}
          onBlur={(e) => cb.commit(id, e.currentTarget.value)}
        />
      ) : (
        <span className="block break-words">{data.text || "…"}</span>
      )}
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

function Canvas({ map, editable, onChange, onLocalChange }: { map: MapData; editable: boolean; onChange: (next: MapData) => void; onLocalChange: (next: MapData) => void }) {
  const theme = useResolvedTheme();
  const flow = useReactFlow();
  const wrapper = useRef<HTMLDivElement>(null);
  const [selected, setSelected] = useState<string>(() => rootOf(map).id);
  const [editing, setEditing] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Folding is allowed to readers too, but only editors' folds are saved.
  const change = (next: MapData) => (editable ? onChange(next) : onLocalChange(next));
  const grow = (made: [MapData, string]) => {
    if (made[0].nodes.length > MAX_NODES) return setError(n.tooBig);
    change(made[0]);
    setSelected(made[1]);
    setEditing(made[1]);
  };

  const callbacks: Callbacks = {
    select: (id) => {
      setSelected(id);
      wrapper.current?.focus();
    },
    startEdit: (id) => {
      if (!editable) return;
      setSelected(id);
      setEditing(id);
    },
    commit: (id, text, then) => {
      if (editing !== id) return;
      const current = map.nodes.find((node) => node.id === id);
      const next = current && current.text !== text ? updateNode(map, id, { text: text.trim().slice(0, 500) }) : map;
      setEditing(null);
      if (then === "child") return grow(addChild(next, id));
      if (then === "sibling") return grow(addSibling(next, id));
      if (next !== map) change(next);
      wrapper.current?.focus();
    },
    cancel: () => {
      setEditing(null);
      wrapper.current?.focus();
    },
    toggle: (id) => {
      const node = map.nodes.find((x) => x.id === id);
      if (node) change(updateNode(map, id, { collapsed: node.collapsed ? undefined : true }));
    },
  };

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
      return setEditing(node.id);
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
        {editable && (
          <>
            <button type="button" title={n.addChildHint} onClick={() => grow(addChild(map, node.id))} className={tool}>
              {n.addChild}
            </button>
            <button type="button" title={n.addSiblingHint} onClick={() => grow(addSibling(map, node.id))} className={tool}>
              {n.addSibling}
            </button>
            <button type="button" aria-label={n.edit} title={n.edit} onClick={() => setEditing(node.id)} className={tool}>
              ✏️
            </button>
          </>
        )}
        <button type="button" disabled={!childrenOf(map, node.id).length} aria-label={node.collapsed ? n.expand : n.collapse} title={node.collapsed ? n.expand : n.collapse} onClick={() => callbacks.toggle(node.id)} className={tool}>
          {node.collapsed ? "⊞" : "⊟"}
        </button>
        {editable && (
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
        <span className="hidden text-xs text-muted lg:inline">{editable ? n.keys : ""}</span>
      </div>
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
        className="relative min-h-[60vh] flex-1 overflow-hidden rounded-xl border border-border outline-none focus-visible:ring-2 focus-visible:ring-accent"
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
          elementsSelectable={false}
          onlyRenderVisibleElements
          proOptions={{ hideAttribution: true }}
          onPaneClick={() => wrapper.current?.focus()}
        >
          <Background variant={BackgroundVariant.Dots} gap={20} size={1} />
        </ReactFlow>
        </CallbacksContext>
      </div>
    </div>
  );
}

export default function MindMapCanvas(props: { map: MapData; editable: boolean; onChange: (next: MapData) => void; onLocalChange: (next: MapData) => void }) {
  return (
    <ReactFlowProvider>
      <Canvas {...props} />
    </ReactFlowProvider>
  );
}
