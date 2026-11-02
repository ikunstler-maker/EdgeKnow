"use client";

import { useEffect, useState, useTransition } from "react";
import { createPortal } from "react-dom";
import { useBlockNoteEditor, useComponentsContext } from "@blocknote/react";
import { t } from "@/i18n";
import { createTaskFromPage, projectsForEmbed, type ChipProject } from "@/app/task-wiki-actions";
import type { schema } from "./schema";

const w = t.tasks.wiki;
type Editor = typeof schema.BlockNoteEditor;

// "✅" in the formatting toolbar: hands the selected text to the page editor,
// which opens the dialog (the toolbar itself goes away as soon as focus leaves the text).
export function TaskFromSelectionButton({ onOpen }: { onOpen: (title: string) => void }) {
  const editor = useBlockNoteEditor<typeof schema.blockSchema, typeof schema.inlineContentSchema, typeof schema.styleSchema>();
  const Components = useComponentsContext()!;
  return (
    <Components.FormattingToolbar.Button
      mainTooltip={w.fromSelection}
      label={w.fromSelection}
      icon={<span aria-hidden="true">✅</span>}
      onClick={() => onOpen(editor.getSelectedText().replace(/\s+/g, " ").trim().slice(0, 300))}
    />
  );
}

// A new task from the selected text; its live chip takes the text's place.
export function TaskFromSelectionDialog({
  editor,
  shortId,
  pageId,
  initialTitle,
  onClose,
}: {
  editor: Editor;
  shortId: string;
  pageId: string;
  initialTitle: string;
  onClose: () => void;
}) {
  const [projects, setProjects] = useState<ChipProject[] | null>(null);
  const [project, setProject] = useState("");
  const [title, setTitle] = useState(initialTitle);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  // The selection, kept while focus is in the dialog.
  const [selection] = useState(() => editor.prosemirrorState.selection);

  useEffect(() => {
    projectsForEmbed(shortId).then((list) => {
      const editable = list.filter((p) => p.canEdit);
      setProjects(editable);
      setProject((current) => current || editable[0]?.id || "");
    });
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [shortId, onClose]);

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center" onClick={onClose}>
      <form
        role="dialog"
        aria-modal="true"
        aria-label={w.fromSelectionTitle}
        onClick={(e) => e.stopPropagation()}
        onSubmit={(e) => {
          e.preventDefault();
          if (!project || !title.trim()) return;
          startTransition(async () => {
            const made = await createTaskFromPage(shortId, project, title, pageId);
            if (!made.ok) return setError(t.tasks.errors[made.error] ?? t.common.unknownError);
            // Back to the text that was selected: the chip replaces it.
            editor.transact((tr) => tr.setSelection(selection.map(tr.doc, tr.mapping)));
            editor.focus();
            editor.insertInlineContent([{ type: "taskChip", props: { taskId: made.id } }, " "]);
            onClose();
          });
        }}
        className="w-full max-w-md space-y-3 rounded-t-xl bg-background p-4 text-sm shadow-xl sm:rounded-xl"
      >
        <h2 className="font-semibold">{w.fromSelectionTitle}</h2>
        {projects && projects.length === 0 ? (
          <p className="text-muted">{w.noProjects}</p>
        ) : (
          <>
            <label className="block text-xs text-muted">
              {w.project}
              <select value={project} onChange={(e) => setProject(e.target.value)} className="mt-1 min-h-11 w-full rounded-md border border-border bg-background px-2 text-base md:min-h-9 md:text-sm">
                {(projects ?? []).map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.icon ?? "📋"} {p.name} ({p.key})
                  </option>
                ))}
              </select>
            </label>
            <label className="block text-xs text-muted">
              {t.tasks.columns.title}
              <textarea value={title} onChange={(e) => setTitle(e.target.value)} maxLength={300} rows={2} className="mt-1 w-full rounded-md border border-border bg-background px-2 py-1 text-base md:text-sm" />
            </label>
          </>
        )}
        {error && (
          <p role="alert" className="text-danger">
            {error}
          </p>
        )}
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="min-h-11 rounded-md border border-border px-3 hover:bg-surface md:min-h-9">
            {t.common.cancel}
          </button>
          <button type="submit" disabled={pending || !project || !title.trim()} className="min-h-11 rounded-md bg-accent px-3 font-medium text-white disabled:opacity-60 md:min-h-9">
            {w.create}
          </button>
        </div>
      </form>
    </div>,
    document.body,
  );
}
