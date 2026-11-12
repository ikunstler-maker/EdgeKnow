"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { t } from "@/i18n";
import { workspacePath } from "@/lib/paths";
import { findTaskByOldKey } from "@/app/task-import-actions";
import { Button, inputClass } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";

// Opens a task by its key or by a link to it in the tracker it came from: after a move
// people still have old keys and links in chats, mail and documents.
export function OldKeyFinder({ shortId }: { shortId: string }) {
  const router = useRouter();
  const [value, setValue] = useState("");
  const [missing, setMissing] = useState(false);
  const [pending, startTransition] = useTransition();
  const f = t.tasks.finder;
  return (
    <form
      className="mt-4"
      role="search"
      aria-label={f.label}
      onSubmit={(e) => {
        e.preventDefault();
        if (!value.trim()) return;
        startTransition(async () => {
          const found = await findTaskByOldKey(shortId, value);
          setMissing(!found);
          if (found) router.push(workspacePath(shortId, `/tasks/${found.projectKey}/${found.number}`));
        });
      }}
      data-task-finder
    >
      <div className="flex gap-2">
        <input value={value} onChange={(e) => (setValue(e.target.value), setMissing(false))} placeholder={f.placeholder} aria-label={f.label} maxLength={600} className={`${inputClass} min-w-0 flex-1`} data-task-finder-input />
        <Button type="submit" disabled={pending || !value.trim()} data-task-finder-open>
          <Icon name="search" />
          <span className="hidden sm:inline">{f.open}</span>
        </Button>
      </div>
      {missing && (
        <p role="status" className="mt-1 text-xs text-muted" data-task-finder-missing>
          {f.missing}
        </p>
      )}
    </form>
  );
}
