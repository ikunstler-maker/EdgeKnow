"use client";

import "@xyflow/react/dist/style.css";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Background,
  BackgroundVariant,
  SelectionMode,
  ConnectionMode,
  Handle,
  MarkerType,
  NodeResizer,
  Position,
  ReactFlow,
  ReactFlowProvider,
  ViewportPortal,
  applyEdgeChanges,
  applyNodeChanges,
  useReactFlow,
  type Connection,
  type Edge,
  type EdgeChange,
  type Node,
  type NodeChange,
  type NodeProps,
} from "@xyflow/react";
import { t } from "@/i18n";
import { useResolvedTheme } from "@/lib/use-theme";
import {
  DESCRIPTION_MAX,
  FILLS,
  GRID,
  HEIGHTS,
  NODE_MIN_HEIGHT,
  NODE_MIN_WIDTH,
  STATUS_EMOJI,
  STROKES,
  TITLE_MAX,
  alignToOthers,
  makeNode,
  newId,
  parseDiagram,
  serializeDiagram,
  snap,
  type Diagram,
  type FillName,
  type Guides,
  type StrokeName,
} from "@/lib/diagram";

const d = t.editor.diagram;
const SAVE_DELAY_MS = 400;

type BoxData = { title: string; description: string; fill: FillName; stroke: StrokeName; emoji: string };
type BoxNode = Node<BoxData, "box">;

const edgeDefaults = {
  type: "smoothstep",
  markerEnd: { type: MarkerType.ArrowClosed, width: 18, height: 18, color: STROKES.gray },
  style: { stroke: STROKES.gray, strokeWidth: 1.5 },
} satisfies Partial<Edge>;

function toFlow(diagram: Diagram): { nodes: BoxNode[]; edges: Edge[] } {
  return {
    nodes: diagram.nodes.map((n) => ({
      id: n.id,
      type: "box",
      position: { x: n.x, y: n.y },
      width: n.width,
      height: n.height,
      data: { title: n.title, description: n.description, fill: n.fill, stroke: n.stroke, emoji: n.emoji },
    })),
    edges: diagram.edges.map((e) => ({ ...edgeDefaults, ...e })),
  };
}

function fromFlow(nodes: BoxNode[], edges: Edge[]): Diagram {
  return {
    nodes: nodes.map((n) => ({
      id: n.id,
      x: Math.round(n.position.x),
      y: Math.round(n.position.y),
      width: Math.round(n.width ?? n.measured?.width ?? 192),
      height: Math.round(n.height ?? n.measured?.height ?? 96),
      ...n.data,
    })),
    edges: edges.map((e) => ({
      id: e.id,
      source: e.source,
      target: e.target,
      sourceHandle: e.sourceHandle ?? null,
      targetHandle: e.targetHandle ?? null,
    })),
  };
}

// A rounded rectangle: status emoji and title on top, description below.
// Text is rendered as text (never as HTML).
function BoxNodeView({ data, selected, isConnectable }: NodeProps<BoxNode>) {
  const handleClass = `ek-diagram-handle ${isConnectable ? "" : "ek-diagram-handle-hidden"}`;
  return (
    <>
      <NodeResizer
        isVisible={selected && isConnectable}
        minWidth={NODE_MIN_WIDTH}
        minHeight={NODE_MIN_HEIGHT}
        lineClassName="ek-diagram-resize-line"
        handleClassName="ek-diagram-resize-handle"
      />
      <div
        className="ek-diagram-node"
        style={{
          background: FILLS[data.fill],
          borderColor: selected ? "var(--accent)" : STROKES[data.stroke],
        }}
      >
        <div className="ek-diagram-node-title">
          {data.emoji && <span aria-hidden="true">{data.emoji}</span>}
          <span>{data.title || d.untitled}</span>
        </div>
        {data.description && <div className="ek-diagram-node-description">{data.description}</div>}
      </div>
      {(["top", "right", "bottom", "left"] as const).map((side) => (
        <Handle
          key={side}
          id={side}
          type="source"
          position={side === "top" ? Position.Top : side === "right" ? Position.Right : side === "bottom" ? Position.Bottom : Position.Left}
          isConnectable={isConnectable}
          className={handleClass}
        />
      ))}
    </>
  );
}

