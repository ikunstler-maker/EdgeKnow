"use client";

import { t } from "@/i18n";
import { newId, type AutoLayout, type Interaction, type Paint, type SlideNode, type StrokePaint } from "@/lib/slides";
import { DEVICES, type DesignPage, componentSet, variantName } from "@/lib/design";
import { Icon } from "@/components/ui/icon";

const g = t.design;
const p = t.design.prototype;
const field = "min-h-9 w-full rounded-md border border-white/10 bg-transparent px-2 text-sm";
const chip = (on: boolean) => `min-h-9 rounded-md border px-2 text-xs hover:bg-white/10 ${on ? "border-sky-400 bg-sky-500/20" : "border-white/10"}`;

export const Section = ({ title, children }: { title: string; children: React.ReactNode }) => (
  <fieldset className="space-y-2 border-t border-white/10 pt-3">
    <legend className="mb-1 text-[11px] font-medium uppercase tracking-wide opacity-60">{title}</legend>
    {children}
  </fieldset>
);

function Num({ label, value, onChange, min, max, step = 1, data }: { label: string; value: number; onChange: (v: number) => void; min?: number; max?: number; step?: number; data?: string }) {
  return (
    <label className="flex flex-col gap-0.5 text-[11px] opacity-90">
      {label}
      <input
        type="number"
        value={Math.round(value * 100) / 100}
        min={min}
        max={max}
        step={step}
        onChange={(e) => {
          const v = Number(e.target.value);
          if (Number.isFinite(v)) onChange(Math.min(max ?? v, Math.max(min ?? v, v)));
        }}
        className={field}
        data-field={data}
      />
    </label>
  );
}

// A frame: device size, clipping, auto layout (step Д-2).
export function FramePanel({ node, set }: { node: SlideNode; set: (patch: Partial<SlideNode>) => void }) {
  const al = node.autoLayout;
  const setAl = (patch: Partial<AutoLayout>) => set({ autoLayout: { ...(al as AutoLayout), ...patch } });
  return (
    <>
      <Section title={g.frame.title}>
        <select
          value={node.device ?? "custom"}
          onChange={(e) => {
            const d = DEVICES.find((x) => x.id === e.target.value);
            set(d ? { device: d.id, width: d.w, height: d.h } : { device: undefined });
          }}
          className={field}
          aria-label={g.frame.device}
          data-frame-device
        >
          <option value="custom">{g.frame.devices.custom}</option>
          {DEVICES.map((d) => (
            <option key={d.id} value={d.id}>
              {g.frame.devices[d.id]}
            </option>
          ))}
        </select>
        <label className="flex min-h-9 items-center gap-2 text-sm">
          <input type="checkbox" className="h-4 w-4" checked={!!node.clip} onChange={(e) => set({ clip: e.target.checked || undefined })} data-frame-clip />
          {g.frame.clip}
        </label>
      </Section>
      <Section title={g.autoLayout.title}>
        {!al ? (
          <button type="button" className={`${chip(false)} w-full`} onClick={() => set({ autoLayout: { dir: "column", gap: 12, padding: [16, 16, 16, 16], alignMain: "start", alignCross: "start" } })} data-auto-layout-add>
            {g.autoLayout.add}
          </button>
        ) : (
          <>
            <div className="flex gap-1">
              {(["row", "column", "wrap"] as const).map((d) => (
                <button key={d} type="button" className={chip(al.dir === d)} onClick={() => setAl({ dir: d })} data-al-dir={d}>
                  {g.autoLayout.dirs[d]}
                </button>
              ))}
            </div>
            <div className="grid grid-cols-2 gap-2">
              <Num label={g.autoLayout.gap} value={al.gap} min={0} onChange={(gap) => setAl({ gap })} data="al-gap" />
              <label className="flex items-end gap-1 pb-2 text-xs">
                <input type="checkbox" checked={!!al.spaceBetween} onChange={(e) => setAl({ spaceBetween: e.target.checked || undefined })} />
                {g.autoLayout.spaceBetween}
              </label>
            </div>
            <p className="text-[11px] opacity-60">{g.autoLayout.padding}</p>
            <div className="grid grid-cols-4 gap-1">
              {g.autoLayout.paddingNames.map((name, i) => (
                <Num key={name} label={name} value={al.padding[i]} min={0} onChange={(v) => setAl({ padding: al.padding.map((x, j) => (j === i ? v : x)) as AutoLayout["padding"] })} />
              ))}
            </div>
            <p className="text-[11px] opacity-60">{g.autoLayout.align}</p>
            {/* 9 points: across (rows) × along (columns) of the layout's direction. */}
            <div className="grid w-28 grid-cols-3 gap-1" role="group" aria-label={g.autoLayout.align}>
              {(["start", "center", "end"] as const).flatMap((v) =>
                (["start", "center", "end"] as const).map((h) => {
                  const main = al.dir === "column" ? v : h;
                  const cross = al.dir === "column" ? h : v;
                  const on = al.alignMain === main && al.alignCross === cross;
                  return <button key={`${v}${h}`} type="button" aria-label={`${main}/${cross}`} onClick={() => setAl({ alignMain: main, alignCross: cross })} className={`h-8 rounded border ${on ? "border-sky-400 bg-sky-500/40" : "border-white/10"}`} data-al-align={`${main}-${cross}`} />;
                }),
              )}
            </div>
            <div className="grid grid-cols-2 gap-2">
              {(["sizeW", "sizeH"] as const).map((k) => (
                <label key={k} className="flex flex-col gap-0.5 text-[11px]">
                  {k === "sizeW" ? g.autoLayout.width : g.autoLayout.height}
                  <select value={node[k] ?? "fixed"} onChange={(e) => set({ [k]: e.target.value === "fixed" ? undefined : e.target.value } as Partial<SlideNode>)} className={field} data-frame-size={k}>
                    {(["fixed", "hug"] as const).map((x) => (
                      <option key={x} value={x}>
                        {g.autoLayout.sizing[x]}
                      </option>
                    ))}
                  </select>
                </label>
              ))}
            </div>
            <button type="button" className={chip(false)} onClick={() => set({ autoLayout: undefined, sizeW: undefined, sizeH: undefined })}>
              {g.autoLayout.remove}
            </button>
          </>
        )}
      </Section>
    </>
  );
}

