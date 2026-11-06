// Apus (Dekapentapus): the platform's fifteen-legged octopus, drawn in code so it
// weighs almost nothing and moves. Moods change its glowing dot-matrix face and arms.
export type ApusMood = "idle" | "surprised" | "wave" | "kiss" | "hearts" | "love";

const R = 1.9; // dot radius
const S = 4.2; // dot spacing

function dots(points: [number, number][], cx: number, cy: number, r = R, s = S) {
  return points.map(([x, y], i) => <circle key={i} cx={cx + x * s} cy={cy + y * s} r={r} />);
}

const ARC: [number, number][] = [[-3, 1.2], [-2, 0.2], [-1, -0.7], [0, -1.2], [1, -0.7], [2, 0.2], [3, 1.2]];
const RING: [number, number][] = Array.from({ length: 10 }, (_, i) => [Math.cos((i / 10) * 2 * Math.PI) * 2, Math.sin((i / 10) * 2 * Math.PI) * 2]);
const HEART: [number, number][] = [[-2, -1], [-1, -1.6], [0, -0.8], [1, -1.6], [2, -1], [2.2, 0], [1.4, 1], [0.6, 1.8], [0, 2.4], [-0.6, 1.8], [-1.4, 1], [-2.2, 0], [-1, -0.2], [0, 0.6], [1, -0.2], [0, 1.5]];
const SMILE: [number, number][] = [[-2, -0.8], [-1.3, 0.3], [-0.4, 0.8], [0.4, 0.8], [1.3, 0.3], [2, -0.8]];
const O_MOUTH: [number, number][] = Array.from({ length: 6 }, (_, i) => [Math.cos((i / 6) * 2 * Math.PI) * 0.9, Math.sin((i / 6) * 2 * Math.PI) * 1.1]);
const KISS: [number, number][] = [[-0.6, -1.4], [0.2, -0.9], [-0.4, -0.2], [0.2, 0.4], [-0.6, 1]];
const WINK: [number, number][] = [[-3, 0], [-2, 0], [-1, 0], [0, 0], [1, 0], [2, 0], [3, 0]];

function Face({ mood }: { mood: ApusMood }) {
  const left = mood === "surprised" ? dots(RING, 98, 134) : mood === "hearts" ? dots(HEART, 98, 134, 1.6, 3.6) : mood === "kiss" ? dots(WINK, 98, 136) : dots(ARC, 98, 136);
  const right = mood === "surprised" ? dots(RING, 142, 134) : mood === "hearts" ? dots(HEART, 142, 134, 1.6, 3.6) : dots(ARC, 142, 136);
  const mouth = mood === "surprised" ? dots(O_MOUTH, 120, 156, 1.5, 3.2) : mood === "kiss" ? dots(KISS, 122, 154, 1.5, 3.2) : dots(SMILE, 120, 154, 1.6, 3.2);
  return (
    <g className="apus-face" filter="url(#apus-glow)">
      <g className={mood === "idle" || mood === "wave" ? "apus-blink" : undefined}>
        {left}
        {right}
      </g>
      {mouth}
    </g>
  );
}

// A stubby tentacle that ends in a little foot curling outwards, with a sucker.
function leg(x0: number, y0: number, side: number, length: number, fill: string, delay: number, width: number, key: string) {
  const x1 = x0 + side * 4;
  const y1 = y0 + length;
  const tx = x1 + side * 9;
  const ty = y1 - 5;
  return (
    <g key={key} className="apus-leg" style={{ animationDelay: `${delay}s`, transformOrigin: `${x0}px ${y0}px` }}>
      <path d={`M${x0},${y0} L${x1},${y1 - 4} Q${x1},${y1 + 5} ${tx},${ty}`} fill="none" stroke={fill} strokeWidth={width} strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={tx - side} cy={ty + 2} r={4} fill="#ffc6b9" />
      <circle cx={tx - side} cy={ty + 2} r={1.6} fill="#ec8a77" />
    </g>
  );
}

const BACK = Array.from({ length: 7 }, (_, i) => {
  const t = (i + 0.5) / 7;
  return leg(80 + 80 * t, 170, t < 0.5 ? -1 : 1, 16, "url(#apus-leg-b)", -i * 0.17, 14, `b${i}`);
});
const FRONT = Array.from({ length: 8 }, (_, i) => {
  const t = i / 7;
  return leg(74 + 92 * t, 174, t < 0.5 ? -1 : 1, 18 + 5 * Math.sin(Math.PI * t), "url(#apus-leg)", -i * 0.21 - 0.4, 16, `f${i}`);
});

