"use client";

import "@blocknote/mantine/style.css";
import { useEffect, useRef, useState } from "react";
import { en as blockNoteEn, uk as blockNoteUk } from "@blocknote/core/locales";
import { useCreateBlockNote } from "@blocknote/react";
import { BlockNoteView } from "@blocknote/mantine";
import { currentLocale, t } from "@/i18n";
import { useResolvedTheme } from "@/lib/use-theme";
import { saveTaskDescription } from "@/app/task-actions";

const SAVE_DELAY_MS = 1200;

// A task's description in the same editor as the wiki (the standard blocks),
// saved by itself a moment after typing stops.
export default function TaskDescription({ taskId, initial, editable }: { taskId: string; initial: unknown; editable: boolean }) {
  const theme = useResolvedTheme();
  const [state, setState] = useState<"saved" | "saving" | "dirty" | "error">("saved");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const editor = useCreateBlockNote({
    dictionary: {
      ...(currentLocale() === "en" ? blockNoteEn : blockNoteUk),
      placeholders: { ...(currentLocale() === "en" ? blockNoteEn : blockNoteUk).placeholders, default: t.tasks.descriptionPlaceholder },
    },
    initialContent: Array.isArray(initial) && initial.length ? (initial as never) : undefined,
  });

  const save = async () => {
    setState("saving");
    const result = await saveTaskDescription(taskId, editor.document);
    setState(result.ok ? "saved" : "error");
  };

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  return (
    <div data-task-description>
      <BlockNoteView
        editor={editor}
        editable={editable}
        theme={theme}
        onChange={() => {
          setState("dirty");
          if (timer.current) clearTimeout(timer.current);
          timer.current = setTimeout(() => void save(), SAVE_DELAY_MS);
        }}
      />
      {editable && (
        <p className="mt-1 text-right text-xs text-muted" aria-live="polite">
          {state === "saving" || state === "dirty" ? t.tasks.saving : state === "error" ? t.common.unknownError : t.tasks.saved}
        </p>
      )}
    </div>
  );
}
