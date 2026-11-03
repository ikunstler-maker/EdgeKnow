"use client";

import { useState } from "react";
import { t } from "@/i18n";
import { submitSurveyResponse } from "@/app/survey-actions";
import { answersOnPath, isEmpty, missingIn, nextStep, type Answer, type Answers, type Question, type SurveyData, type SurveyState } from "@/lib/surveys";

const f = t.surveys.form;
const field = "min-h-11 w-full rounded-md border border-border bg-background px-3 text-base md:min-h-9 md:text-sm";

// Filling a survey in: one section at a time (a choice may skip to another
// section or to the end), required questions checked before going on; the
// database checks it all again.
export function SurveyForm({
  shortId,
  id,
  survey,
  state,
  onSent,
  compact = false,
}: {
  shortId: string;
  id: string;
  survey: SurveyData;
  state: SurveyState;
  onSent?: () => void;
  compact?: boolean;
}) {
  const changeable = state.once && state.editable && !state.anonymous;
  const [answers, setAnswers] = useState<Answers>(() => (changeable && state.mine ? state.mine : {}));
  const [path, setPath] = useState<number[]>([0]);
  const [missing, setMissing] = useState<string[]>([]);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // done: just sent; "answered": answered before and can't answer again.
  const [done, setDone] = useState<"sent" | "edited" | null>(null);

  if (!survey.sections.some((s) => s.questions.length)) return <p className="text-sm text-muted">{f.empty}</p>;
  if (done) {
    return (
      <div className="rounded-lg border border-border bg-surface/50 p-4" role="status" data-survey-done>
        <p className="font-medium">{done === "edited" ? f.edited : f.thanks}</p>
        {(!state.once || changeable) && (
          <button
            type="button"
            onClick={() => {
              setDone(null);
              setPath([0]);
              if (!state.once) setAnswers({});
            }}
            className="mt-3 min-h-11 rounded-md border border-border px-3 text-sm hover:bg-surface md:min-h-9"
          >
            {state.once ? f.change : f.again}
          </button>
        )}
      </div>
    );
  }
  if (state.closed && !(changeable && state.answered)) return <p className="rounded-lg border border-border p-4 text-sm text-muted" data-survey-closed>{f.closed}</p>;
  if (state.once && state.answered && !changeable) {
    return <p className="rounded-lg border border-border p-4 text-sm text-muted" data-survey-answered>{f.alreadyAnswered}</p>;
  }

  const at = path[path.length - 1];
  const section = survey.sections[at];
  const step = nextStep(survey, at, answers);
  const set = (qid: string, value: Answer | undefined) => {
    setAnswers((now) => {
      const next = { ...now };
      if (value === undefined || isEmpty(value)) delete next[qid];
      else next[qid] = value;
      return next;
    });
    setMissing((now) => now.filter((m) => m !== qid));
  };

  const goOn = async () => {
    const lacking = missingIn(section, answers);
    if (lacking.length) {
      setMissing(lacking);
      setError(f.missing);
      return;
    }
    setError(null);
    if (step !== "submit") {
      setPath((now) => [...now, step]);
      return;
    }
    setSending(true);
    const result = await submitSurveyResponse(shortId, id, answersOnPath(survey, answers)).catch(() => null);
    setSending(false);
    if (!result?.ok) {
      const code = result && !result.ok ? result.error : "unknown";
      if (code === "required" && result && "question" in result) setMissing([String((result as { question?: string }).question)]);
      setError(t.surveys.errors[code] ?? t.common.unknownError);
      return;
    }
    setDone(result.edited ? "edited" : "sent");
    onSent?.();
  };

  return (
    <form
      className="flex flex-col gap-4"
      data-survey-form
      onSubmit={(event) => {
        event.preventDefault();
        void goOn();
      }}
    >
      <p className="text-xs text-muted">{state.anonymous ? f.anonymous : f.named}</p>
      {survey.sections.length > 1 && (
        <div>
          <p className="text-xs text-muted">{f.step(at + 1, survey.sections.length)}</p>
          {section.title && <h3 className="mt-1 text-lg font-semibold">{section.title}</h3>}
          {section.description && <p className="mt-1 whitespace-pre-line text-sm text-muted">{section.description}</p>}
        </div>
      )}
      {section.questions.map((question) => (
        <fieldset
          key={question.id}
          data-question={question.title}
          className={`rounded-lg border p-3 ${missing.includes(question.id) ? "border-danger" : "border-border"} ${compact ? "" : "md:p-4"}`}
        >
          <legend className="sr-only">{question.title}</legend>
          <p className="font-medium" aria-hidden="true">
            {question.title || t.surveys.untitled}
            {question.required && (
              <span className="ml-1 text-danger" title={f.requiredMark}>
                *
              </span>
            )}
          </p>
          {question.help && <p className="mt-0.5 text-sm text-muted">{question.help}</p>}
          <div className="mt-2">
            <QuestionInput question={question} value={answers[question.id]} onChange={(value) => set(question.id, value)} />
          </div>
        </fieldset>
      ))}
      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
      <div className="flex flex-wrap items-center gap-2">
        {path.length > 1 && (
          <button type="button" onClick={() => setPath((now) => now.slice(0, -1))} className="min-h-11 rounded-md border border-border px-3 text-sm hover:bg-surface md:min-h-9">
            {f.back}
          </button>
        )}
        <button type="submit" disabled={sending} className="min-h-11 rounded-lg bg-accent px-4 text-sm font-medium text-white disabled:opacity-60 md:min-h-9">
          {sending ? f.sending : step === "submit" ? f.submit : f.next}
        </button>
      </div>
    </form>
  );
}

