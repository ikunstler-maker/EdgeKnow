import type { IconName } from "@/components/ui/icon";

// Drawn marks for the canvas tools, the kinds of layers and the ways to align,
// shared by the deck editor and the design editor.
export const TOOL_ICON: Record<string, IconName> = {
  select: "cursor",
  hand: "hand",
  FRAME: "frame",
  RECTANGLE: "square",
  ELLIPSE: "circle",
  LINE: "slash",
  ARROW: "arrow-up-right",
  TEXT: "type",
  pen: "pen",
  VECTOR: "pen",
  IMAGE: "image",
  EMBED: "embed",
  GROUP: "group",
};
export const ALIGN_ICON: Record<string, IconName> = {
  left: "align-left",
  centerX: "align-center",
  center: "align-center",
  right: "align-right",
  top: "align-top",
  middle: "align-middle",
  bottom: "align-bottom",
};
