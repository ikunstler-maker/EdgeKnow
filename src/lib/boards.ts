// Boards (step Д1): what is stored of an Excalidraw scene. Only the drawn
// elements, the background and the grid; the rest of the editor's state (zoom, tool,
// selection) stays in the browser.

export type BoardData = { elements: unknown[]; appState: { viewBackgroundColor?: string; gridModeEnabled?: boolean }; files: Record<string, unknown> };

export const EMPTY_BOARD: BoardData = { elements: [], appState: {}, files: {} };

export function readBoard(data: unknown): BoardData {
  const value = (data ?? {}) as Partial<BoardData>;
  return {
    elements: Array.isArray(value.elements) ? value.elements : [],
    appState:
      typeof value.appState === "object" && value.appState
        ? { viewBackgroundColor: value.appState.viewBackgroundColor, ...(value.appState.gridModeEnabled ? { gridModeEnabled: true } : {}) }
        : {},
    files: typeof value.files === "object" && value.files ? value.files : {},
  };
}

// Sticky note colours: soft fills that read well in both themes.
export const STICKY_COLORS = { yellow: "#fff3a3", pink: "#ffc9de", green: "#c3f0c2", blue: "#c7e3ff" } as const;
export type StickyColor = keyof typeof STICKY_COLORS;
