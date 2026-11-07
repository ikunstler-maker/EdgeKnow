"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { t } from "@/i18n";
import type { Interaction, SlideNode, Transition } from "@/lib/slides";
import { childrenOf, descendants, drawOrder, moveTree, type DesignDoc, type DesignPage } from "@/lib/design";
import { EASINGS, slideOffsets, smartFrame } from "@/lib/slide-motion";
import { NodeShape } from "@/components/slides/slide-view";

const p = t.design.prototype.player;
type Device = "none" | "phone" | "tablet" | "laptop";
type Scale = "fit" | "actual" | "width";
type Overlay = { id: string; opts: NonNullable<Interaction["overlay"]> };
type Anim = { from: string; to: string; tr: Transition; start: number };
const BEZEL: Record<Device, { pad: number; radius: number }> = { none: { pad: 0, radius: 0 }, phone: { pad: 14, radius: 44 }, tablet: { pad: 20, radius: 32 }, laptop: { pad: 16, radius: 14 } };
const OVERLAY_DEFAULT: Overlay["opts"] = { position: "center", backdrop: 0.4, closeOutside: true };

// A frame and everything in it, moved so the frame stands at 0,0.
function localTree(nodes: SlideNode[], frameId: string): SlideNode[] {
  const frame = nodes.find((n) => n.id === frameId);
  if (!frame) return [];
  const ids = new Set([frameId, ...descendants(nodes, frameId)]);
  return moveTree(
    nodes.filter((n) => ids.has(n.id)),
    [frameId],
    -frame.x,
    -frame.y,
  ).map((n) => (n.id === frameId ? { ...n, parentId: undefined } : n));
}

// How far the contents of a scrolling frame reach.
function contentSize(nodes: SlideNode[], frame: SlideNode) {
  let w = frame.width;
  let h = frame.height;
  for (const n of nodes) {
    if (n.id === frame.id || n.hidden) continue;
    w = Math.max(w, n.x + n.width);
    h = Math.max(h, n.y + n.height);
  }
  return { w: frame.scroll === "horizontal" || frame.scroll === "both" ? w : frame.width, h: frame.scroll === "vertical" || frame.scroll === "both" ? h : frame.height };
}

type FlowRef = { page: DesignPage; flow: { id: string; start: string } };
// Where a flow starts; without flows, the first frame of the page.
function pickStart(doc: DesignDoc, flows: FlowRef[], pageId: string | undefined, fid?: string): { page: DesignPage; frame: string } | null {
  const byFlow = flows.find((x) => x.flow.id === fid) ?? (pageId ? flows.find((x) => x.page.id === pageId) : undefined) ?? (!pageId ? flows[0] : undefined);
  if (byFlow && byFlow.page.nodes.some((n) => n.id === byFlow.flow.start)) return { page: byFlow.page, frame: byFlow.flow.start };
  const page = doc.pages.find((x) => x.id === pageId) ?? doc.pages[0];
  const first = page && childrenOf(page.nodes, null).find((n) => n.type === "FRAME" && !n.hidden);
  return first ? { page, frame: first.id } : null;
}

