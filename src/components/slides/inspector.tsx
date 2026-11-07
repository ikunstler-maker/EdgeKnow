"use client";

import { t } from "@/i18n";
import type { Gradient, Slide, SlideNode } from "@/lib/slides";
import { BRAND_GRADIENTS, FONTS } from "@/lib/slide-themes";

const s = t.slides;
const d = t.slides.design;
const inputClass = "min-h-11 w-full rounded-md border border-border bg-background px-2 text-base md:min-h-9 md:text-sm";
const colorClass = "h-11 w-full rounded-md border border-border md:h-9";
const chip = (on: boolean) => `flex h-11 min-w-11 items-center justify-center rounded-md border px-2 text-sm hover:bg-surface md:h-9 md:min-w-9 ${on ? "border-accent bg-accent/10" : "border-border"}`;

const Section = ({ title, children }: { title: string; children: React.ReactNode }) => (
  <fieldset className="space-y-2 border-t border-border pt-3 first:border-t-0 first:pt-0">
    <legend className="mb-1 text-xs font-medium uppercase tracking-wide text-muted">{title}</legend>
    {children}
  </fieldset>
);

function NumberField({ label, value, onChange, min, max, step = 1, data }: { label: string; value: number; onChange: (v: number) => void; min?: number; max?: number; step?: number; data?: string }) {
  return (
    <label className="flex flex-col gap-1 text-xs text-muted">
      {label}
      <input
        type="number"
        value={Number.isFinite(value) ? Math.round(value * 100) / 100 : 0}
        min={min}
        max={max}
        step={step}
        onChange={(e) => {
          const v = Number(e.target.value);
          if (Number.isFinite(v)) onChange(min !== undefined || max !== undefined ? Math.min(max ?? v, Math.max(min ?? v, v)) : v);
        }}
        className={`${inputClass} text-foreground`}
        data-field={data}
      />
    </label>
  );
}