function Arms({ mood }: { mood: ApusMood }) {
  if (mood === "love") {
    // Two arms meet in front of the body in a heart.
    return (
      <g className="apus-love">
        <path d="M86,168 C70,150 92,136 120,158 C148,136 170,150 154,168 C144,180 128,186 120,192 C112,186 96,180 86,168 Z" fill="none" stroke="#c9503d" strokeWidth="17" strokeLinejoin="round" />
        <path d="M86,168 C70,150 92,136 120,158 C148,136 170,150 154,168 C144,180 128,186 120,192 C112,186 96,180 86,168 Z" fill="none" stroke="#ffa08c" strokeWidth="11" strokeLinejoin="round" />
      </g>
    );
  }
  const waving = mood === "wave" || mood === "hearts";
  return (
    <g className={waving ? (mood === "hearts" ? "apus-wave apus-wave-fast" : "apus-wave") : "apus-arm-rest"}>
      <path d="M166,158 C192,156 208,140 206,112" fill="none" stroke="url(#apus-leg)" strokeWidth="18" strokeLinecap="round" />
      <circle cx="210" cy="122" r="3.4" fill="#ffc6b9" />
      <circle cx="209" cy="136" r="3" fill="#ffc6b9" />
    </g>
  );
}

export function ApusFigure({ mood = "idle", className, title }: { mood?: ApusMood; className?: string; title?: string }) {
  return (
    <svg viewBox="25 35 200 180" className={`apus apus-mood-${mood} ${className ?? ""}`} role={title ? "img" : undefined} aria-label={title} aria-hidden={title ? undefined : true}>
      <defs>
        <radialGradient id="apus-head" cx=".36" cy=".3" r=".8">
          <stop offset="0" stopColor="#ffab9b" />
          <stop offset=".55" stopColor="#f6826e" />
          <stop offset="1" stopColor="#de624d" />
        </radialGradient>
        <linearGradient id="apus-leg" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#ec725d" />
          <stop offset="1" stopColor="#ff9d89" />
        </linearGradient>
        <linearGradient id="apus-leg-b" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#cf5945" />
          <stop offset="1" stopColor="#e97964" />
        </linearGradient>
        <linearGradient id="apus-crown" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#b8bcf8" />
          <stop offset="1" stopColor="#8b91e2" />
        </linearGradient>
        <linearGradient id="apus-brim" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#a9aef3" />
          <stop offset="1" stopColor="#7c82d6" />
        </linearGradient>
        <filter id="apus-glow" x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="1.3" result="b" />
          <feMerge>
            <feMergeNode in="b" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>
      <g className="apus-body">
        {BACK}
        {mood !== "love" && <Arms mood={mood} />}
        <ellipse cx="120" cy="134" rx="56" ry="54" fill="url(#apus-head)" />
        {FRONT}
        <ellipse cx="86" cy="152" rx="11" ry="7" fill="#ff6c98" opacity={mood === "kiss" || mood === "hearts" || mood === "love" ? 0.65 : 0.4} />
        <ellipse cx="154" cy="152" rx="11" ry="7" fill="#ff6c98" opacity={mood === "kiss" || mood === "hearts" || mood === "love" ? 0.65 : 0.4} />
        <Face mood={mood} />
        <path d="M68,108 C66,66 90,50 120,50 C150,50 174,66 172,108 Z" fill="url(#apus-crown)" />
        <path d="M44,114 C58,96 182,96 196,114 C202,126 186,130 176,124 C152,112 88,112 64,124 C54,130 38,126 44,114 Z" fill="url(#apus-brim)" />
        <g transform="translate(154,84) rotate(15)">
          <g fill="#fffdf6">
            {Array.from({ length: 9 }, (_, k) => (
              <ellipse key={k} rx="3.6" ry="7" transform={`rotate(${k * 40}) translate(0,-6.5)`} />
            ))}
          </g>
          <circle r="4.3" fill="#f7c63c" />
        </g>
        {mood === "love" && <Arms mood={mood} />}
        {mood === "kiss" && (
          <path className="apus-kiss-heart" d="M196,118 c-3,-6 -11,-3 -8,3 l8,8 l8,-8 c3,-6 -5,-9 -8,-3 z" fill="none" stroke="#5ff3e6" strokeWidth="2.4" filter="url(#apus-glow)" />
        )}
      </g>
    </svg>
  );
}
