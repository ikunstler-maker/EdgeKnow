import type { ServiceKey } from "@/lib/services";

// Each service's mark: a rounded tile in the service's own 135° gradient with a
// block glyph inside. One system for all of them: a 13×13 module grid (5.5 to
// 18.5 of a 24 box), blocks 3 units thick, corners eased by 1.
export type ServiceIconId = ServiceKey | "home";

// x, y, width, height, and optionally opacity.
type Block = [number, number, number, number, number?];

const MARKS: Record<ServiceIconId, { colors: [string, string]; blocks: Block[]; rx?: number }> = {
  home: {
    colors: ["#64748B", "#1E293B"],
    blocks: [[8.5, 5.5, 7, 3], [5.5, 8.5, 13, 3], [5.5, 8.5, 3, 10], [15.5, 8.5, 3, 10], [10.5, 13.5, 3, 5]],
  },
  wiki: {
    colors: ["#2563EB", "#06B6D4"],
    blocks: [[5.5, 5.5, 3, 13], [10.5, 5.5, 8, 3], [10.5, 15.5, 8, 3], [12, 10.5, 3, 3]],
  },
  tasks: {
    colors: ["#059669", "#A3E635"],
    blocks: [[5.5, 11.5, 3, 5], [8.5, 14.5, 4, 4], [12.5, 9.5, 3, 6], [15.5, 5.5, 3, 5], [8.5, 7.5, 3, 3]],
  },
  boards: {
    colors: ["#EC4899", "#FBBF24"],
    blocks: [[5.5, 5.5, 8, 3], [5.5, 5.5, 3, 13], [5.5, 15.5, 13, 3], [15.5, 11.5, 3, 7], [15.5, 5.5, 3, 3]],
  },
  nodes: {
    colors: ["#6D28D9", "#F43F5E"],
    blocks: [
      [5.5, 5.5, 4.5, 3], [5.5, 5.5, 3, 4.5], [14, 5.5, 4.5, 3], [15.5, 5.5, 3, 4.5],
      [5.5, 15.5, 4.5, 3], [5.5, 14, 3, 4.5], [14, 15.5, 4.5, 3], [15.5, 14, 3, 4.5], [10.5, 10.5, 3, 3],
    ],
  },
  sheets: {
    colors: ["#10B981", "#059669"],
    rx: 1.2,
    blocks: [[5.5, 5.5, 5.5, 5.5], [13, 5.5, 5.5, 5.5], [5.5, 13, 5.5, 5.5], [13, 13, 5.5, 5.5, 0.65]],
  },
  slides: {
    colors: ["#EF4444", "#9333EA"],
    blocks: [[5.5, 5.5, 13, 3], [5.5, 15.5, 13, 3], [8.5, 10.5, 7, 3]],
  },
  surveys: {
    colors: ["#2DD4BF", "#0F766E"],
    blocks: [[5.5, 5.5, 13, 3], [5.5, 5.5, 3, 5.5], [15.5, 5.5, 3, 8], [10.5, 10.5, 8, 3], [10.5, 10.5, 3, 4], [10.5, 15.5, 3, 3], [15.5, 15.5, 3, 3]],
  },
  chat: {
    colors: ["#8B5CF6", "#FB7185"],
    blocks: [[5.5, 5.5, 9, 3], [5.5, 5.5, 3, 6], [9.5, 15.5, 9, 3], [15.5, 12.5, 3, 6], [8.5, 10.5, 3, 3], [12.5, 10.5, 3, 3]],
  },
  files: {
    colors: ["#94A3B8", "#334155"],
    blocks: [[5.5, 5.5, 6, 3], [5.5, 8, 13, 3], [5.5, 8, 3, 10.5], [15.5, 8, 3, 10.5], [5.5, 15.5, 13, 3], [10.5, 11.5, 3, 3]],
  },
  calendar: {
    colors: ["#FB923C", "#2563EB"],
    blocks: [[7.5, 4.5, 3, 4], [13.5, 4.5, 3, 4], [5.5, 6.5, 13, 3], [5.5, 6.5, 3, 12], [15.5, 6.5, 3, 12], [5.5, 15.5, 13, 3], [10.5, 11, 3, 3]],
  },
  meet: {
    colors: ["#06B6D4", "#3B82F6"],
    blocks: [[5, 6.5, 9.5, 3], [5, 14.5, 9.5, 3], [5, 6.5, 3, 11], [11.5, 6.5, 3, 11], [8.25, 10.5, 3, 3], [16, 7.5, 3, 3.5], [16, 13, 3, 3.5]],
  },
  ai: {
    colors: ["#F59E0B", "#4F46E5"],
    blocks: [[7, 5.5, 10, 3], [5.5, 7.5, 13, 4.5], [5.5, 13.5, 3, 5], [10.5, 12, 3, 6.5], [15.5, 13.5, 3, 5]],
  },
  sites: {
    colors: ["#A78BFA", "#6D28D9"],
    blocks: [[5.5, 10.5, 3, 8], [15.5, 10.5, 3, 8], [5.5, 15.5, 13, 3], [7.5, 5.5, 3, 3], [13.5, 5.5, 3, 3]],
  },
  apps: {
    colors: ["#FBBF24", "#0D9488"],
    blocks: [[10.5, 4.5, 3, 4], [4.5, 10.5, 4, 3], [6.5, 6.5, 11, 3], [6.5, 6.5, 3, 11], [14.5, 6.5, 3, 11], [6.5, 14.5, 4, 3], [13.5, 14.5, 4, 3]],
  },
  crm: {
    colors: ["#FB7185", "#E11D48"],
    blocks: [[5.5, 5.5, 8, 3], [5.5, 5.5, 3, 8], [5.5, 10.5, 6, 3], [10.5, 15.5, 8, 3], [15.5, 10.5, 3, 8], [12.5, 10.5, 6, 3]],
  },
};

