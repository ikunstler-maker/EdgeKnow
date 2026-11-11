"use client";

import { DEFAULT_SIZE, type Embed, type Gradient, type Paint, type PathPoint, type Size, type Slide, type SlideNode } from "@/lib/slides";
import { SlideEmbed } from "./slide-embed";
import { Icon } from "@/components/ui/icon";
import { EMBED_ICON } from "@/components/slides/tool-icons";

// How embeds are drawn: a light stand-in (thumbnails), live (show, print), or live and
// set up by the editor.
export type EmbedMode = "placeholder" | "view" | "live" | "setup";

// Draws a slide (the editor's canvas, thumbnails and, later, the player use the same).
export const imageUrl = (shortId: string, imageId: string) => `/api/boards/files/${imageId}?ws=${shortId}`;

// Ids inside one SVG must be unique; the prefix keeps canvas and thumbnails apart.
const gid = (prefix: string, node: SlideNode) => `${prefix}g-${node.id}`;
const fid = (prefix: string, node: SlideNode) => `${prefix}f-${node.id}`;

function GradientDef({ id, gradient }: { id: string; gradient: Gradient }) {
  const stops = gradient.stops.map((s, i) => <stop key={i} offset={s.offset} stopColor={s.color} />);
  if (gradient.kind === "radial") return <radialGradient id={id}>{stops}</radialGradient>;
  // CSS-like angle: 0° points up, 90° to the right, 135° to the bottom right.
  const a = ((gradient.angle - 90) * Math.PI) / 180;
  const x = Math.cos(a) / 2;
  const y = Math.sin(a) / 2;
  return (
    <linearGradient id={id} x1={0.5 - x} y1={0.5 - y} x2={0.5 + x} y2={0.5 + y}>
      {stops}
    </linearGradient>
  );
}

export function NodeDefs({ node, prefix }: { node: SlideNode; prefix: string }) {
  if (!node.gradient && !node.shadow && !node.blur) return null;
  return (
    <defs>
      {node.gradient && <GradientDef id={gid(prefix, node)} gradient={node.gradient} />}
      {(node.shadow || node.blur) && (
        <filter id={fid(prefix, node)} x="-50%" y="-50%" width="200%" height="200%">
          {node.blur ? <feGaussianBlur in="SourceGraphic" stdDeviation={node.blur / 2} result="blurred" /> : null}
          {node.shadow && <feDropShadow dx={node.shadow.x} dy={node.shadow.y} stdDeviation={node.shadow.blur / 2} floodColor={node.shadow.color} in={node.blur ? "blurred" : "SourceGraphic"} />}
        </filter>
      )}
    </defs>
  );
}

const radii = (node: SlideNode): [number, number, number, number] => {
  const r = node.radius ?? 0;
  const list = typeof r === "number" ? [r, r, r, r] : r;
  const max = Math.min(Math.abs(node.width), Math.abs(node.height)) / 2;
  return list.map((v) => Math.min(max, Math.max(0, v))) as [number, number, number, number];
};

function roundedPath(x: number, y: number, w: number, h: number, [tl, tr, br, bl]: [number, number, number, number]) {
  return `M${x + tl},${y} H${x + w - tr} A${tr},${tr} 0 0 1 ${x + w},${y + tr} V${y + h - br} A${br},${br} 0 0 1 ${x + w - br},${y + h} H${x + bl} A${bl},${bl} 0 0 1 ${x},${y + h - bl} V${y + tl} A${tl},${tl} 0 0 1 ${x + tl},${y} Z`;
}

const dashArray = (node: SlideNode) => {
  const w = node.strokeWidth ?? 4;
  return node.dash === "dash" ? `${w * 3} ${w * 2}` : node.dash === "dot" ? `0 ${w * 2}` : undefined;
};