// The prototype player (step Д-3): flows from a start frame, click/hover/press/key/delay
// interactions, overlays, back, scrolling frames with fixed layers and the transitions of
// presentations ("smart" moves layers of the same name).
export function DesignPlayer({ doc, shortId, title, pageId, flowId, frameId }: { doc: DesignDoc; shortId: string; title: string; pageId?: string; flowId?: string; frameId?: string }) {
  const flows = useMemo(() => doc.pages.flatMap((page) => page.flows.map((f) => ({ page, flow: f }))), [doc]);
  const initial = pickStart(doc, flows, pageId, flowId);
  const [flow, setFlow] = useState(flowId ?? flows.find((x) => x.flow.start === initial?.frame)?.flow.id ?? "");
  const [page, setPage] = useState<DesignPage | null>(initial?.page ?? null);
  const [current, setCurrent] = useState(frameId && initial?.page.nodes.some((n) => n.id === frameId && n.type === "FRAME") ? frameId : (initial?.frame ?? ""));
  const [history, setHistory] = useState<string[]>([]);
  const [overlays, setOverlays] = useState<Overlay[]>([]);
  const [anim, setAnim] = useState<Anim | null>(null);
  const [now, setNow] = useState(0);
  const [device, setDevice] = useState<Device>("none");
  const [scale, setScale] = useState<Scale>("fit");
  const [hints, setHints] = useState(false);
  const [flash, setFlash] = useState(false);
  const [area, setArea] = useState({ w: 800, h: 600 });
  const areaRef = useRef<HTMLDivElement>(null);

  const nodes = useMemo(() => page?.nodes ?? [], [page]);
  const byId = useMemo(() => new Map(nodes.map((n) => [n.id, n])), [nodes]);
  const frame = byId.get(current);

  useEffect(() => {
    const el = areaRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setArea({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // The running transition.
  useEffect(() => {
    if (!anim) return;
    let raf = 0;
    const tick = () => {
      const tnow = performance.now();
      setNow(tnow);
      if (tnow - anim.start >= (anim.tr.duration ?? 300)) setAnim(null);
      else raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [anim]);

  const go = useCallback(
    (to: string, tr?: Transition, remember = true) => {
      if (!byId.has(to) || to === current) return;
      if (remember) setHistory((h) => [...h, current]);
      setOverlays([]);
      if (tr && tr.kind !== "none") {
        const start = performance.now();
        setNow(start);
        setAnim({ from: current, to, tr, start });
      } else setAnim(null);
      setCurrent(to);
    },
    [byId, current],
  );

  const restart = useCallback(
    (fid: string) => {
      const start = pickStart(doc, flows, pageId, fid || undefined);
      if (!start) return;
      setPage(start.page);
      setCurrent(start.frame);
      setHistory([]);
      setOverlays([]);
      setAnim(null);
    },
    [doc, flows, pageId, setPage],
  );

  const act = useCallback(
    (it: Interaction) => {
      switch (it.action) {
        case "navigate":
          if (it.target) go(it.target, it.transition);
          return;
        case "overlay":
          if (it.target && byId.has(it.target)) setOverlays((o) => [...o, { id: it.target!, opts: it.overlay ?? OVERLAY_DEFAULT }]);
          return;
        case "swap":
          if (it.target && byId.has(it.target)) setOverlays((o) => [...o.slice(0, -1), { id: it.target!, opts: it.overlay ?? o.at(-1)?.opts ?? OVERLAY_DEFAULT }]);
          return;
        case "close":
          setOverlays((o) => o.slice(0, -1));
          return;
        case "back":
          if (overlays.length) return setOverlays((o) => o.slice(0, -1));
          if (history.length) {
            const prev = history.at(-1)!;
            setHistory((h) => h.slice(0, -1));
            go(prev, it.transition, false);
          }
          return;
        case "scroll": {
          const target = it.target ? byId.get(it.target) : null;
          if (!target) return;
          document.querySelectorAll<HTMLElement>("[data-player-scroll-of]").forEach((el) => {
            const f = byId.get(el.dataset.playerScrollOf ?? "");
            if (f && descendants(nodes, f.id).includes(target.id)) el.scrollTo({ left: target.x - f.x, top: target.y - f.y, behavior: "smooth" });
          });
          return;
        }
        case "url":
          if (it.url && /^https?:\/\//i.test(it.url)) window.open(it.url, "_blank", "noopener,noreferrer");
          return;
      }
    },
    [byId, go, history, nodes, overlays.length],
  );

  // Interactions of the screens on show (the top overlay first).
  const live = useMemo(() => {
    const screens = [...overlays.map((o) => o.id).reverse(), current];
    return screens.flatMap((id) => [id, ...descendants(nodes, id)]).flatMap((id) => (byId.get(id)?.interactions ?? []).map((it) => ({ it, owner: id })));
  }, [byId, current, nodes, overlays]);

  // Key and delay triggers.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLSelectElement || e.target instanceof HTMLInputElement) return;
      const hit = live.find(({ it }) => it.trigger === "key" && it.key && it.key.toLowerCase() === e.key.toLowerCase());
      if (hit) return (e.preventDefault(), act(hit.it));
      if (e.key === "Escape" && overlays.length) setOverlays((o) => o.slice(0, -1));
      else if (e.key === "r" || e.key === "R") restart(flow);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [act, flow, live, overlays.length, restart]);
  useEffect(() => {
    const timers = live.filter(({ it }) => it.trigger === "delay").map(({ it }) => window.setTimeout(() => act(it), Math.max(0, it.delay ?? 800)));
    return () => timers.forEach(clearTimeout);
  }, [live, act]);

  if (!page || !frame) {
    return <main className="mx-auto max-w-md flex-1 px-4 py-16 text-center text-muted">{p.noFlow}</main>;
  }

  const bezel = BEZEL[device];
  const outerW = frame.width + bezel.pad * 2;
  const outerH = frame.height + bezel.pad * 2;
  const k = scale === "actual" ? 1 : scale === "width" ? Math.max(0.05, (area.w - 32) / outerW) : Math.max(0.05, Math.min((area.w - 32) / outerW, (area.h - 32) / outerH));

  const showHints = hints || flash;
  const screen = (id: string, key: string) => (
    <Screen
      key={key}
      nodes={localTree(nodes, id)}
      frameId={id}
      shortId={shortId}
      hints={showHints}
      onAct={act}
      onMiss={() => {
        setFlash(true);
        window.setTimeout(() => setFlash(false), 500);
      }}
    />
  );

  let body: React.ReactNode = screen(current, `s-${current}`);
  if (anim) {
    const tr = anim.tr;
    const raw = Math.min(1, (now - anim.start) / Math.max(1, tr.duration ?? 300));
    const e = EASINGS[tr.easing ?? "ease"](raw);
    if (tr.kind === "smart") {
      const from = { id: anim.from, background: "", nodes: drawOrder(localTree(nodes, anim.from)).filter((n) => n.id !== anim.from) };
      const to = { id: anim.to, background: "", nodes: drawOrder(localTree(nodes, anim.to)).filter((n) => n.id !== anim.to) };
      const baseFrom = localTree(nodes, anim.from).find((n) => n.id === anim.from);
      const base = localTree(nodes, anim.to).find((n) => n.id === anim.to);
      body = (
        <svg viewBox={`0 0 ${frame.width} ${frame.height}`} width={frame.width} height={frame.height} className="block" aria-hidden="true">
          {baseFrom && <NodeShape node={baseFrom} shortId={shortId} prefix="psa" embeds="view" />}
          {base && <NodeShape node={{ ...base, opacity: (base.opacity ?? 1) * e }} shortId={shortId} prefix="ps" embeds="view" />}
          {smartFrame(from, to, e).map((n) => (
            <NodeShape key={n.id} node={n} shortId={shortId} prefix="ps" embeds="view" />
          ))}
        </svg>
      );
    } else {
      const off = slideOffsets(tr, e);
      body = (
        <div className="relative h-full w-full overflow-hidden">
          <div className="absolute inset-0" style={{ transform: `translate(${off.from.x}%, ${off.from.y}%)`, opacity: off.from.opacity }}>
            {screen(anim.from, `a-${anim.from}`)}
          </div>
          <div className="absolute inset-0" style={{ transform: `translate(${off.to.x}%, ${off.to.y}%)`, opacity: off.to.opacity }}>
            {body}
          </div>
        </div>
      );
    }
  }

  const select = "min-h-11 rounded-md border border-white/15 bg-neutral-900 px-2 text-sm";
  return (
    <main className="flex h-dvh w-full flex-col bg-neutral-950 text-neutral-100" data-design-player>
      <header className="flex flex-wrap items-center gap-2 border-b border-white/10 px-3 py-2">
        <h1 className="mr-auto truncate text-sm font-medium">{title || p.title}</h1>
        {flows.length > 0 && (
          <select
            value={flow}
            onChange={(e) => {
              setFlow(e.target.value);
              restart(e.target.value);
            }}
            aria-label={p.flow}
            className={select}
            data-player-flow
          >
            {flows.map((x) => (
              <option key={x.flow.id} value={x.flow.id}>
                {doc.pages.length > 1 ? `${x.page.name} · ` : ""}
                {x.flow.name}
              </option>
            ))}
          </select>
        )}
        <select value={device} onChange={(e) => setDevice(e.target.value as Device)} aria-label={p.device} className={select} data-player-device>
          {(Object.keys(BEZEL) as Device[]).map((d) => (
            <option key={d} value={d}>
              {p.devices[d]}
            </option>
          ))}
        </select>
        <select value={scale} onChange={(e) => setScale(e.target.value as Scale)} aria-label={p.scale} className={select} data-player-scale>
          {(["fit", "actual", "width"] as Scale[]).map((x) => (
            <option key={x} value={x}>
              {p.scales[x]}
            </option>
          ))}
        </select>
        <label className="flex min-h-11 items-center gap-1 text-sm">
          <input type="checkbox" checked={hints} onChange={(e) => setHints(e.target.checked)} data-player-hints />
          {p.hints}
        </label>
        <button type="button" onClick={() => restart(flow)} className="min-h-11 rounded-md border border-white/15 px-3 text-sm hover:bg-white/10" data-player-restart>
          {p.restart}
        </button>
      </header>
      <div ref={areaRef} className="relative flex min-h-0 flex-1 overflow-auto p-4">
        <div className="m-auto shrink-0" style={{ width: outerW * k, height: outerH * k }}>
          <div
            className="relative origin-top-left"
            style={{ width: outerW, height: outerH, transform: `scale(${k})`, padding: bezel.pad, borderRadius: bezel.radius, background: device === "none" ? undefined : "#0a0a0a", boxShadow: device === "none" ? undefined : "0 0 0 2px #3f3f46, 0 20px 60px rgba(0,0,0,.5)" }}
          >
            <div className="relative overflow-hidden" style={{ width: frame.width, height: frame.height, borderRadius: Math.max(0, bezel.radius - bezel.pad) }} data-player-screen={frame.name}>
              {body}
              {overlays.map((o, i) => {
                const f = byId.get(o.id);
                if (!f) return null;
                const pos = o.opts.position;
                return (
                  <div
                    key={`${o.id}-${i}`}
                    className={`absolute inset-0 flex justify-center ${pos === "top" ? "items-start" : pos === "bottom" ? "items-end" : "items-center"}`}
                    style={{ background: `rgba(0,0,0,${o.opts.backdrop})` }}
                    onClick={(e) => e.target === e.currentTarget && o.opts.closeOutside && setOverlays((list) => list.slice(0, i))}
                    data-player-overlay={f.name}
                  >
                    <div style={{ width: f.width, height: f.height }} className="relative overflow-hidden">
                      {screen(o.id, `o-${o.id}-${i}`)}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}

// One screen: a frame in its own coordinates, scrolling if set, with hotspots.
function Screen({ nodes, frameId, shortId, hints, onAct, onMiss }: { nodes: SlideNode[]; frameId: string; shortId: string; hints: boolean; onAct: (it: Interaction) => void; onMiss: () => void }) {
  const frame = nodes.find((n) => n.id === frameId);
  if (!frame) return null;
  const size = contentSize(nodes, frame);
  const scrolls = size.w > frame.width || size.h > frame.height;
  const fixedIds = new Set(nodes.filter((n) => n.fixed && n.parentId === frameId).flatMap((n) => [n.id, ...descendants(nodes, n.id)]));
  const hot = (n: SlideNode) => (n.interactions ?? []).filter((it) => it.trigger === "click" || it.trigger === "hover" || it.trigger === "press");
  const tree = (pid: string | null, skipFixed: boolean, onlyFixed: boolean): React.ReactNode =>
    childrenOf(nodes, pid)
      .filter((n) => !n.hidden && (!skipFixed || !fixedIds.has(n.id)) && (!onlyFixed || pid !== frameId || fixedIds.has(n.id)))
      .map((n) => {
        const its = hot(n);
        const kids = n.type === "FRAME" || n.type === "GROUP";
        return (
          <g
            key={n.id}
            data-node-id={n.id}
            data-name={n.name}
            style={its.length ? { cursor: "pointer" } : undefined}
            onClick={
              its.some((it) => it.trigger === "click")
                ? (e) => {
                    e.stopPropagation();
                    its.filter((it) => it.trigger === "click").forEach(onAct);
                  }
                : undefined
            }
            onPointerEnter={its.some((it) => it.trigger === "hover") ? () => its.filter((it) => it.trigger === "hover").forEach(onAct) : undefined}
            onPointerDown={its.some((it) => it.trigger === "press") ? (e) => (e.stopPropagation(), its.filter((it) => it.trigger === "press").forEach(onAct)) : undefined}
            data-hotspot={its.length ? n.name : undefined}
          >
            {(n.id !== frameId || !onlyFixed) && <NodeShape node={n.id === frameId ? { ...n, width: size.w, height: size.h } : n} shortId={shortId} prefix={`p${frameId.slice(0, 4)}`} embeds="live" />}
            {kids && (
              <g clipPath={n.type === "FRAME" && n.clip && n.id !== frameId ? `url(#pc-${n.id})` : undefined}>
                {n.type === "FRAME" && n.clip && n.id !== frameId && (
                  <defs>
                    <clipPath id={`pc-${n.id}`}>
                      <rect x={n.x} y={n.y} width={n.width} height={n.height} />
                    </clipPath>
                  </defs>
                )}
                {tree(n.id, skipFixed, onlyFixed)}
              </g>
            )}
            {hints && its.length > 0 && <rect x={n.x} y={n.y} width={n.width} height={n.height} fill="rgba(56,189,248,.15)" stroke="#38bdf8" strokeWidth={2} pointerEvents="none" />}
          </g>
        );
      });
  return (
    <div className="relative" style={{ width: frame.width, height: frame.height }} onClick={onMiss}>
      <div data-player-scroll-of={frameId} className={`absolute inset-0 ${scrolls ? "overflow-auto" : "overflow-hidden"}`} data-player-scroll={scrolls || undefined}>
        <svg viewBox={`0 0 ${size.w} ${size.h}`} width={size.w} height={size.h} className="block" aria-hidden="true">
          {tree(null, true, false)}
        </svg>
      </div>
      {fixedIds.size > 0 && (
        <svg viewBox={`0 0 ${frame.width} ${frame.height}`} width={frame.width} height={frame.height} className="pointer-events-none absolute inset-0 [&_[data-hotspot]]:pointer-events-auto" aria-hidden="true">
          {tree(null, false, true)}
        </svg>
      )}
    </div>
  );
}
