"use client";

import { SLIDE_H, SLIDE_W, type Slide, type SlideNode } from "@/lib/slides";

// Draws a slide (the editor's canvas, thumbnails and, later, the player use the same).
export const imageUrl = (shortId: string, imageId: string) => `/api/boards/files/${imageId}?ws=${shortId}`;

export function NodeShape({ node, shortId, editingText }: { node: SlideNode; shortId: string; editingText?: boolean }) {
  const cx = node.x + node.width / 2;
  const cy = node.y + node.height / 2;
  const transform = node.rotation ? `rotate(${node.rotation} ${cx} ${cy})` : undefined;
  const stroke = node.stroke && node.stroke !== "none" ? node.stroke : undefined;
  const fill = node.fill && node.fill !== "none" ? node.fill : "none";
  switch (node.type) {
    case "RECTANGLE":
      return <rect x={node.x} y={node.y} width={node.width} height={node.height} fill={fill} stroke={stroke} strokeWidth={stroke ? node.strokeWidth : 0} transform={transform} />;
    case "ELLIPSE":
      return <ellipse cx={cx} cy={cy} rx={node.width / 2} ry={node.height / 2} fill={fill} stroke={stroke} strokeWidth={stroke ? node.strokeWidth : 0} transform={transform} />;
    case "LINE":
    case "ARROW": {
      const x2 = node.x + node.width;
      const y2 = node.y + node.height;
      const w = node.strokeWidth ?? 8;
      const angle = Math.atan2(node.height, node.width);
      const head = Math.max(24, w * 4);
      const a1 = angle + Math.PI - 0.45;
      const a2 = angle + Math.PI + 0.45;
      return (
        <g transform={transform}>
          <line x1={node.x} y1={node.y} x2={x2} y2={y2} stroke={node.stroke ?? "#111827"} strokeWidth={w} strokeLinecap="round" />
          {node.type === "ARROW" && (
            <polyline
              points={`${x2 + head * Math.cos(a1)},${y2 + head * Math.sin(a1)} ${x2},${y2} ${x2 + head * Math.cos(a2)},${y2 + head * Math.sin(a2)}`}
              fill="none"
              stroke={node.stroke ?? "#111827"}
              strokeWidth={w}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          )}
        </g>
      );
    }
    case "IMAGE":
      return node.imageId ? (
        <image href={imageUrl(shortId, node.imageId)} x={node.x} y={node.y} width={node.width} height={node.height} preserveAspectRatio="none" transform={transform} />
      ) : (
        <rect x={node.x} y={node.y} width={node.width} height={node.height} fill="#e5e7eb" transform={transform} />
      );
    case "TEXT":
      return (
        <foreignObject x={node.x} y={node.y} width={node.width} height={node.height} transform={transform}>
          {!editingText && (
            <div
              style={{
                width: "100%",
                height: "100%",
                fontSize: node.fontSize ?? 64,
                lineHeight: 1.2,
                color: node.color ?? "#111827",
                fontWeight: node.bold ? 700 : 400,
                textAlign: node.align ?? "left",
                whiteSpace: "pre-wrap",
                overflowWrap: "anywhere",
                fontFamily: "inherit",
              }}
            >
              {node.text}
            </div>
          )}
        </foreignObject>
      );
  }
}

export function SlideView({ slide, shortId, className }: { slide: Slide; shortId: string; className?: string }) {
  return (
    <svg viewBox={`0 0 ${SLIDE_W} ${SLIDE_H}`} className={className} aria-hidden="true">
      <rect x={0} y={0} width={SLIDE_W} height={SLIDE_H} fill={slide.background} />
      {slide.nodes.map((node) => (
        <NodeShape key={node.id} node={node} shortId={shortId} />
      ))}
    </svg>
  );
}
