"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useEffect, useRef, useState, useTransition } from "react";
import { createReactBlockSpec } from "@blocknote/react";
import { t } from "@/i18n";
import { workspacePath } from "@/lib/paths";
import { readMap, type MapData } from "@/lib/nodes";
import { useOptionalPages } from "@/components/pages/pages-provider";
import { createNodeMap, nodeObjectView, nodeObjectsForEmbed, saveNodeMap, type NodeObjectSummary, type NodeObjectView } from "@/app/node-actions";

const MindMapCanvas = dynamic(() => import("@/components/nodes/mind-map-canvas"), { ssr: false, loading: () => <p className="p-4 text-sm text-muted">…</p> });
const DiagramCanvas = dynamic(() => import("./diagram-canvas"), { ssr: false, loading: () => <p className="p-4 text-sm text-muted">…</p> });

const e = t.nodes.embed;

// A map or a diagram of the node space on a wiki page (step Н3). Only its id is
// stored in the page; what shows is read live with the reader's own access.
export const nodeMapBlock = createReactBlockSpec(
  {
    type: "nodeMap",
    propSchema: { objectId: { default: "" } },
    content: "none",
  },
  {
    meta: { selectable: false },
    render: ({ block, editor }) => (
      <NodeMapEmbed objectId={block.props.objectId} pageEditable={editor.isEditable} onPick={(objectId) => editor.updateBlock(block, { props: { objectId } })} />
    ),
    toExternalHTML: () => <p>[{e.title}]</p>,
  },
);

function NodeMapEmbed({ objectId, pageEditable, onPick }: { objectId: string; pageEditable: boolean; onPick: (id: string) => void }) {
  const pages = useOptionalPages();
  const shortId = pages?.workspace.shortId ?? "";
  const [view, setView] = useState<NodeObjectView | null | undefined>(undefined);
  const [list, setList] = useState<NodeObjectSummary[] | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [tick, setTick] = useState(0);
  // Changes made here are saved at once; a newer version elsewhere is taken on the next read.
  const version = useRef(0);
  const busy = useRef(false);

  useEffect(() => {
    if (!shortId || !objectId) return;
    let alive = true;
    nodeObjectView(shortId, objectId).then((result) => {
      if (!alive || busy.current) return;
      version.current = result?.version ?? 0;
      setView(result);
    });
    const again = () => document.visibilityState === "visible" && setTick((n) => n + 1);
    const timer = setInterval(again, 30_000);
    document.addEventListener("visibilitychange", again);
    window.addEventListener("focus", again);
    return () => {
      alive = false;
      clearInterval(timer);
      document.removeEventListener("visibilitychange", again);
      window.removeEventListener("focus", again);
    };
  }, [shortId, objectId, tick]);
  useEffect(() => {
    if (!objectId && pageEditable && shortId && !list) nodeObjectsForEmbed(shortId).then(setList);
  }, [objectId, pageEditable, shortId, list]);

  const save = (map: MapData) => {
    if (!view) return;
    setView({ ...view, data: map });
    busy.current = true;
    startTransition(async () => {
      const result = await saveNodeMap(shortId, view.id, null, map, version.current);
      busy.current = false;
      if (result.ok) {
        version.current = result.version;
        setNotice(null);
      } else {
        setNotice(result.error === "conflict" ? e.conflict : (t.nodes.errors[result.error] ?? t.common.unknownError));
        setTick((n) => n + 1);
      }
    });
  };

  let body: React.ReactNode;
  if (!objectId) {
    body = pageEditable ? (
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <select defaultValue="" onChange={(event) => event.target.value && onPick(event.target.value)} aria-label={e.choose} className="min-h-9 min-w-0 flex-1 rounded-md border border-border bg-background px-2">
          <option value="">{e.choose}</option>
          {(list ?? []).map((item) => (
            <option key={item.id} value={item.id}>
              {item.kind === "flow" ? "🔀" : "🧠"} {item.title || t.nodes.untitled}
            </option>
          ))}
        </select>
        {(["mindmap", "flow"] as const).map((kind) => (
          <button
            key={kind}
            type="button"
            disabled={pending}
            onClick={() =>
              startTransition(async () => {
                const made = await createNodeMap(shortId, kind);
                if (made.ok) onPick(made.id);
                else setNotice(t.nodes.errors[made.error] ?? t.common.unknownError);
              })
            }
            className="min-h-9 rounded-md border border-border px-3 hover:bg-surface"
          >
            {kind === "flow" ? t.nodes.newFlow : t.nodes.newMap}
          </button>
        ))}
      </div>
    ) : (
      <p className="text-sm text-muted">{e.empty}</p>
    );
  } else if (view === undefined) {
    body = <p className="text-sm text-muted">{e.loading}</p>;
  } else if (view === null) {
    body = <p className="text-sm text-muted">🔒 {e.noAccess}</p>;
  } else {
    body = (
      <>
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-medium">
            {view.kind === "flow" ? "🔀" : "🧠"} {view.title || t.nodes.untitled}
          </span>
          <span className="flex-1" />
          <Link href={workspacePath(shortId, `/nodes/${view.id}`)} className="text-sm text-accent hover:underline">
            {e.openEditor} ↗
          </Link>
        </div>
        {view.kind === "flow" ? (
          <DiagramCanvas key={view.version} large data={JSON.stringify(view.data ?? {})} height={400} editable={false} onChange={() => {}} onHeightChange={() => {}} />
        ) : (
          <MindMapCanvas
            key={view.id}
            compact
            shortId={shortId}
            map={readMap(view.data, t.nodes.centralTopic)}
            editable={view.canEdit}
            onChange={save}
            onLocalChange={(map) => setView({ ...view, data: map })}
          />
        )}
      </>
    );
  }

  return (
    <div className="w-full space-y-2 rounded-lg border border-border p-3" contentEditable={false} data-node-embed={view?.title ?? ""}>
      {body}
      {notice && (
        <p role="status" className="text-sm text-muted">
          {notice}
        </p>
      )}
    </div>
  );
}