const nodeTypes = { box: BoxNodeView };

function GuideLines({ guides }: { guides: Guides }) {
  if (guides.vertical === null && guides.horizontal === null) return null;
  return (
    <ViewportPortal>
      {guides.vertical !== null && (
        <div className="ek-diagram-guide ek-diagram-guide-v" style={{ transform: `translate(${guides.vertical}px, -50000px)` }} />
      )}
      {guides.horizontal !== null && (
        <div className="ek-diagram-guide ek-diagram-guide-h" style={{ transform: `translate(-50000px, ${guides.horizontal}px)` }} />
      )}
    </ViewportPortal>
  );
}

export type DiagramCanvasProps = {
  data: string;
  height: number;
  editable: boolean;
  onChange: (data: string) => void;
  onHeightChange: (height: number) => void;
};

export default function DiagramCanvas(props: DiagramCanvasProps) {
  return (
    <ReactFlowProvider>
      <Canvas {...props} />
    </ReactFlowProvider>
  );
}

function Canvas({ data, height, editable, onChange, onHeightChange }: DiagramCanvasProps) {
  const initial = useMemo(() => toFlow(parseDiagram(data)), [data]);
  const [nodes, setNodes] = useState<BoxNode[]>(initial.nodes);
  const [edges, setEdges] = useState<Edge[]>(initial.edges);
  const [guides, setGuides] = useState<Guides>({ vertical: null, horizontal: null });
  // "hand" drags the canvas around; "select" draws a frame to pick several nodes.
  const [tool, setTool] = useState<"hand" | "select">("hand");
  // The document value we last wrote, and the last one we've seen from the document.
  const [emitted, setEmitted] = useState(data);
  const [seen, setSeen] = useState(data);
  const flow = useReactFlow();
  const colorMode = useResolvedTheme();
  const wrapper = useRef<HTMLDivElement>(null);

  // Undo/redo or another tab changed the block: take the document's version.
  if (data !== seen) {
    setSeen(data);
    if (data !== emitted) {
      setNodes(initial.nodes);
      setEdges(initial.edges);
    }
  }

  // Changes reach the document after a short pause (one undo step per pause).
  useEffect(() => {
    if (!editable) return;
    const timer = setTimeout(() => {
      const next = serializeDiagram(fromFlow(nodes, edges));
      if (next !== emitted && next !== seen) {
        setEmitted(next);
        onChange(next);
      }
    }, SAVE_DELAY_MS);
    return () => clearTimeout(timer);
  }, [nodes, edges, editable, emitted, seen, onChange]);

  const onNodesChange = useCallback((changes: NodeChange<BoxNode>[]) => {
    setNodes((current) => {
      let nextGuides: Guides = { vertical: null, horizontal: null };
      // A group moves as one piece on the grid; only a single node sticks to its neighbours.
      const draggedCount = changes.filter((c) => c.type === "position" && c.dragging).length;
      const adjusted = changes.map((change) => {
        // While dragging, stick to the edges and centres of nearby nodes.
        if (change.type === "position" && change.dragging && change.position && draggedCount === 1) {
          const node = current.find((n) => n.id === change.id);
          if (!node) return change;
          const size = { width: node.width ?? node.measured?.width ?? 192, height: node.height ?? node.measured?.height ?? 96 };
          const others = current
            .filter((n) => n.id !== change.id && !n.selected)
            .map((n) => ({ x: n.position.x, y: n.position.y, width: n.width ?? n.measured?.width ?? 192, height: n.height ?? n.measured?.height ?? 96 }));
          const aligned = alignToOthers({ ...change.position, ...size }, others);
          nextGuides = aligned.guides;
          return { ...change, position: { x: aligned.x, y: aligned.y } };
        }
        // Resizing snaps the size to the grid too.
        if (change.type === "dimensions" && change.resizing && change.dimensions) {
          return {
            ...change,
            dimensions: {
              width: Math.max(NODE_MIN_WIDTH, snap(change.dimensions.width)),
              height: Math.max(NODE_MIN_HEIGHT, snap(change.dimensions.height)),
            },
          };
        }
        return change;
      });
      setGuides(nextGuides);
      return applyNodeChanges(adjusted, current);
    });
  }, []);

  const onEdgesChange = useCallback(
    (changes: EdgeChange[]) => setEdges((current) => applyEdgeChanges(changes, current)),
    [],
  );

  const onConnect = useCallback((connection: Connection) => {
    if (connection.source === connection.target) return;
    setEdges((current) => {
      const exists = current.some(
        (e) => e.source === connection.source && e.target === connection.target && e.sourceHandle === connection.sourceHandle && e.targetHandle === connection.targetHandle,
      );
      return exists ? current : [...current, { ...edgeDefaults, ...connection, id: newId("e") }];
    });
  }, []);

  const selectedNodes = nodes.filter((n) => n.selected);
  const selected = selectedNodes.length === 1 ? selectedNodes[0] : null;
  const selectedEdges = edges.filter((e) => e.selected);

  const updateSelected = (patch: Partial<BoxData>) => {
    if (!selected) return;
    setNodes((current) => current.map((n) => (n.id === selected.id ? { ...n, data: { ...n.data, ...patch } } : n)));
  };

  const addNode = () => {
    // In the middle of what's on screen.
    const rect = wrapper.current?.getBoundingClientRect();
    const center = rect
      ? flow.screenToFlowPosition({ x: rect.left + rect.width / 2, y: rect.top + Math.min(rect.height, height) / 2 })
      : { x: 0, y: 0 };
    const node = makeNode(center.x - 96, center.y - 48);
    setNodes((current) => [
      ...current.map((n) => ({ ...n, selected: false })),
      { ...toFlow({ nodes: [node], edges: [] }).nodes[0], selected: true },
    ]);
  };

  const duplicate = () => {
    if (!selectedNodes.length) return;
    const copies = selectedNodes.map((n) => ({
      ...n,
      id: newId("n"),
      position: { x: n.position.x + GRID * 2, y: n.position.y + GRID * 2 },
      selected: true,
    }));
    setNodes((current) => [...current.map((n) => ({ ...n, selected: false })), ...copies]);
  };

  const removeSelected = () => {
    const removed = new Set(selectedNodes.map((n) => n.id));
    setNodes((current) => current.filter((n) => !n.selected));
    setEdges((current) => current.filter((e) => !e.selected && !removed.has(e.source) && !removed.has(e.target)));
  };

  const buttonClass = "min-h-11 rounded-md border border-border bg-background px-2.5 text-sm hover:bg-surface disabled:opacity-50 md:min-h-8";
  const toolClass = (active: boolean) =>
    `min-h-11 rounded px-2 text-sm md:min-h-7 ${active ? "bg-background font-medium shadow-sm" : "text-muted hover:text-foreground"}`;

  return (
    <div className="ek-diagram" contentEditable={false}>
      {editable && (
        <div className="flex flex-wrap items-center gap-1.5 border-b border-border p-1.5" role="toolbar" aria-label={d.toolbar}>
          <div role="group" aria-label={d.tools} className="flex gap-0.5 rounded-md bg-surface p-0.5">
            <button type="button" aria-pressed={tool === "hand"} onClick={() => setTool("hand")} title={d.handHint} className={toolClass(tool === "hand")}>
              ✋ {d.hand}
            </button>
            <button type="button" aria-pressed={tool === "select"} onClick={() => setTool("select")} title={d.selectHint} className={toolClass(tool === "select")}>
              ⬚ {d.select}
            </button>
          </div>
          <button type="button" onClick={addNode} className={buttonClass}>
            ＋ {d.addNode}
          </button>
          <button type="button" onClick={duplicate} disabled={!selectedNodes.length} className={buttonClass}>
            {d.duplicate}
          </button>
          <button
            type="button"
            onClick={removeSelected}
            disabled={!selectedNodes.length && !selectedEdges.length}
            className={buttonClass}
          >
            {d.delete}
          </button>
          <span className="flex-1" />
          <label className="flex items-center gap-1 text-xs text-muted">
            {d.height}
            <select
              value={height}
              onChange={(event) => onHeightChange(Number(event.target.value))}
              className="min-h-11 rounded-md border border-border bg-background px-1 text-sm md:min-h-8"
            >
              {Object.entries(HEIGHTS).map(([key, value]) => (
                <option key={key} value={value}>
                  {d.heights[key as keyof typeof HEIGHTS]}
                </option>
              ))}
            </select>
          </label>
        </div>
      )}

      <div ref={wrapper} style={{ height }} className="relative">
        <ReactFlow<BoxNode, Edge>
          colorMode={colorMode}
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          onNodeDragStop={() => setGuides({ vertical: null, horizontal: null })}
          connectionMode={ConnectionMode.Loose}
          snapToGrid
          snapGrid={[GRID, GRID]}
          nodesDraggable={editable}
          nodesConnectable={editable}
          elementsSelectable={editable}
          edgesFocusable={editable}
          nodesFocusable={editable}
          deleteKeyCode={editable ? ["Backspace", "Delete"] : null}
          // Shift+click adds nodes to the selection; Shift+drag (or the selection
          // tool) draws a frame around several nodes; then they move together.
          multiSelectionKeyCode={editable ? ["Shift", "Meta", "Control"] : null}
          selectionKeyCode={editable ? "Shift" : null}
          selectionOnDrag={editable && tool === "select"}
          panOnDrag={tool === "select" && editable ? [1, 2] : true}
          selectionMode={SelectionMode.Partial}
          // The page scrolls with the wheel; zoom with the buttons, Ctrl+wheel or a pinch.
          zoomOnScroll={false}
          preventScrolling={false}
          panOnScroll={false}
          minZoom={0.25}
          maxZoom={2}
          fitView
          fitViewOptions={{ padding: 0.2, maxZoom: 1 }}
          proOptions={{ hideAttribution: true }}
          defaultEdgeOptions={edgeDefaults}
          connectionLineStyle={{ stroke: STROKES.gray, strokeWidth: 1.5 }}
          aria-label={d.canvas}
        >
          <Background variant={BackgroundVariant.Dots} gap={GRID} size={1.2} />
          <GuideLines guides={guides} />
        </ReactFlow>
        <div className="absolute bottom-2 right-2 z-10 flex gap-1">
          <button type="button" onClick={() => flow.zoomOut()} aria-label={d.zoomOut} title={d.zoomOut} className={buttonClass}>
            −
          </button>
          <button type="button" onClick={() => flow.zoomIn()} aria-label={d.zoomIn} title={d.zoomIn} className={buttonClass}>
            ＋
          </button>
          <button type="button" onClick={() => flow.fitView({ padding: 0.2, maxZoom: 1 })} aria-label={d.fit} title={d.fit} className={buttonClass}>
            ⤢
          </button>
        </div>
        {nodes.length === 0 && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center px-4 text-center text-sm text-muted">
            {editable ? d.emptyEditable : d.empty}
          </div>
        )}
      </div>

      {editable && selected && (
        <NodeSettings key={selected.id} data={selected.data} onChange={updateSelected} />
      )}
      {editable && selectedNodes.length > 1 && (
        <div className="border-t border-border px-3 py-2 text-xs text-muted">{d.selected(selectedNodes.length)}</div>
      )}
      {editable && !selectedNodes.length && selectedEdges.length > 0 && (
        <div className="border-t border-border px-3 py-2 text-xs text-muted">{d.edgeSelected}</div>
      )}
      {editable && !selectedNodes.length && !selectedEdges.length && nodes.length > 0 && (
        <div className="border-t border-border px-3 py-2 text-xs text-muted">{d.hint} {d.multiHint}</div>
      )}
    </div>
  );
}