// A layer inside a frame: its size in an auto layout, or its constraints.
export function ChildPanel({ node, parent, set }: { node: SlideNode; parent: SlideNode; set: (patch: Partial<SlideNode>) => void }) {
  if (parent.autoLayout)
    return (
      <Section title={g.autoLayout.title}>
        <div className="grid grid-cols-2 gap-2">
          {(["sizeW", "sizeH"] as const).map((k) => (
            <label key={k} className="flex flex-col gap-0.5 text-[11px]">
              {k === "sizeW" ? g.autoLayout.width : g.autoLayout.height}
              <select value={node[k] ?? "fixed"} onChange={(e) => set({ [k]: e.target.value === "fixed" ? undefined : e.target.value } as Partial<SlideNode>)} className={field} data-child-size={k}>
                {(["fixed", "fill"] as const).map((x) => (
                  <option key={x} value={x}>
                    {g.autoLayout.sizing[x]}
                  </option>
                ))}
              </select>
            </label>
          ))}
        </div>
      </Section>
    );
  const c = node.constraints ?? { h: "left" as const, v: "top" as const };
  return (
    <Section title={g.constraints.title}>
      <div className="grid grid-cols-2 gap-2">
        <label className="flex flex-col gap-0.5 text-[11px]">
          {g.constraints.horizontal}
          <select value={c.h} onChange={(e) => set({ constraints: { ...c, h: e.target.value as typeof c.h } })} className={field} data-constraint-h>
            {(["left", "right", "leftRight", "center", "scale"] as const).map((x) => (
              <option key={x} value={x}>
                {g.constraints.h[x]}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-0.5 text-[11px]">
          {g.constraints.vertical}
          <select value={c.v} onChange={(e) => set({ constraints: { ...c, v: e.target.value as typeof c.v } })} className={field} data-constraint-v>
            {(["top", "bottom", "topBottom", "center", "scale"] as const).map((x) => (
              <option key={x} value={x}>
                {g.constraints.v[x]}
              </option>
            ))}
          </select>
        </label>
      </div>
    </Section>
  );
}

// Stacked fills and strokes, inner shadow, background blur (step Д-2).
export function PaintsPanel({ node, set, onImageFill }: { node: SlideNode; set: (patch: Partial<SlideNode>) => void; onImageFill: (index: number) => void }) {
  const fills = node.fills ?? [];
  const strokes = node.strokes ?? [];
  const setFill = (i: number, f: Paint) => set({ fills: fills.map((x, j) => (j === i ? f : x)) });
  const setStroke = (i: number, st: StrokePaint) => set({ strokes: strokes.map((x, j) => (j === i ? st : x)) });
  return (
    <>
      <Section title={g.paints.fills}>
        {fills.map((f, i) => (
          <div key={i} className="flex flex-wrap items-center gap-1" data-paint={i}>
            <select
              value={f.kind}
              onChange={(e) => {
                const k = e.target.value;
                setFill(i, k === "solid" ? { kind: "solid", color: "#ffffff" } : k === "image" ? { kind: "image", imageId: "", fit: "fill" } : { kind: k as "linear", angle: 135, stops: [{ offset: 0, color: "#6366f1" }, { offset: 1, color: "#ec4899" }] });
                if (k === "image") onImageFill(i);
              }}
              className={`${field} w-24`}
              aria-label={g.paints.fills}
            >
              {["solid", "linear", "radial", "image"].map((k) => (
                <option key={k} value={k}>
                  {k === "image" ? g.paints.image : t.slides.design.fillModes[k]}
                </option>
              ))}
            </select>
            {f.kind === "solid" && <input type="color" value={f.color.slice(0, 7)} onChange={(e) => setFill(i, { ...f, color: e.target.value })} className="h-9 w-10 rounded" aria-label={g.paints.fills} />}
            {(f.kind === "linear" || f.kind === "radial") &&
              f.stops.map((st, j) => (
                <input key={j} type="color" value={st.color} onChange={(e) => setFill(i, { ...f, stops: f.stops.map((x, k) => (k === j ? { ...x, color: e.target.value } : x)) })} className="h-9 w-9 rounded" aria-label={t.slides.design.stop(j + 1)} />
              ))}
            {f.kind === "image" && (
              <>
                <select value={f.fit} onChange={(e) => setFill(i, { ...f, fit: e.target.value as "fill" })} className={`${field} w-24`} aria-label={g.paints.image}>
                  {(["fill", "fit", "tile"] as const).map((x) => (
                    <option key={x} value={x}>
                      {g.paints.fit[x]}
                    </option>
                  ))}
                </select>
                <button type="button" className={chip(false)} onClick={() => onImageFill(i)}>
                  <Icon name="image" />
                </button>
              </>
            )}
            <button type="button" className={chip(!!f.hidden)} aria-label={g.paints.hide} onClick={() => setFill(i, { ...f, hidden: !f.hidden || undefined })}>
              <Icon name="eye" />
            </button>
            <button type="button" className={chip(false)} aria-label={g.paints.remove} onClick={() => set({ fills: fills.filter((_, j) => j !== i) })}>
              −
            </button>
          </div>
        ))}
        <button type="button" className={chip(false)} onClick={() => set({ fills: [...fills, { kind: "solid", color: "#ffffff", opacity: 1 }] })} data-add-fill>
          {g.paints.addFill}
        </button>
      </Section>
      <Section title={g.paints.strokes}>
        {strokes.map((st, i) => (
          <div key={i} className="flex items-center gap-1">
            <input type="color" value={st.color.slice(0, 7)} onChange={(e) => setStroke(i, { ...st, color: e.target.value })} className="h-9 w-10 rounded" aria-label={g.paints.strokes} />
            <input type="number" min={0} value={st.width} onChange={(e) => setStroke(i, { ...st, width: Math.max(0, Number(e.target.value) || 0) })} className={`${field} w-16`} aria-label={t.slides.strokeWidth} />
            <select value={st.dash ?? "solid"} onChange={(e) => setStroke(i, { ...st, dash: e.target.value === "solid" ? undefined : (e.target.value as "dash") })} className={`${field} w-24`} aria-label={t.slides.design.dash}>
              {(["solid", "dash", "dot"] as const).map((x) => (
                <option key={x} value={x}>
                  {t.slides.design.dashes[x]}
                </option>
              ))}
            </select>
            <button type="button" className={chip(false)} aria-label={g.paints.remove} onClick={() => set({ strokes: strokes.filter((_, j) => j !== i) })}>
              −
            </button>
          </div>
        ))}
        <button type="button" className={chip(false)} onClick={() => set({ strokes: [...strokes, { color: "#000000", width: 1 }] })} data-add-stroke>
          {g.paints.addStroke}
        </button>
      </Section>
      <Section title={t.slides.design.effects}>
        <label className="flex min-h-9 items-center gap-2 text-sm">
          <input type="checkbox" className="h-4 w-4" checked={!!node.innerShadow} onChange={(e) => set({ innerShadow: e.target.checked ? { x: 0, y: 4, blur: 8, color: "#00000066" } : undefined })} data-inner-shadow />
          {g.paints.innerShadow}
        </label>
        <Num label={g.paints.bgBlur} value={node.bgBlur ?? 0} min={0} max={200} onChange={(v) => set({ bgBlur: v > 0 ? v : undefined })} data="bg-blur" />
      </Section>
    </>
  );
}

// Prototype (step Д-3): interactions of a layer, scrolling of a frame, flows of the page.
export function PrototypePanel({ node, page, frames, set, onFlows }: { node: SlideNode | null; page: DesignPage; frames: SlideNode[]; set: (patch: Partial<SlideNode>) => void; onFlows: (flows: DesignPage["flows"]) => void }) {
  if (!node)
    return (
      <Section title={p.flows}>
        {page.flows.length === 0 && <p className="text-xs opacity-60">{p.none}</p>}
        {page.flows.map((f) => (
          <div key={f.id} className="flex items-center gap-1">
            <input value={f.name} onChange={(e) => onFlows(page.flows.map((x) => (x.id === f.id ? { ...x, name: e.target.value.slice(0, 80) } : x)))} className={field} aria-label={p.flows} />
            <button type="button" className={chip(false)} onClick={() => onFlows(page.flows.filter((x) => x.id !== f.id))} aria-label={p.remove}>
              −
            </button>
          </div>
        ))}
      </Section>
    );
  const list = node.interactions ?? [];
  const setI = (i: number, patch: Partial<Interaction>) => set({ interactions: list.map((x, j) => (j === i ? { ...x, ...patch } : x)) });
  const isTop = node.type === "FRAME" && !node.parentId;
  return (
    <>
      {isTop && (
        <Section title={p.flows}>
          {page.flows.some((f) => f.start === node.id) ? (
            <p className="text-xs opacity-80"><Icon name="play" className="mr-1.5 inline" />{page.flows.find((f) => f.start === node.id)!.name}</p>
          ) : (
            <button type="button" className={`${chip(false)} w-full`} onClick={() => onFlows([...page.flows, { id: newId(), name: p.flowName(page.flows.length + 1), start: node.id }])} data-add-flow>
              {p.addFlow}
            </button>
          )}
        </Section>
      )}
      <Section title={p.tab}>
        <p className="text-[11px] opacity-60">{p.dragHint}</p>
        {list.map((it, i) => (
          <div key={it.id} className="space-y-1 rounded-md border border-white/10 p-2" data-interaction={i}>
            <div className="grid grid-cols-2 gap-1">
              <select value={it.trigger} onChange={(e) => setI(i, { trigger: e.target.value as Interaction["trigger"] })} className={field} aria-label={p.triggers[it.trigger]} data-trigger>
                {(["click", "hover", "press", "key", "delay"] as const).map((x) => (
                  <option key={x} value={x}>
                    {p.triggers[x]}
                  </option>
                ))}
              </select>
              <select value={it.action} onChange={(e) => setI(i, { action: e.target.value as Interaction["action"] })} className={field} aria-label={p.actions[it.action]} data-action>
                {(["navigate", "overlay", "swap", "close", "back", "scroll", "url"] as const).map((x) => (
                  <option key={x} value={x}>
                    {p.actions[x]}
                  </option>
                ))}
              </select>
            </div>
            {it.trigger === "key" && <input value={it.key ?? ""} onChange={(e) => setI(i, { key: e.target.value.slice(0, 20) })} placeholder={p.key} aria-label={p.key} className={field} />}
            {it.trigger === "delay" && <Num label={p.delay} value={it.delay ?? 800} min={0} max={60000} onChange={(delay) => setI(i, { delay })} />}
            {(it.action === "navigate" || it.action === "overlay" || it.action === "swap" || it.action === "scroll") && (
              <select value={it.target ?? ""} onChange={(e) => setI(i, { target: e.target.value || undefined })} className={field} aria-label={p.target} data-target>
                <option value="">{p.target}…</option>
                {frames.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.name}
                  </option>
                ))}
              </select>
            )}
            {it.action === "url" && <input value={it.url ?? ""} onChange={(e) => setI(i, { url: e.target.value.slice(0, 2000) })} placeholder={p.url} aria-label={p.url} className={field} />}
            {(it.action === "navigate" || it.action === "overlay" || it.action === "swap") && (
              <div className="grid grid-cols-2 gap-1">
                <select value={it.transition?.kind ?? "none"} onChange={(e) => setI(i, { transition: { duration: 300, easing: "ease", ...it.transition, kind: e.target.value as "none" } })} className={field} aria-label={p.transition} data-transition>
                  {(["none", "fade", "slide", "push", "smart"] as const).map((k) => (
                    <option key={k} value={k}>
                      {t.slides.transition.kinds[k]}
                    </option>
                  ))}
                </select>
                {(it.transition?.kind === "slide" || it.transition?.kind === "push") && (
                  <select value={it.transition.direction ?? "left"} onChange={(e) => setI(i, { transition: { ...it.transition!, direction: e.target.value as "left" } })} className={field} aria-label={t.slides.transition.direction}>
                    {(["left", "right", "up", "down"] as const).map((k) => (
                      <option key={k} value={k}>
                        {t.slides.transition.directions[k]}
                      </option>
                    ))}
                  </select>
                )}
                {it.transition && it.transition.kind !== "none" && <Num label={t.slides.transition.duration} value={it.transition.duration ?? 300} min={0} max={10000} step={50} onChange={(duration) => setI(i, { transition: { ...it.transition!, duration } })} />}
              </div>
            )}
            {it.action === "overlay" && (
              <div className="grid grid-cols-2 gap-1">
                <select value={it.overlay?.position ?? "center"} onChange={(e) => setI(i, { overlay: { backdrop: 0.4, closeOutside: true, ...it.overlay, position: e.target.value as "center" } })} className={field} aria-label={p.position.center}>
                  {(["center", "top", "bottom"] as const).map((k) => (
                    <option key={k} value={k}>
                      {p.position[k]}
                    </option>
                  ))}
                </select>
                <Num label={p.backdrop} value={Math.round((it.overlay?.backdrop ?? 0.4) * 100)} min={0} max={100} onChange={(v) => setI(i, { overlay: { position: "center", closeOutside: true, ...it.overlay, backdrop: v / 100 } })} />
                <label className="col-span-2 flex items-center gap-2 text-xs">
                  <input type="checkbox" checked={it.overlay?.closeOutside ?? true} onChange={(e) => setI(i, { overlay: { position: "center", backdrop: 0.4, ...it.overlay, closeOutside: e.target.checked } })} />
                  {p.closeOutside}
                </label>
              </div>
            )}
            <button type="button" className={chip(false)} onClick={() => set({ interactions: list.filter((_, j) => j !== i) })}>
              {p.remove}
            </button>
          </div>
        ))}
        <button type="button" className={`${chip(false)} w-full`} onClick={() => set({ interactions: [...list, { id: newId(), trigger: "click", action: "navigate", transition: { kind: "none", duration: 300, easing: "ease" } }] })} data-add-interaction>
          {p.add}
        </button>
      </Section>
      {node.type === "FRAME" && (
        <Section title={p.scroll}>
          <select value={node.scroll ?? "none"} onChange={(e) => set({ scroll: e.target.value === "none" ? undefined : (e.target.value as "vertical") })} className={field} aria-label={p.scroll} data-scroll>
            {(["none", "vertical", "horizontal", "both"] as const).map((k) => (
              <option key={k} value={k}>
                {p.scrolls[k]}
              </option>
            ))}
          </select>
        </Section>
      )}
      {node.parentId && (
        <label className="flex min-h-9 items-center gap-2 text-sm">
          <input type="checkbox" className="h-4 w-4" checked={!!node.fixed} onChange={(e) => set({ fixed: e.target.checked || undefined })} data-fixed />
          {p.fixed}
        </label>
      )}
    </>
  );
}

