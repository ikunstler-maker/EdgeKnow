"use client";

import { useEffect, useState } from "react";
import { t } from "@/i18n";
import { createTaskFromPage, projectsForEmbed, type ChipProject } from "@/app/task-wiki-actions";

const g = t.design;

// Makes a task from the selected text layer in one of the projects the person can edit.
export function TaskFromText({ shortId, title, onDone }: { shortId: string; title: string; onDone: (message: string) => void }) {
  const [projects, setProjects] = useState<ChipProject[] | null>(null);
  const [project, setProject] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let live = true;
    void projectsForEmbed(shortId).then((list) => {
      if (!live) return;
      const editable = list.filter((p) => p.canEdit);
      setProjects(editable);
      setProject((cur) => cur || editable[0]?.id || "");
    });
    return () => {
      live = false;
    };
  }, [shortId]);
  if (!projects?.length) return null;
  return (
    <div className="flex flex-wrap items-center gap-1" data-task-from-text>
      <select value={project} onChange={(e) => setProject(e.target.value)} aria-label={g.toTaskProject} className="min-h-11 min-w-0 flex-1 rounded-md border border-white/10 bg-transparent px-2 text-sm">
        {projects.map((p) => (
          <option key={p.id} value={p.id}>
            {p.icon ? `${p.icon} ` : ""}
            {p.name}
          </option>
        ))}
      </select>
      <button
        type="button"
        disabled={busy || !project || !title.trim()}
        className="min-h-11 rounded-md border border-white/10 px-3 text-sm hover:bg-white/10 disabled:opacity-50"
        onClick={async () => {
          setBusy(true);
          const res = await createTaskFromPage(shortId, project, title, null);
          setBusy(false);
          onDone(res.ok ? g.taskMade(res.key) : t.common.unknownError);
        }}
        data-task-from-text-go
      >
        {g.toTask}
      </button>
    </div>
  );
}
