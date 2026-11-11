"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { t } from "@/i18n";
import { suggestKey } from "@/lib/tasks";
import { workspacePath } from "@/lib/paths";
import { createTaskProject } from "@/app/task-actions";
import { buttonClass, inputClass } from "@/components/ui/button";


// A new project: a name, a key suggested from it (editable) and, if the person
// wants one, an emoji of their own as its icon.
export function NewProjectForm({ workspaceId, shortId }: { workspaceId: string; shortId: string }) {
  const k = t.tasks;
  const router = useRouter();
  const [name, setName] = useState("");
  const [key, setKey] = useState("");
  const [keyTouched, setKeyTouched] = useState(false);
  const [icon, setIcon] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const shownKey = keyTouched ? key : name.trim() ? suggestKey(name) : "";

  return (
    <form
      className="pt-1"
      aria-label={k.newProject}
      onSubmit={(event) => {
        event.preventDefault();
        startTransition(async () => {
          const result = await createTaskProject(workspaceId, name, shownKey, icon);
          if (!result.ok) return setError(k.errors[result.error] ?? t.common.unknownError);
          router.push(workspacePath(shortId, `/tasks/${result.key}`));
        });
      }}
    >
      <div className="grid gap-3 sm:grid-cols-[4.5rem_1fr_9rem]">
        <label className="flex flex-col gap-1 text-sm text-muted">
          {k.projectIcon}
          <input value={icon} onChange={(e) => setIcon(e.target.value)} maxLength={4} placeholder="—" className={`${inputClass} text-center text-foreground`} />
        </label>
        <label className="flex flex-col gap-1 text-sm text-muted">
          {k.projectName}
          <input value={name} onChange={(e) => setName(e.target.value)} required maxLength={80} autoFocus className={`${inputClass} text-foreground`} />
        </label>
        <label className="flex flex-col gap-1 text-sm text-muted">
          {k.projectKey}
          <input
            value={shownKey}
            onChange={(e) => {
              setKeyTouched(true);
              setKey(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 10));
            }}
            required
            className={`${inputClass} font-mono uppercase text-foreground`}
          />
        </label>
      </div>
      <p className="mt-2 text-xs text-muted">{k.projectKeyHint}</p>
      {error && (
        <p role="alert" className="mt-2 text-sm text-danger">
          {error}
        </p>
      )}
      <button type="submit" disabled={pending || !name.trim() || shownKey.length < 2} className={buttonClass("primary", "mt-4 px-4")}>
        {k.create}
      </button>
    </form>
  );
}
