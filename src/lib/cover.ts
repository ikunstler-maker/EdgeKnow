// Page covers. The database cleans every cover (see clean_cover); the browser
// checks again before turning one into styles, so only #rrggbb colours and
// plain numbers ever reach CSS.

export type GradientStop = { color: string; at: number };
export type Cover =
  | { type: "color"; color: string }
  | { type: "gradient"; kind: "linear" | "radial"; angle: number; stops: GradientStop[] }
  | { type: "image"; url: string; y: number };

const HEX = /^#[0-9a-f]{6}$/i;
const clamp = (value: unknown, min: number, max: number, fallback: number) =>
  typeof value === "number" && Number.isFinite(value) ? Math.min(max, Math.max(min, Math.round(value))) : fallback;

export function parseCover(raw: unknown): Cover | null {
  if (!raw || typeof raw !== "object") return null;
  const c = raw as Record<string, unknown>;
  if (c.type === "color" && typeof c.color === "string" && HEX.test(c.color)) return { type: "color", color: c.color };
  if (c.type === "gradient" && Array.isArray(c.stops)) {
    const stops = c.stops
      .filter((s): s is GradientStop => typeof s?.color === "string" && HEX.test(s.color) && typeof s.at === "number")
      .map((s) => ({ color: s.color, at: clamp(s.at, 0, 100, 0) }))
      .slice(0, 4);
    if (stops.length < 2) return null;
    return { type: "gradient", kind: c.kind === "radial" ? "radial" : "linear", angle: clamp(c.angle, 0, 359, 90), stops };
  }
  if (c.type === "image" && typeof c.url === "string" && (c.url.startsWith("ek-attachment:") || /^https:\/\/[^\s"'<>()\\]+$/.test(c.url))) {
    return { type: "image", url: c.url, y: clamp(c.y, 0, 100, 50) };
  }
  return null;
}

export function gradientCss(cover: Extract<Cover, { type: "gradient" }>) {
  const stops = [...cover.stops].sort((a, b) => a.at - b.at).map((s) => `${s.color} ${s.at}%`).join(", ");
  return cover.kind === "radial" ? `radial-gradient(circle at center, ${stops})` : `linear-gradient(${cover.angle}deg, ${stops})`;
}

export const COVER_COLORS = ["#f1f1ef", "#e7f3f8", "#edf3ec", "#fbf3db", "#fbecdd", "#fdebec", "#f4f0f7", "#37352f", "#2f6feb", "#0f7b6c"];

export const GRADIENT_PRESETS: Extract<Cover, { type: "gradient" }>[] = [
  { type: "gradient", kind: "linear", angle: 135, stops: [{ color: "#a1c4fd", at: 0 }, { color: "#c2e9fb", at: 100 }] },
  { type: "gradient", kind: "linear", angle: 90, stops: [{ color: "#fbc2eb", at: 0 }, { color: "#a6c1ee", at: 100 }] },
  { type: "gradient", kind: "linear", angle: 120, stops: [{ color: "#f6d365", at: 0 }, { color: "#fda085", at: 100 }] },
  { type: "gradient", kind: "linear", angle: 45, stops: [{ color: "#0f2027", at: 0 }, { color: "#203a43", at: 50 }, { color: "#2c5364", at: 100 }] },
  { type: "gradient", kind: "radial", angle: 0, stops: [{ color: "#fdfbfb", at: 0 }, { color: "#ebedee", at: 100 }] },
  { type: "gradient", kind: "linear", angle: 90, stops: [{ color: "#43e97b", at: 0 }, { color: "#38f9d7", at: 50 }, { color: "#4facfe", at: 75 }, { color: "#a18cd1", at: 100 }] },
];