function Swatches<T extends string>({
  label,
  colors,
  value,
  onPick,
  ring,
}: {
  label: string;
  colors: Record<T, string>;
  value: T;
  onPick: (value: T) => void;
  ring?: boolean;
}) {
  return (
    <fieldset className="flex flex-wrap items-center gap-1.5">
      <legend className="mb-1 text-xs text-muted">{label}</legend>
      {(Object.keys(colors) as T[]).map((name) => (
        <button
          key={name}
          type="button"
          aria-label={d.colors[name as keyof typeof d.colors]}
          aria-pressed={value === name}
          title={d.colors[name as keyof typeof d.colors]}
          onClick={() => onPick(name)}
          className={`h-8 w-8 rounded-full border-2 ${value === name ? "outline outline-2 outline-offset-1 outline-[var(--accent)]" : ""}`}
          style={ring ? { borderColor: colors[name], background: "transparent" } : { background: colors[name], borderColor: "#d6d5d2" }}
        />
      ))}
    </fieldset>
  );
}

function NodeSettings({ data, onChange }: { data: BoxData; onChange: (patch: Partial<BoxData>) => void }) {
  const inputClass = "w-full rounded-md border border-border bg-background px-2 py-1.5 text-base md:text-sm";
  return (
    <div className="grid gap-3 border-t border-border p-3 md:grid-cols-2" aria-label={d.settings} role="group">
      <div className="space-y-2">
        <label className="block text-xs text-muted">
          {d.nodeTitle}
          <input
            value={data.title}
            maxLength={TITLE_MAX}
            onChange={(event) => onChange({ title: event.target.value })}
            className={`${inputClass} mt-1`}
          />
        </label>
        <label className="block text-xs text-muted">
          {d.description}
          <textarea
            value={data.description}
            rows={3}
            maxLength={DESCRIPTION_MAX}
            onChange={(event) => onChange({ description: event.target.value })}
            className={`${inputClass} mt-1 resize-y`}
          />
        </label>
      </div>
      <div className="space-y-3">
        <Swatches label={d.fill} colors={FILLS} value={data.fill} onPick={(fill) => onChange({ fill })} />
        <Swatches label={d.stroke} colors={STROKES} value={data.stroke} onPick={(stroke) => onChange({ stroke })} ring />
        <fieldset className="flex flex-wrap items-center gap-1">
          <legend className="mb-1 text-xs text-muted">{d.status}</legend>
          {STATUS_EMOJI.map((emoji) => (
            <button
              key={emoji || "none"}
              type="button"
              aria-pressed={data.emoji === emoji}
              aria-label={emoji || d.statusNone}
              onClick={() => onChange({ emoji })}
              className={`flex h-9 min-w-9 items-center justify-center rounded-md border px-1 text-base ${
                data.emoji === emoji ? "border-accent bg-accent/10" : "border-border"
              }`}
            >
              {emoji || "∅"}
            </button>
          ))}
          <input
            value={STATUS_EMOJI.includes(data.emoji as (typeof STATUS_EMOJI)[number]) ? "" : data.emoji}
            maxLength={8}
            placeholder={d.otherEmoji}
            aria-label={d.otherEmoji}
            onChange={(event) => onChange({ emoji: event.target.value.trim() })}
            className="h-9 w-20 rounded-md border border-border bg-background px-2 text-base md:text-sm"
          />
        </fieldset>
      </div>
    </div>
  );
}
