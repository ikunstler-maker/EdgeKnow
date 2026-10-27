"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { t } from "@/i18n";
import { createWorkspace } from "@/app/workspace-actions";

export function NewWorkspaceForm({ canGoBack }: { canGoBack: boolean }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <form
      className="mt-6 flex flex-col gap-3"
      action={(formData) =>
        startTransition(async () => {
          // Redirects into the new workspace on success.
          const result = await createWorkspace(String(formData.get("name") ?? ""));
          if (!result.ok) setError(t.settings.errors[result.error] ?? t.common.unknownError);
        })
      }
    >
      <label className="flex flex-col gap-1 text-sm">
        {t.newWorkspace.nameLabel}
        <input
          name="name"
          required
          maxLength={80}
          autoFocus
          placeholder={t.newWorkspace.namePlaceholder}
          className="min-h-11 rounded-lg border border-border bg-background px-3 text-base"
        />
      </label>
      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <button
          type="submit"
          disabled={pending}
          className="min-h-11 rounded-lg bg-accent px-4 font-medium text-white hover:opacity-90 disabled:opacity-60"
        >
          {t.newWorkspace.submit}
        </button>
        {canGoBack && (
          <Link href="/" className="inline-flex min-h-11 items-center rounded-lg border border-border px-4 hover:bg-surface">
            {t.newWorkspace.back}
          </Link>
        )}
      </div>
    </form>
  );
}