// A pen path through points with handles (absolute coordinates).
export function pointsPath(points: PathPoint[], closed?: boolean): string {
  if (!points.length) return "";
  const seg = (a: PathPoint, b: PathPoint) => `C${a.outX ?? a.x},${a.outY ?? a.y} ${b.inX ?? b.x},${b.inY ?? b.y} ${b.x},${b.y}`;
  let d = `M${points[0].x},${points[0].y}`;
  for (let i = 1; i < points.length; i++) d += ` ${seg(points[i - 1], points[i])}`;
  if (closed && points.length > 2) d += ` ${seg(points[points.length - 1], points[0])} Z`;
  return d;
}

// The outline of a filled layer, as one SVG element with the given paint.
function outline(node: SlideNode, paint: string, extra: Record<string, unknown>) {
  const cx = node.x + node.width / 2;
  const cy = node.y + node.height / 2;
  if (node.type === "ELLIPSE") return <ellipse cx={cx} cy={cy} rx={node.width / 2} ry={node.height / 2} fill={paint} {...extra} />;
  if (node.type === "VECTOR") {
    if (node.d) return <path d={node.d} transform={`translate(${node.x} ${node.y}) scale(${node.width / (node.dW ?? 1)} ${node.height / (node.dH ?? 1)})`} fill={paint} vectorEffect="non-scaling-stroke" {...extra} />;
    return <path d={pointsPath(node.points ?? [], node.closed)} fill={node.closed ? paint : "none"} strokeLinecap="round" strokeLinejoin="round" {...extra} />;
  }
  const r = radii(node);
  return r.every((v) => v === r[0]) ? <rect x={node.x} y={node.y} width={node.width} height={node.height} rx={r[0]} fill={paint} {...extra} /> : <path d={roundedPath(node.x, node.y, node.width, node.height, r)} fill={paint} {...extra} />;
}

function PaintDefs({ node, prefix, shortId }: { node: SlideNode; prefix: string; shortId: string }) {
  return (
    <defs>
      {(node.fills ?? []).map((f, i) =>
        f.kind === "linear" || f.kind === "radial" ? (
          <GradientDef key={i} id={`${prefix}pf${i}-${node.id}`} gradient={f} />
        ) : f.kind === "image" ? (
          <pattern key={i} id={`${prefix}pf${i}-${node.id}`} patternUnits={f.fit === "tile" ? "userSpaceOnUse" : "objectBoundingBox"} width={f.fit === "tile" ? 200 : 1} height={f.fit === "tile" ? 200 : 1} x={f.fit === "tile" ? node.x : 0} y={f.fit === "tile" ? node.y : 0}>
            <image href={imageUrl(shortId, f.imageId)} width={f.fit === "tile" ? 200 : node.width} height={f.fit === "tile" ? 200 : node.height} preserveAspectRatio={f.fit === "fit" ? "xMidYMid meet" : "xMidYMid slice"} />
          </pattern>
        ) : null,
      )}
      {node.innerShadow && (
        <filter id={`${prefix}is-${node.id}`} x="-50%" y="-50%" width="200%" height="200%">
          <feComponentTransfer in="SourceAlpha">
            <feFuncA type="table" tableValues="1 0" />
          </feComponentTransfer>
          <feGaussianBlur stdDeviation={node.innerShadow.blur / 2} />
          <feOffset dx={node.innerShadow.x} dy={node.innerShadow.y} result="offset" />
          <feFlood floodColor={node.innerShadow.color} />
          <feComposite in2="offset" operator="in" />
          <feComposite in2="SourceAlpha" operator="in" result="inner" />
          <feMerge>
            <feMergeNode in="SourceGraphic" />
            <feMergeNode in="inner" />
          </feMerge>
        </filter>
      )}
    </defs>
  );
}

const paintRef = (prefix: string, node: SlideNode, i: number, f: Paint) => (f.kind === "solid" ? f.color : `url(#${prefix}pf${i}-${node.id})`);

