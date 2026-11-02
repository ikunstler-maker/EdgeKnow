// Board templates (step Д3a): ready layouts of frames, headings and sticky
// notes, put where the board is looked at. Plain data; the canvas turns it into
// Excalidraw elements.

import { STICKY_COLORS } from "./boards";

export type TemplateKey = "retro" | "brainstorm" | "journey" | "swot" | "kanban" | "grid";
export const TEMPLATE_KEYS: TemplateKey[] = ["retro", "brainstorm", "journey", "swot", "kanban", "grid"];

export type TemplatePart =
  | { kind: "frame"; x: number; y: number; width: number; height: number; name: string }
  | { kind: "sticky"; x: number; y: number; color: keyof typeof STICKY_COLORS; text: string }
  | { kind: "topic"; x: number; y: number; text: string }
  | { kind: "label"; x: number; y: number; text: string };

export type TemplateTexts = {
  retro: [string, string, string];
  brainstorm: { topic: string; idea: string };
  journey: { stages: [string, string, string, string, string]; rows: [string, string, string, string] };
  swot: [string, string, string, string];
  kanban: [string, string, string];
};

const columns = (names: string[], width: number, height: number, gap = 40): TemplatePart[] =>
  names.map((name, i) => ({ kind: "frame", x: i * (width + gap), y: 0, width, height, name }));

// The parts, with the board's top left at 0,0 (the canvas shifts them to the view).
export function templateParts(key: TemplateKey, texts: TemplateTexts): TemplatePart[] {
  switch (key) {
    case "retro":
      return [
        ...columns(texts.retro, 420, 640),
        { kind: "sticky", x: 30, y: 60, color: "green", text: "" },
        { kind: "sticky", x: 490, y: 60, color: "pink", text: "" },
        { kind: "sticky", x: 950, y: 60, color: "blue", text: "" },
      ];
    case "brainstorm": {
      const around: [number, number][] = [[-320, -260], [80, -320], [480, -260], [-320, 160], [80, 220], [480, 160]];
      return [
        { kind: "topic", x: 0, y: 0, text: texts.brainstorm.topic },
        ...around.map(([x, y], i): TemplatePart => ({ kind: "sticky", x, y, color: (["yellow", "pink", "green", "blue"] as const)[i % 4], text: "" })),
      ];
    }
    case "journey":
      return [
        ...texts.journey.rows.map((text, i): TemplatePart => ({ kind: "label", x: -200, y: 80 + i * 150, text })),
        ...columns(texts.journey.stages, 300, 640, 24),
      ];
    case "swot":
      return [
        { kind: "frame", x: 0, y: 0, width: 520, height: 420, name: texts.swot[0] },
        { kind: "frame", x: 560, y: 0, width: 520, height: 420, name: texts.swot[1] },
        { kind: "frame", x: 0, y: 460, width: 520, height: 420, name: texts.swot[2] },
        { kind: "frame", x: 560, y: 460, width: 520, height: 420, name: texts.swot[3] },
      ];
    case "kanban":
      return [...columns(texts.kanban, 360, 720), { kind: "sticky", x: 80, y: 60, color: "yellow", text: "" }];
    case "grid":
      return [];
  }
}
