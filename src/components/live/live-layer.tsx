"use client";

import type { SlideNode } from "@/lib/slides";
import type { LiveCursor, LivePeer } from "@/lib/live/use-live-doc";

// Inside a canvas SVG (document coordinates): other people's cursors with their names
// and outlines of what they have selected, in their colour. `at` is the slide or page
// shown here; `unit` is one screen pixel in document units.
export function LiveLayer({ cursors, peers, at, nodes, unit }: { cursors: Record<string, LiveCursor>; peers: LivePeer[]; at: string; nodes: SlideNode[]; unit: number }) {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  return (
    <g pointerEvents="none" data-live-layer>
      {peers
        .filter((p) => !p.me && cursors[p.key]?.at === at)
        .map((p) => {
          const c = cursors[p.key];
          const picked = c.sel.map((id) => byId.get(id)).filter((n): n is SlideNode => Boolean(n));
          const label = p.name.length > 24 ? `${p.name.slice(0, 23)}…` : p.name;
          return (
            <g key={p.key} data-live-cursor={p.name}>
              {picked.map((n) => (
                <rect
                  key={n.id}
                  x={Math.min(n.x, n.x + n.width)}
                  y={Math.min(n.y, n.y + n.height)}
                  width={Math.abs(n.width)}
                  height={Math.abs(n.height)}
                  fill="none"
                  stroke={p.color}
                  strokeWidth={2 * unit}
                  strokeDasharray={`${6 * unit} ${3 * unit}`}
                  transform={n.rotation ? `rotate(${n.rotation} ${n.x + n.width / 2} ${n.y + n.height / 2})` : undefined}
                  data-live-selection
                />
              ))}
              {Number.isFinite(c.x) && Number.isFinite(c.y) && (
                <g transform={`translate(${c.x} ${c.y}) scale(${unit})`} style={{ transition: "transform 180ms linear" }}>
                  <path d="M0,0 L0,17 L4.5,13 L7.5,20 L10.5,18.8 L7.6,12 L13,12 Z" fill={p.color} stroke="#fff" strokeWidth={1.2} />
                  <rect x={12} y={18} rx={4} width={label.length * 7 + 12} height={20} fill={p.color} />
                  <text x={18} y={32} fontSize={12} fill="#fff" fontFamily="system-ui, sans-serif">
                    {label}
                  </text>
                </g>
              )}
            </g>
          );
        })}
    </g>
  );
}
