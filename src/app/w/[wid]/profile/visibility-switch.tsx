"use client";

import { useState, useTransition } from "react";
import { t } from "@/i18n";
import { setProfileVisibility } from "@/app/profile-actions";

export function VisibilitySwitch({
  workspaceId,
  initial,
  shareUrl,
}: {
  workspaceId: string;
  initial: "private" | "workspace";
  shareUrl: string;
}) {
  const [value, setValue] = useState(initial);
  const [failed, setFailed] = useState(false);
  const [copied, setCopied] = useState(false);
  const [pending, startTransition] = useTransition();

  const choose = (next: "private" | "workspace") => {
    if (next === value) return;
    const previous = value;
    setValue(next);
    setFailed(false);
    startTransition(async () => {
      const result = await setProfileVisibility(workspaceId, next);
      if (!result.ok) {
        setValue(previous);
        setFailed(true);
      }
    });
  };

  return (
    <section aria-labelledby="profile-visibility" className="mt-6 rounded-lg border border-border p-4">
      <h2 id="profile-visibility" className="font-semibold">{t.profile.visibilityHeading}</h2>
      <div role="radiogroup" aria-label={t.profile.visibilityHeading} className="mt-3 flex flex-col gap-2">
        {(["private", "workspace"] as const).map((option) => (
          <label key={option} className="flex min-h-9 cursor-pointer items-start gap-2">
            <input
              type="radio"
              name="profile-visibility"
              className="mt-1"
              checked={value === option}
              disabled={pending}
              onChange={() => choose(option)}
            />
            <span>
              {t.profile.visibility[option]}
              <span className="block text-sm text-muted">{t.profile.visibilityHint[option]}</span>
            </span>
          </label>
        ))}
      </div>
      {value === "workspace" && (
        <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
          <span className="text-muted">{t.profile.shareLink}</span>
          <code className="break-all rounded bg-surface px-2 py-1">{shareUrl}</code>
          <button
            type="button"
            className="rounded-md border border-border px-2 py-1 hover:bg-surface"
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(shareUrl);
                setCopied(true);
              } catch {
                setCopied(false);
              }
            }}
          >
            {copied ? t.settings.general.copied : t.settings.general.copy}
          </button>
        </div>
      )}
      {failed && <p className="mt-2 text-sm text-red-600" role="alert">{t.profile.saveFailed}</p>}
    </section>
  );
}
