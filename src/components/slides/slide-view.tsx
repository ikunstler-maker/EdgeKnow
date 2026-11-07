"use client";

import { DEFAULT_SIZE, type Embed, type Gradient, type Size, type Slide, type SlideNode } from "@/lib/slides";
import { t } from "@/i18n";
import { SlideEmbed } from "./slide-embed";

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
    case "RECTANGLE": {
      const r = radii(node);
      body = r.every((v) => v === r[0]) ? (
        <rect x={node.x} y={node.y} width={node.width} height={node.height} rx={r[0]} fill={fill} {...strokeProps} {...common} />
      ) : (
        <path d={roundedPath(node.x, node.y, node.width, node.height, r)} fill={fill} {...strokeProps} {...common} />
      );
      break;
    }
    case "ELLIPSE":
      body = <ellipse cx={cx} cy={cy} rx={node.width / 2} ry={node.height / 2} fill={fill} {...strokeProps} {...common} />;
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
              {t.slides.embeds.icons[node.embed?.kind ?? "page"]}
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