function QuestionInput({ question, value, onChange }: { question: Question; value: Answer | undefined; onChange: (value: Answer | undefined) => void }) {
  const name = `q-${question.id}`;
  switch (question.type) {
    case "short":
      return <input aria-label={question.title} value={typeof value === "string" ? value : ""} maxLength={500} onChange={(e) => onChange(e.target.value)} className={field} />;
    case "long":
      return (
        <textarea
          aria-label={question.title}
          value={typeof value === "string" ? value : ""}
          maxLength={5000}
          rows={4}
          onChange={(e) => onChange(e.target.value)}
          className="w-full rounded-md border border-border bg-background px-3 py-2 text-base md:text-sm"
        />
      );
    case "single":
      return (
        <div role="radiogroup" aria-label={question.title} className="flex flex-col gap-1">
          {(question.options ?? []).map((option) => (
            <label key={option.label} className="flex min-h-11 cursor-pointer items-center gap-2 rounded-md px-2 hover:bg-surface md:min-h-9">
              <input type="radio" name={name} checked={value === option.label} onChange={() => onChange(option.label)} className="h-4 w-4" />
              <span>{option.label}</span>
            </label>
          ))}
          {!question.required && typeof value === "string" && (
            <button type="button" onClick={() => onChange(undefined)} className="self-start px-2 text-xs text-muted hover:underline">
              {f.clear}
            </button>
          )}
        </div>
      );
    case "multi": {
      const picked = Array.isArray(value) ? value : [];
      return (
        <div role="group" aria-label={question.title} className="flex flex-col gap-1">
          {(question.options ?? []).map((option) => (
            <label key={option.label} className="flex min-h-11 cursor-pointer items-center gap-2 rounded-md px-2 hover:bg-surface md:min-h-9">
              <input
                type="checkbox"
                checked={picked.includes(option.label)}
                onChange={(e) => onChange(e.target.checked ? [...picked, option.label] : picked.filter((p) => p !== option.label))}
                className="h-4 w-4"
              />
              <span>{option.label}</span>
            </label>
          ))}
        </div>
      );
    }
    case "dropdown":
      return (
        <select aria-label={question.title} value={typeof value === "string" ? value : ""} onChange={(e) => onChange(e.target.value || undefined)} className={field}>
          <option value="">{f.choose}</option>
          {(question.options ?? []).map((option) => (
            <option key={option.label} value={option.label}>
              {option.label}
            </option>
          ))}
        </select>
      );
    case "scale": {
      const low = question.min ?? 1;
      const high = question.max ?? 5;
      return (
        <div className="flex flex-wrap items-center gap-2">
          {question.minLabel && <span className="text-sm text-muted">{question.minLabel}</span>}
          <div role="radiogroup" aria-label={question.title} className="flex flex-wrap gap-1">
            {Array.from({ length: high - low + 1 }, (_, i) => low + i).map((n) => (
              <button
                key={n}
                type="button"
                role="radio"
                aria-checked={value === n}
                onClick={() => onChange(value === n && !question.required ? undefined : n)}
                className={`flex h-11 w-11 items-center justify-center rounded-md border text-sm md:h-9 md:w-9 ${value === n ? "border-accent bg-accent text-white" : "border-border hover:bg-surface"}`}
              >
                {n}
              </button>
            ))}
          </div>
          {question.maxLabel && <span className="text-sm text-muted">{question.maxLabel}</span>}
        </div>
      );
    }
    case "rating": {
      const max = question.max ?? 5;
      const current = typeof value === "number" ? value : 0;
      return (
        <div role="radiogroup" aria-label={question.title} className="flex gap-0.5">
          {Array.from({ length: max }, (_, i) => i + 1).map((n) => (
            <button
              key={n}
              type="button"
              role="radio"
              aria-checked={current === n}
              aria-label={f.stars(n, max)}
              title={f.stars(n, max)}
              onClick={() => onChange(current === n && !question.required ? undefined : n)}
              className={`flex h-11 w-11 items-center justify-center rounded-md text-2xl md:h-9 md:w-9 ${n <= current ? "text-amber-500" : "text-muted opacity-40"}`}
            >
              ★
            </button>
          ))}
        </div>
      );
    }
    case "date":
      return <input type="date" aria-label={question.title} value={typeof value === "string" ? value : ""} onChange={(e) => onChange(e.target.value || undefined)} className={`${field} w-auto`} />;
  }
}
