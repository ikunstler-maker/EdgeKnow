"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { t } from "@/i18n";
import { suggestKey } from "@/lib/tasks";
import { workspacePath } from "@/lib/paths";
import { createTaskProject } from "@/app/task-actions";

const inputClass = "min-h-11 rounded-md border border-border bg-background px-3 text-base md:text-sm";

// A new project: a name, a key suggested from it (editable) and an icon.
export function NewProjectForm({ workspaceId, shortId }: { workspaceId: string; shortId: string }) {
  const k = t.tasks;
  const router = useRouter();
  const [name, setName] = useState("");
  const [key, setKey] = useState("");
  const [keyTouched, setKeyTouched] = useState(false);
  const [icon, setIcon] = useState("📋");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const shownKey = keyTouched ? key : name.trim() ? suggestKey(name) : "";

  return (
    <form
      className="mt-8 rounded-lg border border-border p-4"
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
      <h2 className="font-semibold">{k.newProject}</h2>
      <div className="mt-3 grid gap-3 sm:grid-cols-[4rem_1fr_10rem]">
        <label className="flex flex-col gap-1 text-sm">
          {k.projectIcon}
          <input value={icon} onChange={(e) => setIcon(e.target.value)} maxLength={4} className={`${inputClass} text-center`} />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          {k.projectName}
          <input value={name} onChange={(e) => setName(e.target.value)} required maxLength={80} className={inputClass} />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          {k.projectKey}
          <input
            value={shownKey}
            onChange={(e) => {
              setKeyTouched(true);
              setKey(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 10));
            }}
            required
            className={`${inputClass} font-mono uppercase`}
          />
        </label>
      </div>
      <p className="mt-1 text-xs text-muted">{k.projectKeyHint}</p>
      {error && (
        <p role="alert" className="mt-2 text-sm text-danger">
          {error}
        </p>
      )}
      <button type="submit" disabled={pending || !name.trim() || shownKey.length < 2} className="mt-3 min-h-11 rounded-lg bg-accent px-4 text-sm font-medium text-white disabled:opacity-60">
        {k.create}
      </button>
    </form>
  );
}