// `mono`: the glyph alone in the text colour, for places where colour would be noise.
export function ServiceIcon({ serviceId, size = 24, muted = false, mono = false, className }: { serviceId: ServiceIconId; size?: number; muted?: boolean; mono?: boolean; className?: string }) {
  const mark = MARKS[serviceId];
  const glyph = (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="currentColor" aria-hidden="true" focusable="false">
      {mark.blocks.map(([x, y, width, height, opacity], index) => (
        <rect key={index} x={x} y={y} width={width} height={height} rx={mark.rx ?? 1} opacity={opacity} />
      ))}
    </svg>
  );
  if (mono) {
    return (
      <span aria-hidden="true" data-service-icon={serviceId} className={`inline-flex shrink-0 text-muted ${className ?? ""}`}>
        {glyph}
      </span>
    );
  }
  return (
    <span
      aria-hidden="true"
      data-service-icon={serviceId}
      style={{
        width: size,
        height: size,
        borderRadius: Math.round(size * 0.25),
        backgroundImage: `linear-gradient(135deg, ${mark.colors[0]}, ${mark.colors[1]})`,
      }}
      className={`inline-flex shrink-0 items-center justify-center text-white shadow-[inset_0_0_0_1px_rgb(255_255_255/0.12),0_1px_2px_rgb(0_0_0/0.25)] ${muted ? "opacity-45 grayscale" : ""} ${className ?? ""}`}
    >
      {glyph}
    </span>
  );
}

// The same mark drawn on a canvas (chips in table cells, UI-2): `size` px square at x, y.
export function drawServiceMark(ctx: CanvasRenderingContext2D, serviceId: ServiceIconId, x: number, y: number, size: number) {
  const mark = MARKS[serviceId];
  const scale = size / 24;
  ctx.save();
  ctx.fillStyle = mark.colors[1];
  for (const [bx, by, width, height, opacity] of mark.blocks) {
    ctx.globalAlpha = opacity ?? 1;
    ctx.fillRect(x + bx * scale, y + by * scale, width * scale, height * scale);
  }
  ctx.restore();
}
