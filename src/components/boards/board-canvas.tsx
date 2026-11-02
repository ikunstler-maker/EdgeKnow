"use client";

import "./excalidraw-assets";
import "@excalidraw/excalidraw/index.css";
import { useCallback, useEffect, useRef, useState } from "react";
import { CaptureUpdateAction, Excalidraw, FONT_FAMILY, MainMenu, convertToExcalidrawElements, hashElementsVersion } from "@excalidraw/excalidraw";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import { currentLocale, t } from "@/i18n";
import { useResolvedTheme } from "@/lib/use-theme";
import { STICKY_COLORS, type BoardData, type StickyColor } from "@/lib/boards";
import { useOptionalPages } from "@/components/pages/pages-provider";

const b = t.boards;

// The board's canvas (step Д1): Excalidraw with a clean style by default (no
// sketchy lines, a plain font) and the pencil for freehand; sticky notes are a
// button and the S key. Only real changes of the drawing are reported, not
// zooming or selecting.
export default function BoardCanvas({ initial, editable, onChange }: { initial: BoardData; editable: boolean; onChange: (data: BoardData) => void }) {
  const theme = useResolvedTheme();
  // A guest doesn't take the board away as a picture.
  const canExport = useOptionalPages()?.workspace.role !== "guest";
  const [api, setApi] = useState<ExcalidrawImperativeAPI | null>(null);
  const [color, setColor] = useState<StickyColor>("yellow");
  const box = useRef<HTMLDivElement>(null);
  const last = useRef<string | null>(null);

  const addSticky = useCallback(
    (fill: StickyColor) => {
      if (!api || !editable) return;
      const state = api.getAppState();
      const zoom = state.zoom.value;
      // In the middle of what is on screen, a little shifted for each new one.
      const shift = (api.getSceneElements().filter((e) => e.customData?.sticky).length % 6) * 24;
      const x = -state.scrollX + state.width / 2 / zoom - 100 + shift;
      const y = -state.scrollY + state.height / 2 / zoom - 100 + shift;
      const [note, ...rest] = convertToExcalidrawElements([
        {
          type: "rectangle",
          x,
          y,
          width: 200,
          height: 200,
          backgroundColor: STICKY_COLORS[fill],
          fillStyle: "solid",
          strokeColor: "transparent",
          roughness: 0,
          roundness: { type: 3 },
          customData: { sticky: true },
          label: { text: " ", fontFamily: FONT_FAMILY.Nunito, fontSize: 20, strokeColor: "#1e1e1e" },
        },
      ]);
      api.updateScene({
        elements: [...api.getSceneElementsIncludingDeleted(), note, ...rest],
        appState: { selectedElementIds: { [note.id]: true } },
        captureUpdate: CaptureUpdateAction.IMMEDIATELY,
      });
    },
    [api, editable],
  );

  // S adds a sticky note (unless typing somewhere).
  useEffect(() => {
    const element = box.current;
    if (!element || !editable) return;
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (event.key.toLowerCase() !== "s" || event.ctrlKey || event.metaKey || event.altKey) return;
      if (target?.closest("input, textarea, [contenteditable=true]") || api?.getAppState().editingTextElement) return;
      event.preventDefault();
      event.stopPropagation();
      addSticky(color);
    };
    element.addEventListener("keydown", onKey, true);
    return () => element.removeEventListener("keydown", onKey, true);
  }, [api, addSticky, color, editable]);

  return (
    <div ref={box} className="h-full w-full" data-board-canvas>
      <Excalidraw
        excalidrawAPI={setApi}
        initialData={{
          elements: initial.elements as never,
          appState: {
            viewBackgroundColor: initial.appState.viewBackgroundColor ?? (theme === "dark" ? "#121212" : "#ffffff"),
            currentItemRoughness: 0,
            currentItemFontFamily: FONT_FAMILY.Nunito,
            currentItemRoundness: "round",
          },
          scrollToContent: true,
        }}
        viewModeEnabled={!editable}
        theme={theme === "dark" ? "dark" : "light"}
        langCode={currentLocale() === "en" ? "en" : "uk-UA"}
        aiEnabled={false}
        UIOptions={{
          canvasActions: { loadScene: false, saveToActiveFile: false, export: false, saveAsImage: canExport, toggleTheme: null, clearCanvas: editable, changeViewBackgroundColor: editable },
          // Pictures come with step Д3 (stored in the workspace's one storage).
          tools: { image: false },
        }}
        renderTopRightUI={(isMobile) =>
          editable ? (
            <div className="flex items-center gap-1 rounded-lg border border-border bg-background p-1" role="group" aria-label={b.sticky}>
              {/* On a phone only the current colour fits next to the tools. */}
              {(isMobile ? [color] : (Object.keys(STICKY_COLORS) as StickyColor[])).map((key) => (
                <button
                  key={key}
                  type="button"
                  title={key === color ? b.stickyHint : b.stickyColor(b.stickyColors[key])}
                  aria-label={b.stickyColor(b.stickyColors[key])}
                  aria-pressed={key === color}
                  data-sticky-color={key}
                  onClick={() => {
                    setColor(key);
                    addSticky(key);
                  }}
                  className={`h-8 w-8 rounded ${key === color ? "ring-2 ring-accent" : ""}`}
                  style={{ background: STICKY_COLORS[key] }}
                />
              ))}
            </div>
          ) : null
        }
        onChange={(elements, appState) => {
          if (!editable) return;
          const key = `${hashElementsVersion(elements)}:${appState.viewBackgroundColor}`;
          if (last.current === null) {
            // The first call is the scene as loaded.
            last.current = key;
            return;
          }
          if (key === last.current) return;
          last.current = key;
          onChange({ elements: elements.filter((e) => !e.isDeleted), appState: { viewBackgroundColor: appState.viewBackgroundColor }, files: {} });
        }}
      >
        <MainMenu>
          {canExport && <MainMenu.DefaultItems.SaveAsImage />}
          <MainMenu.DefaultItems.SearchMenu />
          <MainMenu.DefaultItems.Help />
          {editable && <MainMenu.DefaultItems.ClearCanvas />}
          <MainMenu.Separator />
          {editable && <MainMenu.DefaultItems.ChangeCanvasBackground />}
        </MainMenu>
      </Excalidraw>
    </div>
  );
}
