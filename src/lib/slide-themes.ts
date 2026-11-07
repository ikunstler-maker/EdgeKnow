// Presentations (step П-2): themes (colours, fonts, background) and slide templates.
import { DEFAULT_SIZE, SLIDE_H, SLIDE_W, fitNodes, newId, type Deck, type Size, type Slide, type SlideNode } from "./slides";
import { SERVICE_BRANDS, type ServiceKey } from "./services";

export type SlideTheme = { id: string; background: string; text: string; muted: string; accent: string; font: string; headingFont: string };

const SANS = "Inter, system-ui, sans-serif";
const SERIF = "Georgia, 'Times New Roman', serif";
const MONO = "ui-monospace, 'JetBrains Mono', monospace";

export const THEMES: SlideTheme[] = [
  { id: "light", background: "#ffffff", text: "#111827", muted: "#6b7280", accent: "#3b82f6", font: SANS, headingFont: SANS },
  { id: "dark", background: "#090B0E", text: "#F3F4F6", muted: "#9CA3AF", accent: "#8B5CF6", font: SANS, headingFont: SANS },
  { id: "paper", background: "#FAF7F0", text: "#292524", muted: "#78716C", accent: "#B45309", font: SERIF, headingFont: SERIF },
  { id: "ocean", background: "#0F2A43", text: "#E0F2FE", muted: "#7DD3FC", accent: "#38BDF8", font: SANS, headingFont: SANS },
  { id: "forest", background: "#F0FDF4", text: "#14532D", muted: "#4D7C0F", accent: "#16A34A", font: SANS, headingFont: SERIF },
  { id: "code", background: "#151922", text: "#E5E7EB", muted: "#94A3B8", accent: "#22D3EE", font: MONO, headingFont: MONO },
];

export const FONTS = [SANS, SERIF, MONO, "'Trebuchet MS', sans-serif", "'Courier New', monospace"];

export const themeOf = (deck: Deck) => THEMES.find((t) => t.id === deck.theme) ?? THEMES[0];

// The 135° brand gradients of the services, as ready fills.
export const BRAND_GRADIENTS = (Object.keys(SERVICE_BRANDS) as ServiceKey[]).map((key) => {
  const colors = SERVICE_BRANDS[key].colors;
  const list = colors.length === 1 ? [colors[0], colors[0]] : colors;
  return { key, name: SERVICE_BRANDS[key].name, gradient: { kind: "linear" as const, angle: 135, stops: list.map((color, i) => ({ offset: i / (list.length - 1), color })) } };
});

// A theme over a whole deck: every slide's background, and text colours and fonts.
export function applyTheme(deck: Deck, theme: SlideTheme): Deck {
  const old = themeOf(deck);
  return {
    ...deck,
    theme: theme.id,
    slides: deck.slides.map((slide) => ({
      ...slide,
      background: theme.background,
      nodes: slide.nodes.map((n) =>
        n.type === "TEXT"
          ? {
              ...n,
              color: !n.color || n.color === old.text ? theme.text : n.color === old.muted ? theme.muted : n.color,
              fontFamily: !n.fontFamily || n.fontFamily === old.font ? theme.font : n.fontFamily === old.headingFont ? theme.headingFont : n.fontFamily,
            }
          : (n.type === "LINE" || n.type === "ARROW") && (!n.stroke || n.stroke === old.text)
            ? { ...n, stroke: theme.text }
            : n,
      ),
    })),
  };
}

export const TEMPLATES = ["blank", "title", "titleText", "twoColumns", "imageCaption"] as const;
export type SlideTemplate = (typeof TEMPLATES)[number];

const text = (theme: SlideTheme, name: string, x: number, y: number, width: number, height: number, value: string, size: number, heading = false, align: "left" | "center" = "left"): SlideNode => ({
  id: newId(),
  type: "TEXT",
  name,
  x,
  y,
  width,
  height,
  rotation: 0,
  text: value,
  fontSize: size,
  color: heading ? theme.text : theme.muted,
  bold: heading,
  align,
  fontFamily: heading ? theme.headingFont : theme.font,
  vAlign: "top",
});

// A new slide of a template, in the deck's theme. `labels` are the placeholder words.
// Templates are drawn for 16:9 and fitted into the deck's own size.
export function templateSlide(template: SlideTemplate, theme: SlideTheme, labels: { title: string; subtitle: string; text: string; caption: string }, size: Size = DEFAULT_SIZE): Slide {
  const M = 120;
  const nodes: SlideNode[] = [];
  if (template === "title") {
    nodes.push(text(theme, labels.title, M, 360, SLIDE_W - 2 * M, 200, labels.title, 120, true, "center"));
    nodes.push(text(theme, labels.subtitle, M, 600, SLIDE_W - 2 * M, 100, labels.subtitle, 48, false, "center"));
  } else if (template === "titleText") {
    nodes.push(text(theme, labels.title, M, 100, SLIDE_W - 2 * M, 160, labels.title, 88, true));
    nodes.push(text(theme, labels.text, M, 300, SLIDE_W - 2 * M, 660, labels.text, 48));
  } else if (template === "twoColumns") {
    nodes.push(text(theme, labels.title, M, 100, SLIDE_W - 2 * M, 160, labels.title, 88, true));
    const w = (SLIDE_W - 2 * M - 80) / 2;
    nodes.push(text(theme, labels.text, M, 300, w, 660, labels.text, 44));
    nodes.push(text(theme, labels.text, M + w + 80, 300, w, 660, labels.text, 44));
  } else if (template === "imageCaption") {
    nodes.push({ id: newId(), type: "RECTANGLE", name: labels.caption, x: M, y: 100, width: SLIDE_W - 2 * M, height: 700, rotation: 0, fill: theme.muted, opacity: 0.25, radius: 24 });
    nodes.push(text(theme, labels.caption, M, 840, SLIDE_W - 2 * M, 120, labels.caption, 44, false, "center"));
  }
  return { id: newId(), background: theme.background, nodes: size.w === SLIDE_W && size.h === SLIDE_H ? nodes : fitNodes(nodes, DEFAULT_SIZE, size) };
}

