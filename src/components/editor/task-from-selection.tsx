"use client";

import { useState, useTransition } from "react";
import { useBlockNoteEditor, useComponentsContext } from "@blocknote/react";
import { t } from "@/i18n";
import { Popover } from "@/components/ui/popover";
import { createTaskFromPage, projectsForEmbed, type ChipProject } from "@/app/task-wiki-actions";
import type { schema } from "./schema";

const w = t.tasks.wiki;

// "✅" in the formatting toolbar: the selected text becomes a new task, and a
// live chip of it takes the text's place.
export function TaskFromSelectionButton({ shortId, pageId }: { shortId: string; pageId: string }) {
  const editor = useBlockNoteEditor<typeof schema.blockSchema, typeof schema.inlineContentSchema, typeof schema.styleSchema>();
  const Components = useComponentsContext()!;
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const [projects, setProjects] = useState<ChipProject[] | null>(null);
  const [project, setProject] = useState("");
  const [title, setTitle] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  return (
    <>
      <Components.FormattingToolbar.Button
        mainTooltip={w.fromSelection}
        label={w.fromSelection}
        icon={<span aria-hidden="true">✅</span>}
        onClick={(event) => {
          setTitle(editor.getSelectedText().replace(/\s+/g, " ").trim().slice(0, 300));
          setError(null);
          setAnchor(event.currentTarget as HTMLElement);
          projectsForEmbed(shortId).then((list) => {
            const editable = list.filter((p) => p.canEdit);
            setProjects(editable);
            setProject((current) => current || editable[0]?.id || "");
          });
        }}
      />
      {anchor && (
        <Popover anchor={anchor} onClose={() => setAnchor(null)} width={300}>
          <form
            className="space-y-2 p-3 text-sm"
            aria-label={w.fromSelectionTitle}
            onKeyDown={(e) => e.stopPropagation()}
            onSubmit={(e) => {
              e.preventDefault();
              if (!project || !title.trim()) return;
              startTransition(async () => {
                const made = await createTaskFromPage(shortId, project, title, pageId);
                if (!made.ok) return setError(t.tasks.errors[made.error] ?? t.common.unknownError);
                editor.insertInlineContent([{ type: "taskChip", props: { taskId: made.id } }, " "]);
                setAnchor(null);
              });
            }}
          >
            <p className="font-medium">{w.fromSelectionTitle}</p>
            {projects && projects.length === 0 ? (
              <p className="text-muted">{w.noProjects}</p>
            ) : (
              <>
                <label className="block text-xs text-muted">
                  {w.project}
                  <select value={project} onChange={(e) => setProject(e.target.value)} className="mt-1 min-h-9 w-full rounded-md border border-border bg-background px-2 text-base md:text-sm">
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
                <button type="submit" disabled={pending || !project || !title.trim()} className="min-h-9 rounded-md bg-accent px-3 font-medium text-white disabled:opacity-60">
                  {w.create}
                </button>
              </>
            )}
            {error && (
              <p role="alert" className="text-danger">
                {error}
              </p>
            )}
          </form>
        </Popover>
      )}
    </>
  );
}
