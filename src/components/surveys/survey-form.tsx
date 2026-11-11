"use client";

import { useMemo, useRef, useState } from "react";
import { t } from "@/i18n";
import { submitSurveyResponse } from "@/app/survey-actions";
import {
  answersOnPath,
  isEmpty,
  MAX_FILES_PER_ANSWER,
  missingIn,
  nextStep,
  type Answer,
  type Answers,
  type Question,
  type SurveyData,
  type SurveyState,
  type SurveyTransport,
} from "@/lib/surveys";
import { FILE_ACCEPT, MAX_FILE_BYTES, uploadSurveyFile } from "./survey-files";
import { Icon } from "@/components/ui/icon";

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
  transport,
  footer,
}: {
  shortId: string;
  id: string;
  survey: SurveyData;
  state: SurveyState;
  onSent?: () => void;
  compact?: boolean;
  // The link for anyone sends through the server instead (and maybe without files).
  transport?: SurveyTransport;
  // Shown above the send button (the "not a robot" check).
  footer?: React.ReactNode;
}) {
  const send = useMemo<SurveyTransport>(
    () =>
      transport ?? {
        submit: async (answers) => (await submitSurveyResponse(shortId, id, answers).catch(() => null)) ?? { ok: false, error: "unknown" },
        upload: (file) => uploadSurveyFile(`/api/surveys/files?ws=${shortId}&survey=${id}`, file),
      },
    [transport, shortId, id],
  );
  const [fileNames, setFileNames] = useState<Record<string, string>>({});
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
    const result = await send.submit(answersOnPath(survey, answers)).catch(() => null);
    setSending(false);
    if (!result?.ok) {
      const code = result && !result.ok ? result.error : "unknown";
      if (code === "required" && result && !result.ok && result.question) setMissing([result.question]);
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
      {/* The link for anyone says it on its own page (it knows who is signed in). */}
      {!transport && <p className="text-xs text-muted">{state.anonymous ? f.anonymous : f.named}</p>}
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
            {question.type === "file" ? (
              <FileInput
                question={question}
                value={answers[question.id]}
                names={fileNames}
                transport={send}
                onAdded={(fileId, name) => {
                  setFileNames((now) => ({ ...now, [fileId]: name }));
                  setAnswers((now) => ({ ...now, [question.id]: [...(Array.isArray(now[question.id]) ? (now[question.id] as string[]) : []), fileId] }));
                  setMissing((now) => now.filter((m) => m !== question.id));
                }}
                onChange={(value) => set(question.id, value)}
              />
            ) : (
              <QuestionInput question={question} value={answers[question.id]} onChange={(value) => set(question.id, value)} />
            )}
          </div>
        </fieldset>
      ))}
      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
      {step === "submit" && footer}
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
              <Icon name="star" />
            </button>
          ))}
        </div>
      );
    }
    case "date":
      return <input type="date" aria-label={question.title} value={typeof value === "string" ? value : ""} onChange={(e) => onChange(e.target.value || undefined)} className={`${field} w-auto`} />;
    case "file":
      return null;
  }
}

// Files for an answer: each is stored right away (in the workspace's one
// storage) and only its id goes with the answer.
function FileInput({
  question,
  value,
  names,
  transport,
  onAdded,
  onChange,
}: {
  question: Question;
  value: Answer | undefined;
  names: Record<string, string>;
  transport: SurveyTransport;
  onAdded: (id: string, name: string) => void;
  onChange: (value: Answer | undefined) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const ids = Array.isArray(value) ? value : [];
  if (!transport.upload) {
    return (
      <p className="rounded-md bg-surface px-3 py-2 text-sm text-muted" data-survey-file-signin>
        {f.fileSignIn}{" "}
        {transport.signInHref && (
          <a href={transport.signInHref} className="text-accent hover:underline">
            {f.signIn}
          </a>
        )}
      </p>
    );
  }
  const upload = transport.upload;
  return (
    <div className="flex flex-col gap-2" data-survey-file-input>
      {ids.length > 0 && (
        <ul className="flex flex-col gap-1 text-sm">
          {ids.map((fileId) => (
            <li key={fileId} className="flex items-center gap-2">
              <Icon name="paperclip" />
              <span className="min-w-0 flex-1 truncate">{names[fileId] ?? fileId}</span>
              <button type="button" onClick={() => onChange(ids.filter((x) => x !== fileId))} aria-label={f.removeFile} title={f.removeFile} className="min-h-9 rounded px-2 text-xs text-muted hover:bg-surface">
                <Icon name="close" />
              </button>
            </li>
          ))}
        </ul>
      )}
      {ids.length < MAX_FILES_PER_ANSWER && (
        <>
          <input
            ref={input}
            type="file"
            accept={FILE_ACCEPT}
            className="hidden"
            aria-label={question.title}
            onChange={async (event) => {
              const file = event.target.files?.[0];
              event.target.value = "";
              if (!file) return;
              if (file.size > MAX_FILE_BYTES) return setProblem(t.surveys.errors.too_large_file);
              setBusy(true);
              setProblem(null);
              const result = await upload(file).catch(() => ({ ok: false as const, error: "upload_failed" }));
              setBusy(false);
              if (result.ok) onAdded(result.id, file.name);
              else setProblem(t.surveys.errors[result.error] ?? t.common.unknownError);
            }}
          />
          <button type="button" disabled={busy} onClick={() => input.current?.click()} className="self-start min-h-11 rounded-md border border-border px-3 text-sm hover:bg-surface disabled:opacity-60 md:min-h-9">
            {busy ? f.uploading : f.addFile}
          </button>
          <p className="text-xs text-muted">{f.fileHint}</p>
        </>
      )}
      {problem && (
        <p role="alert" className="text-sm text-danger">
          {problem}
        </p>
      )}
    </div>
  );
}