export function NodeShape({ node, shortId, editingText, prefix = "", embeds = "placeholder", onEmbed }: { node: SlideNode; shortId: string; editingText?: boolean; prefix?: string; embeds?: EmbedMode; onEmbed?: (embed: Embed) => void }) {
  const cx = node.x + node.width / 2;
  const cy = node.y + node.height / 2;
  const transform = node.rotation ? `rotate(${node.rotation} ${cx} ${cy})` : undefined;
  const stroke = node.stroke && node.stroke !== "none" ? node.stroke : undefined;
  const fill = node.gradient ? `url(#${gid(prefix, node)})` : node.fill && node.fill !== "none" ? node.fill : "none";
  const filter = node.shadow || node.blur ? `url(#${fid(prefix, node)})` : undefined;
  const common = { opacity: node.opacity ?? 1, filter, transform };
  const strokeProps = { stroke, strokeWidth: stroke ? node.strokeWidth : 0, strokeDasharray: stroke ? dashArray(node) : undefined, strokeLinecap: node.dash === "dot" ? ("round" as const) : undefined };
  let body: React.ReactNode;
  switch (node.type) {
    case "RECTANGLE":
    case "ELLIPSE":
    case "FRAME":
    case "VECTOR": {
      const extraStroke = (node.strokes ?? []).filter((x) => !x.hidden);
      body = (
        <g {...common}>
          <PaintDefs node={node} prefix={prefix} shortId={shortId} />
          {node.bgBlur ? (
            <foreignObject x={node.x} y={node.y} width={node.width} height={node.height}>
              <div style={{ width: "100%", height: "100%", backdropFilter: `blur(${node.bgBlur}px)`, WebkitBackdropFilter: `blur(${node.bgBlur}px)`, borderRadius: radii(node)[0] }} />
            </foreignObject>
          ) : null}
          <g filter={node.innerShadow ? `url(#${prefix}is-${node.id})` : undefined}>
            {outline(node, fill, node.fills?.length || extraStroke.length ? {} : strokeProps)}
            {(node.fills ?? []).map((f, i) => (f.hidden ? null : <g key={i} opacity={f.opacity ?? 1}>{outline(node, paintRef(prefix, node, i, f), {})}</g>))}
          </g>
          {(node.fills?.length || extraStroke.length) && stroke ? outline(node, "none", strokeProps) : null}
          {extraStroke.map((st, i) => (
            <g key={`s${i}`}>{outline(node, "none", { stroke: st.color, strokeWidth: st.width, strokeDasharray: st.dash === "dash" ? `${st.width * 3} ${st.width * 2}` : st.dash === "dot" ? `0 ${st.width * 2}` : undefined, strokeLinecap: st.dash === "dot" ? "round" : undefined })}</g>
          ))}
        </g>
      );
      break;
    }
    case "GROUP":
      body = null;
      break;
    case "LINE":
    case "ARROW": {
      const x2 = node.x + node.width;
      const y2 = node.y + node.height;
      const w = node.strokeWidth ?? 8;
      const angle = Math.atan2(node.height, node.width);
      const head = Math.max(24, w * 4);
      const a1 = angle + Math.PI - 0.45;
      const a2 = angle + Math.PI + 0.45;
      const color = node.stroke ?? "#111827";
      body = (
        <g {...common}>
          <line x1={node.x} y1={node.y} x2={x2} y2={y2} stroke={color} strokeWidth={w} strokeLinecap="round" strokeDasharray={dashArray(node)} />
          {node.type === "ARROW" && (
            <polyline
              points={`${x2 + head * Math.cos(a1)},${y2 + head * Math.sin(a1)} ${x2},${y2} ${x2 + head * Math.cos(a2)},${y2 + head * Math.sin(a2)}`}
              fill="none"
              stroke={color}
              strokeWidth={w}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          )}
        </g>
      );
      break;
    }
    case "IMAGE": {
      const r = radii(node);
      const clip = r.some((v) => v > 0) ? `${prefix}c-${node.id}` : undefined;
      body = node.imageId ? (
        <g {...common}>
          {clip && (
            <defs>
              <clipPath id={clip}>
                <path d={roundedPath(node.x, node.y, node.width, node.height, r)} />
              </clipPath>
            </defs>
          )}
          <image href={imageUrl(shortId, node.imageId)} x={node.x} y={node.y} width={node.width} height={node.height} preserveAspectRatio="none" clipPath={clip ? `url(#${clip})` : undefined} />
          {stroke && <path d={roundedPath(node.x, node.y, node.width, node.height, r)} fill="none" {...strokeProps} />}
        </g>
      ) : (
        <rect x={node.x} y={node.y} width={node.width} height={node.height} fill="#e5e7eb" {...common} />
      );
      break;
    }
    case "EMBED": {
      const zoom = node.zoom ?? 2;
      const r = radii(node)[0];
      body = (
        <foreignObject x={node.x} y={node.y} width={node.width} height={node.height} {...common}>
          {embeds === "placeholder" || !node.embed ? (
            <div style={{ width: "100%", height: "100%", borderRadius: r, background: node.fill ?? "#ffffff", border: "2px dashed #94a3b8", display: "flex", alignItems: "center", justifyContent: "center", fontSize: Math.min(node.width, node.height) / 5 }}>
              <Icon name={EMBED_ICON[node.embed?.kind ?? "page"] ?? "embed"} size={Math.max(24, Math.min(node.width, node.height) / 5)} />
            </div>
          ) : (
            <div
              style={{ width: node.width / zoom, height: node.height / zoom, transform: `scale(${zoom})`, transformOrigin: "0 0", borderRadius: r / zoom, overflow: "hidden", background: node.fill ?? "#ffffff", pointerEvents: embeds === "live" || embeds === "setup" ? "auto" : "none" }}
              onClick={(ev) => ev.stopPropagation()}
              onPointerDown={(ev) => embeds === "setup" && ev.stopPropagation()}
              className="text-foreground"
              data-slide-embed={node.embed.kind}
            >
              <SlideEmbed embed={node.embed} setup={embeds === "setup"} onEmbed={(next) => onEmbed?.(next)} />
            </div>
          )}
        </foreignObject>
      );
      break;
    }
    case "TEXT":
      body = (
        <foreignObject x={node.x} y={node.y} width={node.width} height={node.height} {...common}>
          {!editingText && (
            <div
              style={{
                width: "100%",
                height: "100%",
                display: "flex",
                flexDirection: "column",
                justifyContent: node.vAlign === "middle" ? "center" : node.vAlign === "bottom" ? "flex-end" : "flex-start",
                fontSize: node.fontSize ?? 64,
                lineHeight: node.lineHeight ?? 1.2,
                color: node.color ?? "#111827",
                fontWeight: node.bold ? 700 : 400,
                fontStyle: node.italic ? "italic" : "normal",
                textDecoration: node.underline ? "underline" : "none",
                textAlign: node.align ?? "left",
                whiteSpace: "pre-wrap",
                overflowWrap: "anywhere",
                fontFamily: node.fontFamily ?? "inherit",
              }}
            >
              <span>{node.text}</span>
            </div>
          )}
        </foreignObject>
      );
      break;
  }
  return (
    <>
      <NodeDefs node={node} prefix={prefix} />
      {body}
    </>
  );
}

export function SlideView({ slide, shortId, className, prefix = "t", size = DEFAULT_SIZE, style, embeds = "placeholder" }: { slide: Slide; shortId: string; className?: string; prefix?: string; size?: Size; style?: React.CSSProperties; embeds?: EmbedMode }) {
  return (
    <svg viewBox={`0 0 ${size.w} ${size.h}`} className={className} style={style} aria-hidden="true">
      <rect x={0} y={0} width={size.w} height={size.h} fill={slide.background} />
      {slide.nodes
        .filter((n) => !n.hidden)
        .map((node) => (
          <NodeShape key={node.id} node={node} shortId={shortId} prefix={`${prefix}${slide.id}-`} embeds={embeds} />
        ))}
    </svg>
  );
}