// BORDY-1: a frame made a component, copies of it, and switching a copy between the variants
// of its set (components whose names share the part before the last "/").
export function ComponentPanel({
  node,
  all,
  set,
  onMakeCopy,
  onDetach,
}: {
  node: SlideNode;
  all: SlideNode[];
  set: (patch: Partial<SlideNode>) => void;
  onMakeCopy: () => void;
  onDetach: () => void;
}) {
  const c = g.components;
  const components = all.filter((n) => n.component && n.type === "FRAME");
  const btn = "min-h-11 rounded-md border border-white/15 px-2 text-sm hover:bg-white/10 md:min-h-8";
  if (node.instanceOf) {
    const main = components.find((n) => n.id === node.instanceOf);
    const siblings = main ? components.filter((n) => componentSet(n.component!) === componentSet(main.component!)) : [];
    return (
      <Section title={c.copyTitle}>
        <p className="text-xs text-muted">{main ? c.copyOf(main.component!) : c.gone}</p>
        {siblings.length > 1 && (
          <select value={node.instanceOf} onChange={(e) => set({ instanceOf: e.target.value })} className="mt-1 min-h-11 w-full rounded-md border border-white/15 px-2 md:min-h-8" aria-label={c.variant} data-component-variant>
            {siblings.map((n) => (
              <option key={n.id} value={n.id}>
                {variantName(n.component!)}
              </option>
            ))}
          </select>
        )}
        <button type="button" onClick={onDetach} className={`${btn} mt-2`} data-component-detach>
          {c.detach}
        </button>
      </Section>
    );
  }
  if (node.type !== "FRAME") return null;
  if (!node.component)
    return (
      <Section title={c.title}>
        <button type="button" onClick={() => set({ component: node.name || c.defaultName })} className={btn} data-component-make>
          {c.make}
        </button>
        <p className="mt-1 text-xs text-muted">{c.hint}</p>
      </Section>
    );
  return (
    <Section title={c.title}>
      <label className="block text-xs text-muted">
        {c.name}
        <input defaultValue={node.component} onBlur={(e) => e.currentTarget.value.trim() && set({ component: e.currentTarget.value.trim().slice(0, 120) })} className="mt-1 min-h-11 w-full rounded-md border border-white/15 px-2 text-sm md:min-h-8" data-component-name />
      </label>
      <p className="mt-1 text-xs text-muted">{c.nameHint}</p>
      <div className="mt-2 flex flex-wrap gap-1">
        <button type="button" onClick={onMakeCopy} className={btn} data-component-copy>
          {c.copy}
        </button>
        <button type="button" onClick={() => set({ component: undefined })} className={btn} data-component-unmake>
          {c.unmake}
        </button>
      </div>
    </Section>
  );
}
