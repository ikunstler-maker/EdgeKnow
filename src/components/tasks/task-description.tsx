"use client";

import "@blocknote/mantine/style.css";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { en as blockNoteEn, uk as blockNoteUk } from "@blocknote/core/locales";
import { useCreateBlockNote } from "@blocknote/react";
import { BlockNoteView } from "@blocknote/mantine";
import { currentLocale, t } from "@/i18n";
import { useResolvedTheme } from "@/lib/use-theme";
import { prepareImage } from "@/lib/image-compression";
import { saveTaskDescription } from "@/app/task-actions";

// Pictures put into the description (from the computer, dragged in or pasted)
// are stored like the task's other files, in the workspace's one storage, and
// shown from there to whoever sees the task.
async function uploadImage(shortId: string, taskId: string, file: File): Promise<string> {
  let body: Blob = file;
  let type = file.type;
  let name = file.name || "image.png";
  if (!/^image\/(png|jpeg|gif|webp)$/.test(type)) throw new Error(t.tasks.files.errors.invalid_file);
  if (type !== "image/gif") {
    try {
      const prepared = await prepareImage(file, "fullhd");
      body = prepared.blob;
      type = prepared.type;
      name = name.replace(/\.[^.]+$/, "") + (type === "image/webp" ? ".webp" : ".jpg");
    } catch {
      // Sent as it is; the server checks the size.
    }
  }
  const response = await fetch(`/api/tasks/files?ws=${shortId}&task=${taskId}&name=${encodeURIComponent(name)}`, { method: "POST", headers: { "Content-Type": type }, body });
  const result = (await response.json().catch(() => null)) as { ok?: boolean; id?: string; error?: string } | null;
  if (!result?.ok || !result.id) throw new Error(t.tasks.files.errors[result?.error ?? ""] ?? t.common.unknownError);
  return `/api/tasks/files/${result.id}?ws=${shortId}`;
}

const SAVE_DELAY_MS = 1200;

// A task's description in the same editor as the wiki (the standard blocks),
// saved by itself a moment after typing stops.
export default function TaskDescription({ shortId, taskId, initial, editable }: { shortId: string; taskId: string; initial: unknown; editable: boolean }) {
  const router = useRouter();
  const theme = useResolvedTheme();
  const [state, setState] = useState<"saved" | "saving" | "dirty" | "error">("saved");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const editor = useCreateBlockNote({
    dictionary: {
      ...(currentLocale() === "en" ? blockNoteEn : blockNoteUk),
      placeholders: { ...(currentLocale() === "en" ? blockNoteEn : blockNoteUk).placeholders, default: t.tasks.descriptionPlaceholder },
    },
    uploadFile: async (file: File) => {
      const url = await uploadImage(shortId, taskId, file);
      // The picture also shows among the task's files.
      router.refresh();
      return url;
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