const gradientCss = (g: Gradient) => `${g.kind === "radial" ? "radial-gradient(circle" : `linear-gradient(${g.angle}deg`}, ${g.stops.map((x) => `${x.color} ${Math.round(x.offset * 100)}%`).join(", ")})`;

// The look of the selected layer (one): geometry, fill, stroke, corners, effects, text.
export function DesignPanel({ node, slide, onNode, onSlide }: { node: SlideNode | null; slide: Slide; onNode: (change: (n: SlideNode) => SlideNode) => void; onSlide: (change: (s: Slide) => Slide) => void }) {
  if (!node) {
    const tr = slide.transition ?? { kind: "none" as const };
    const setTr = (patch: Partial<NonNullable<Slide["transition"]>>) => onSlide((x) => ({ ...x, transition: { duration: 500, easing: "ease", ...(x.transition ?? { kind: "none" }), ...patch } }));
    const T = s.transition;
    return (
      <div className="space-y-3">
        <Section title={s.background}>
          <input type="color" value={slide.background} onChange={(e) => onSlide((x) => ({ ...x, background: e.target.value }))} className={colorClass} aria-label={s.background} />
        </Section>
        <Section title={T.title}>
          <select value={tr.kind} onChange={(e) => setTr({ kind: e.target.value as NonNullable<Slide["transition"]>["kind"] })} className={inputClass} aria-label={T.title} data-transition>
            {(["none", "fade", "slide", "push", "smart"] as const).map((k) => (
              <option key={k} value={k}>
                {T.kinds[k]}
              </option>
            ))}
          </select>
          {(tr.kind === "slide" || tr.kind === "push") && (
            <select value={tr.direction ?? "left"} onChange={(e) => setTr({ direction: e.target.value as "left" })} className={inputClass} aria-label={T.direction}>
              {(["left", "right", "up", "down"] as const).map((k) => (
                <option key={k} value={k}>
                  {T.directions[k]}
                </option>
              ))}
            </select>
          )}
          {tr.kind !== "none" && (
            <>
              <NumberField label={T.duration} value={tr.duration ?? 500} min={100} max={3000} step={50} onChange={(duration) => setTr({ duration })} data="duration" />
              <select value={tr.easing ?? "ease"} onChange={(e) => setTr({ easing: e.target.value as "ease" })} className={inputClass} aria-label={T.easing}>
                {(["linear", "ease", "ease-in", "ease-out", "ease-in-out"] as const).map((k) => (
                  <option key={k} value={k}>
                    {T.easings[k]}
                  </option>
                ))}
              </select>
            </>
          )}
          {tr.kind === "smart" && <p className="text-xs text-muted">{T.smartHint}</p>}
        </Section>
      </div>
    );
  }
  const set = (patch: Partial<SlideNode>) => onNode((n) => ({ ...n, ...patch }));
  const shape = node.type === "RECTANGLE" || node.type === "ELLIPSE" || node.type === "FRAME" || (node.type === "VECTOR" && (!!node.closed || !!node.d));
  const linear = node.type === "LINE" || node.type === "ARROW";
  const radius = node.radius ?? 0;
  const perCorner = Array.isArray(radius);
  const corners: [number, number, number, number] = typeof radius === "number" ? [radius, radius, radius, radius] : radius;
  const fillMode = node.gradient ? node.gradient.kind : node.fill === "none" || !node.fill ? "none" : "solid";

  return (
    <div className="space-y-3">
      <Section title={d.geometry}>
        <div className="grid grid-cols-2 gap-2">
          <NumberField label="X" value={node.x} onChange={(x) => set({ x })} data="x" />
          <NumberField label="Y" value={node.y} onChange={(y) => set({ y })} data="y" />
          <NumberField label={d.width} value={node.width} onChange={(width) => set({ width: linear ? width : Math.max(1, width) })} data="w" />
          <NumberField label={d.height} value={node.height} onChange={(height) => set({ height: linear ? height : Math.max(1, height) })} data="h" />
          <NumberField label={d.rotation} value={node.rotation} min={0} max={359} onChange={(rotation) => set({ rotation })} data="rotation" />
          <NumberField label={d.opacity} value={Math.round((node.opacity ?? 1) * 100)} min={0} max={100} onChange={(v) => set({ opacity: v / 100 })} data="opacity" />
        </div>
      </Section>

      {shape && (
        <Section title={s.fill}>
          <div className="flex flex-wrap gap-1" role="radiogroup" aria-label={s.fill}>
            {(["solid", "linear", "radial", "none"] as const).map((mode) => (
              <button
                key={mode}
                type="button"
                role="radio"
                aria-checked={fillMode === mode}
                className={chip(fillMode === mode)}
                onClick={() =>
                  mode === "none"
                    ? set({ fill: "none", gradient: undefined })
                    : mode === "solid"
                      ? set({ fill: node.fill && node.fill !== "none" ? node.fill : "#60a5fa", gradient: undefined })
                      : set({ gradient: { kind: mode, angle: node.gradient?.angle ?? 135, stops: node.gradient?.stops ?? [{ offset: 0, color: "#6366f1" }, { offset: 1, color: "#ec4899" }] } })
                }
                data-fill-mode={mode}
              >
                {d.fillModes[mode]}
              </button>
            ))}
          </div>
          {fillMode === "solid" && <input type="color" value={node.fill ?? "#60a5fa"} onChange={(e) => set({ fill: e.target.value })} className={colorClass} aria-label={s.fill} data-fill />}
          {node.gradient && (
            <>
              <div className="h-8 rounded-md border border-border" style={{ background: gradientCss(node.gradient) }} />
              <div className="flex flex-wrap gap-2">
                {node.gradient.stops.map((stop, i) => (
                  <input
                    key={i}
                    type="color"
                    value={stop.color}
                    aria-label={d.stop(i + 1)}
                    onChange={(e) => set({ gradient: { ...node.gradient!, stops: node.gradient!.stops.map((x, j) => (j === i ? { ...x, color: e.target.value } : x)) } })}
                    className="h-11 w-11 rounded-md border border-border md:h-9 md:w-9"
                  />
                ))}
                {node.gradient.stops.length < 4 && (
                  <button
                    type="button"
                    className={chip(false)}
                    aria-label={d.addStop}
                    onClick={() => {
                      const stops = [...node.gradient!.stops, { offset: 1, color: "#ffffff" }];
                      set({ gradient: { ...node.gradient!, stops: stops.map((x, j) => ({ ...x, offset: j / (stops.length - 1) })) } });
                    }}
                  >
                    ＋
                  </button>
                )}
                {node.gradient.stops.length > 2 && (
                  <button type="button" className={chip(false)} aria-label={d.removeStop} onClick={() => set({ gradient: { ...node.gradient!, stops: node.gradient!.stops.slice(0, -1).map((x, j, all) => ({ ...x, offset: j / (all.length - 1) })) } })}>
                    −
                  </button>
                )}
              </div>
              {node.gradient.kind === "linear" && <NumberField label={d.angle} value={node.gradient.angle} min={0} max={360} onChange={(angle) => set({ gradient: { ...node.gradient!, angle } })} data="angle" />}
              <p className="text-xs text-muted">{d.brand}</p>
              <div className="grid grid-cols-5 gap-1">
                {BRAND_GRADIENTS.map((b) => (
                  <button
                    key={b.key}
                    type="button"
                    title={b.name}
                    aria-label={b.name}
                    onClick={() => set({ gradient: b.gradient })}
                    className="h-8 rounded-md border border-border"
                    style={{ background: gradientCss(b.gradient) }}
                    data-brand-gradient={b.key}
                  />
                ))}
              </div>
            </>
          )}
        </Section>
      )}

      {node.type !== "TEXT" && node.type !== "EMBED" && (
        <Section title={s.stroke}>
          <div className="grid grid-cols-2 gap-2">
            <input
              type="color"
              value={node.stroke && node.stroke !== "none" ? node.stroke : "#111827"}
              onChange={(e) => set({ stroke: e.target.value, strokeWidth: node.strokeWidth || 4 })}
              className={colorClass}
              aria-label={s.stroke}
            />
            <NumberField label={s.strokeWidth} value={node.strokeWidth ?? 0} min={0} max={200} onChange={(strokeWidth) => set({ strokeWidth, stroke: node.stroke && node.stroke !== "none" ? node.stroke : "#111827" })} data="stroke-width" />
          </div>
          <div className="flex gap-1" role="radiogroup" aria-label={d.dash}>
            {(["solid", "dash", "dot"] as const).map((x) => (
              <button key={x} type="button" role="radio" aria-checked={(node.dash ?? "solid") === x} className={chip((node.dash ?? "solid") === x)} onClick={() => set({ dash: x === "solid" ? undefined : x })}>
                {d.dashes[x]}
              </button>
            ))}
          </div>
        </Section>
      )}

      {node.type === "EMBED" && (
        <Section title={t.slides.embeds.kinds[node.embed?.kind ?? "page"]}>
          <NumberField label={t.slides.embeds.zoom} value={node.zoom ?? 2} min={0.5} max={6} step={0.25} onChange={(zoom) => set({ zoom })} data="zoom" />
          <p className="text-xs text-muted">{t.slides.embeds.editHint}</p>
        </Section>
      )}

      {(node.type === "RECTANGLE" || node.type === "IMAGE" || node.type === "EMBED" || node.type === "FRAME") && (
        <Section title={d.corners}>
          <label className="flex min-h-11 items-center gap-2 text-sm md:min-h-9">
            <input type="checkbox" className="h-5 w-5" checked={perCorner} onChange={(e) => set({ radius: e.target.checked ? corners : corners[0] })} data-per-corner />
            {d.perCorner}
          </label>
          {perCorner ? (
            <div className="grid grid-cols-2 gap-2">
              {d.cornerNames.map((name, i) => (
                <NumberField key={name} label={name} value={corners[i]} min={0} onChange={(v) => set({ radius: corners.map((c, j) => (j === i ? v : c)) as [number, number, number, number] })} data={`corner-${i}`} />
              ))}
            </div>
          ) : (
            <NumberField label={d.radius} value={corners[0]} min={0} onChange={(v) => set({ radius: v })} data="radius" />
          )}
        </Section>
      )}

      <Section title={d.effects}>
        <label className="flex min-h-11 items-center gap-2 text-sm md:min-h-9">
          <input type="checkbox" className="h-5 w-5" checked={!!node.shadow} onChange={(e) => set({ shadow: e.target.checked ? { x: 0, y: 16, blur: 32, color: "#00000055" } : undefined })} data-shadow />
          {d.shadow}
        </label>
        {node.shadow && (
          <div className="grid grid-cols-2 gap-2">
            <NumberField label="X" value={node.shadow.x} onChange={(x) => set({ shadow: { ...node.shadow!, x } })} />
            <NumberField label="Y" value={node.shadow.y} onChange={(y) => set({ shadow: { ...node.shadow!, y } })} />
            <NumberField label={d.blur} value={node.shadow.blur} min={0} max={200} onChange={(blur) => set({ shadow: { ...node.shadow!, blur } })} />
            <label className="flex flex-col gap-1 text-xs text-muted">
              {d.color}
              <input type="color" value={node.shadow.color.slice(0, 7)} onChange={(e) => set({ shadow: { ...node.shadow!, color: `${e.target.value}66` } })} className={colorClass} />
            </label>
          </div>
        )}
        <NumberField label={d.layerBlur} value={node.blur ?? 0} min={0} max={200} onChange={(v) => set({ blur: v > 0 ? v : undefined })} data="blur" />
      </Section>

      {node.type === "TEXT" && (
        <Section title={d.text}>
          <select value={node.fontFamily ?? FONTS[0]} onChange={(e) => set({ fontFamily: e.target.value })} className={inputClass} aria-label={d.font}>
            {FONTS.map((f, i) => (
              <option key={f} value={f}>
                {d.fonts[i]}
              </option>
            ))}
          </select>
          <div className="grid grid-cols-2 gap-2">
            <NumberField label={s.fontSize} value={node.fontSize ?? 64} min={8} max={400} onChange={(fontSize) => set({ fontSize })} data="font-size" />
            <NumberField label={d.lineHeight} value={node.lineHeight ?? 1.2} min={0.6} max={4} step={0.1} onChange={(lineHeight) => set({ lineHeight })} />
          </div>
          <input type="color" value={node.color ?? "#111827"} onChange={(e) => set({ color: e.target.value })} className={colorClass} aria-label={s.textColor} />
          <div className="flex flex-wrap gap-1">
            <button type="button" aria-pressed={!!node.bold} onClick={() => set({ bold: !node.bold })} className={`${chip(!!node.bold)} font-bold`} aria-label={s.bold}>
              B
            </button>
            <button type="button" aria-pressed={!!node.italic} onClick={() => set({ italic: !node.italic })} className={`${chip(!!node.italic)} italic`} aria-label={d.italic}>
              I
            </button>
            <button type="button" aria-pressed={!!node.underline} onClick={() => set({ underline: !node.underline })} className={`${chip(!!node.underline)} underline`} aria-label={d.underline}>
              U
            </button>
            {(["left", "center", "right"] as const).map((a) => (
              <button key={a} type="button" aria-pressed={(node.align ?? "left") === a} onClick={() => set({ align: a })} className={chip((node.align ?? "left") === a)} aria-label={d.aligns[a]}>
                {a === "left" ? "⇤" : a === "center" ? "↔" : "⇥"}
              </button>
            ))}
            {(["top", "middle", "bottom"] as const).map((a) => (
              <button key={a} type="button" aria-pressed={(node.vAlign ?? "top") === a} onClick={() => set({ vAlign: a })} className={chip((node.vAlign ?? "top") === a)} aria-label={d.vAligns[a]}>
                {a === "top" ? "⤒" : a === "middle" ? "↕" : "⤓"}
              </button>
            ))}
          </div>
        </Section>
      )}
    </div>
  );
}
