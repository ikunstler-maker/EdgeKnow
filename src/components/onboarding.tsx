"use client";

import Link from "next/link";
import { useState, useSyncExternalStore, useTransition } from "react";
import { t } from "@/i18n";
import { addExamplePages } from "@/app/onboarding-actions";
import { errorMessage } from "@/components/pages/pages-provider";

export type OnboardingStep = { key: "database" | "page" | "people" | "drive" | "help"; done: boolean; href: string };

const noop = () => () => {};
const read = (key: string) => {
  try {
    return localStorage.getItem(key) === "1";
  } catch {
    return false;
  }
};

// "First steps" for a new workspace (owner and admins): what is done, what is
// next, and a set of example pages to start from. Hidden for good with "Hide".
export function Onboarding({ workspaceId, shortId, steps, canAddExamples }: { workspaceId: string; shortId: string; steps: OnboardingStep[]; canAddExamples: boolean }) {
  const o = t.onboarding;
  const storageKey = `ek-onboarding-hidden-${workspaceId}`;
  const hiddenStored = useSyncExternalStore(noop, () => read(storageKey), () => false);
  const [hidden, setHidden] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  if (hidden || hiddenStored) return null;
  const done = steps.filter((s) => s.done).length;

  return (
    <section className="mt-8 rounded-lg border border-border p-4" aria-label={o.heading} data-onboarding>
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <h2 className="font-semibold">{o.heading}</h2>
          <p className="text-sm text-muted">{o.progress(done, steps.length)}</p>
        </div>
        <button
          type="button"
          className="min-h-11 rounded-md px-3 text-sm text-muted hover:text-foreground"
          onClick={() => {
            try {
              localStorage.setItem(storageKey, "1");
            } catch {
              // Not remembered; hidden for now anyway.
            }
            setHidden(true);
          }}
        >
          {o.hide}
        </button>
      </div>
      <ol className="mt-3 space-y-2 text-sm">
        {steps.map((step) => (
          <li key={step.key} className="flex items-start gap-2">
            <span aria-hidden>{step.done ? "✅" : "▫️"}</span>
            <span className="min-w-0 flex-1">
              {step.done ? (
                <span className="text-muted line-through">{o.steps[step.key].title}</span>
              ) : (
                <Link href={step.href} className="font-medium underline">
                  {o.steps[step.key].title}
                </Link>
              )}
              {!step.done && <span className="block text-muted">{o.steps[step.key].hint}</span>}
            </span>
          </li>
        ))}
      </ol>
      {canAddExamples && (
        <div className="mt-4 border-t border-border pt-3">
          <p className="text-sm text-muted">{o.examplesHint}</p>
          <button
            type="button"
            disabled={pending}
            className="mt-2 min-h-11 rounded-lg border border-border px-4 text-sm hover:bg-surface disabled:opacity-60"
            onClick={() =>
              startTransition(async () => {
                const result = await addExamplePages(shortId);
                setError(errorMessage(result));
              })
            }
          >
            {pending ? o.adding : o.addExamples}
          </button>
          {error && (
            <p role="alert" className="mt-2 text-sm text-danger">
              {error}
            </p>
          )}
        </div>
      )}
    </section>
  );
}
