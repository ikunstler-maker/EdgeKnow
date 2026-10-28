"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { usePathname } from "next/navigation";
import { t } from "@/i18n";
import { FEEDBACK_MAX, FEEDBACK_TYPES, type FeedbackType } from "@/lib/feedback";

const f = t.feedback;

// A translucent yellow "!?" button in the corner; the form goes to the owner's sheet.
export function FeedbackButton() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={f.button}
        title={f.button}
        className="ek-feedback-button fixed bottom-4 left-4 z-30 flex h-12 w-12 items-center justify-center rounded-full text-lg font-bold shadow-lg md:left-[17rem]"
      >
        !?
      </button>
      {open && <FeedbackDialog onClose={() => setOpen(false)} />}
    </>
  );
}

function FeedbackDialog({ onClose }: { onClose: () => void }) {
  const pathname = usePathname();
  const [type, setType] = useState<FeedbackType | "">("");
  const [text, setText] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "sent">("idle");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => event.key === "Escape" && onClose();
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  const send = async () => {
    if (!type || !text.trim()) return;
    setState("sending");
    setError(null);
    try {
      const response = await fetch("/api/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type, text, page: pathname }),
      });
      const result = (await response.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      if (result.ok) {
        setState("sent");
        return;
      }
      setError(f.errors[result.error ?? ""] ?? t.common.unknownError);
    } catch {
      setError(t.common.unknownError);
    }
    setState("idle");
  };

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={f.title}
        onClick={(event) => event.stopPropagation()}
        className="w-full max-w-md rounded-t-xl bg-background p-4 pb-[max(1rem,env(safe-area-inset-bottom))] shadow-xl sm:rounded-xl"
      >
        <div className="mb-3 flex items-center">
          <h2 className="flex-1 font-semibold">{f.title}</h2>
          <button type="button" onClick={onClose} aria-label={t.common.close} className="min-h-11 min-w-11">
            ✕
          </button>
        </div>
        {state === "sent" ? (
          <div className="space-y-4">
            <p>{f.thanks}</p>
            <button type="button" onClick={onClose} className="min-h-11 w-full rounded-lg border border-border hover:bg-surface">
              {t.common.close}
            </button>
          </div>
        ) : (
          <form
            className="space-y-3"
            onSubmit={(event) => {
              event.preventDefault();
              void send();
            }}
          >
            <label className="block text-sm">
              {f.type}
              <select
                required
                value={type}
                onChange={(event) => setType(event.target.value as FeedbackType)}
                className="mt-1 min-h-11 w-full rounded-lg border border-border bg-background px-2 text-base"
              >
                <option value="" disabled>
                  {f.chooseType}
                </option>
                {FEEDBACK_TYPES.map((value) => (
                  <option key={value} value={value}>
                    {f.types[value]}
                  </option>
                ))}
              </select>
            </label>
            <label className="block text-sm">
              {f.description}
              <textarea
                required
                rows={5}
                maxLength={FEEDBACK_MAX}
                value={text}
                placeholder={f.placeholder}
                onChange={(event) => setText(event.target.value)}
                className="mt-1 w-full resize-y rounded-lg border border-border bg-background px-3 py-2 text-base"
              />
            </label>
            <p className="text-xs text-muted">{f.note}</p>
            {error && (
              <p role="alert" className="text-sm text-danger">
                {error}
              </p>
            )}
            <button
              type="submit"
              disabled={!type || !text.trim() || state === "sending"}
              className="min-h-11 w-full rounded-lg bg-accent font-medium text-white disabled:opacity-60"
            >
              {state === "sending" ? f.sending : f.send}
            </button>
          </form>
        )}
      </div>
    </div>,
    document.body,
  );
}
