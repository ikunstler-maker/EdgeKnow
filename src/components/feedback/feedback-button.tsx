"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { usePathname } from "next/navigation";
import { t } from "@/i18n";
import { FEEDBACK_MAX, FEEDBACK_TYPES, type FeedbackType } from "@/lib/feedback";
import { useAppearance } from "@/components/angler/appearance";

const f = t.feedback;

// Anything on the site can open the form, e.g. the help page while the lure is hidden.
export const OPEN_FEEDBACK_EVENT = "ek-open-feedback";

// The feedback button is the angler's lure: a glowing orb on a thin curved rod
// rising from the bottom edge, gently swaying. It can be subdued (translucent
// white) or hidden in Profile → Appearance; the form goes to the owner's sheet.
export function FeedbackButton() {
  const { appearance } = useAppearance();
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const show = () => setOpen(true);
    window.addEventListener(OPEN_FEEDBACK_EVENT, show);
    return () => window.removeEventListener(OPEN_FEEDBACK_EVENT, show);
  }, []);
  return (
    <>
      {appearance.lure !== "hidden" && (
        <div
          className={`ek-lure pointer-events-none fixed bottom-0 left-3 z-30 h-28 w-14 md:left-[16.75rem] ${
            appearance.lure === "subtle" ? "ek-lure-subtle" : ""
          }`}
          data-lure={appearance.lure}
        >
          <svg viewBox="0 0 56 112" className="absolute inset-0 h-full w-full" aria-hidden="true">
            <path className="ek-lure-rod" d="M30 112 C 34 88, 14 70, 26 40 C 28 34, 28 30, 28 24" fill="none" strokeWidth="1.6" strokeLinecap="round" />
          </svg>
          <button
            type="button"
            onClick={() => setOpen(true)}
            aria-label={f.button}
            title={f.button}
            className="ek-lure-orb pointer-events-auto absolute left-1/2 top-1 h-10 w-10 -translate-x-1/2 rounded-full"
          />
        </div>
      )}
      {open && <FeedbackDialog onClose={() => setOpen(false)} />}
    </>
  );
}

// The same form from places without the lure (the help page).
export function FeedbackLink() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className="min-h-11 rounded-lg border border-border px-4 text-sm hover:bg-surface">
        {f.button}
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
