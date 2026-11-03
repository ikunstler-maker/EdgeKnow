"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { t } from "@/i18n";
import { readSurvey, type SurveyData, type SurveyState } from "@/lib/surveys";
import { workspacePath } from "@/lib/paths";
import type { Person } from "@/lib/tasks";
import { ObjectAccessButton, type ObjectAccess } from "@/components/access/object-access";
import { saveSurvey, setSurveyGroupRole, setSurveyMemberRole, setSurveyWorkspaceRole, surveyState, trashSurvey } from "@/app/survey-actions";
import { SurveyBuilder } from "./survey-builder";
import { SurveyForm } from "./survey-form";
import { SurveyResults } from "./survey-results";
import { SurveySettings } from "./survey-settings";

const s = t.surveys;
type Tab = "build" | "fill" | "results" | "settings";

// One survey: its name and description, then tabs — the questions (editors), the
// form to answer, the answers (those who manage it) and the settings (editors).
// The form is saved about a second after the last change; a save that finds a
// newer version stops and says so.
export function SurveyScreen({
  shortId,
  id,
  initialTitle,
  initialData,
  initialVersion,
  initialState,
  role,
  access,
  members,
}: {
  shortId: string;
  id: string;
  initialTitle: string;
  initialData: unknown;
  initialVersion: number;
  initialState: SurveyState;
  role: string;
  access: ObjectAccess | null;
  members: Person[];
}) {
  const router = useRouter();
  const canEdit = role === "owner" || role === "editor";
  const [tab, setTab] = useState<Tab>(canEdit ? "build" : "fill");
  const [title, setTitle] = useState(initialTitle);
  const [survey, setSurvey] = useState<SurveyData>(() => readSurvey(initialData));
  const [state, setState] = useState(initialState);
  const [status, setStatus] = useState<"idle" | "saving" | "saved" | "conflict" | "error">("idle");
  const [error, setError] = useState<string | null>(null);
  const version = useRef(initialVersion);
  const pending = useRef<{ title: string | null; data: SurveyData | null } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const saving = useRef(false);

  const refreshState = useCallback(async () => {
    const next = await surveyState(shortId, id).catch(() => null);
    if (next) setState(next);
  }, [shortId, id]);

  const flush = useCallback(async () => {
    if (saving.current) return;
    saving.current = true;
    while (pending.current) {
      const next = pending.current;
      pending.current = null;
      setStatus("saving");
      const result = await saveSurvey(shortId, id, next.title, next.data, version.current).catch(() => null);
      if (result?.ok) {
        version.current = result.version;
        setStatus("saved");
        setError(null);
        continue;
      }
      if (result && !result.ok && result.error === "conflict") {
        setStatus("conflict");
        break;
      }
      const later = pending.current as { title: string | null; data: SurveyData | null } | null;
      pending.current = { title: later?.title ?? next.title, data: later?.data ?? next.data };
      setStatus("error");
      setError(result && !result.ok ? (s.errors[result.error] ?? t.common.unknownError) : t.common.unknownError);
      break;
    }
    saving.current = false;
  }, [shortId, id]);

  const schedule = useCallback(
    (patch: { title?: string; data?: SurveyData }) => {
      if (!canEdit || status === "conflict") return;
      pending.current = { title: patch.title ?? pending.current?.title ?? null, data: patch.data ?? pending.current?.data ?? null };
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => void flush(), 900);
    },
    [canEdit, status, flush],
  );

  useEffect(() => {
    const onLeave = (event: BeforeUnloadEvent) => {
      if (pending.current) event.preventDefault();
    };
    window.addEventListener("beforeunload", onLeave);
    return () => window.removeEventListener("beforeunload", onLeave);
  }, []);

  const change = (next: SurveyData) => {
    setSurvey(next);
    schedule({ data: next });
  };
  const tabs: { key: Tab; label: string }[] = [
    ...(canEdit ? [{ key: "build" as Tab, label: s.tabs.build }] : []),
    { key: "fill", label: s.tabs.fill },
    ...(state.manager ? [{ key: "results" as Tab, label: state.count !== null ? `${s.tabs.results} · ${state.count}` : s.tabs.results }] : []),
    ...(canEdit ? [{ key: "settings" as Tab, label: s.tabs.settings }] : []),
  ];

  return (
    <div className="mx-auto mt-2 flex w-full max-w-3xl flex-1 flex-col">
      <div className="flex flex-wrap items-center gap-2">
        {canEdit ? (
          <input
            value={title}
            onChange={(e) => {
              setTitle(e.target.value);
              schedule({ title: e.target.value });
            }}
            placeholder={s.titlePlaceholder}
            aria-label={s.titlePlaceholder}
            maxLength={200}
            className="min-h-11 min-w-0 flex-1 bg-transparent text-2xl font-semibold outline-none"
          />
        ) : (
          <h1 className="min-w-0 flex-1 truncate text-2xl font-semibold">{title || s.untitled}</h1>
        )}
        <span className="text-xs text-muted" role="status" data-save-status={status}>
          {status === "saving" ? s.saving : status === "saved" ? s.saved : ""}
        </span>
        {access && (
          <ObjectAccessButton
            label={s.access}
            title={s.accessTitle}
            intro={s.accessIntro}
            access={access}
            members={members}
            actions={{
              setWorkspaceRole: (r) => setSurveyWorkspaceRole(shortId, id, r),
              setMemberRole: (member, r) => setSurveyMemberRole(shortId, id, member, r),
              setGroupRole: (group, r) => setSurveyGroupRole(shortId, id, group, r),
            }}
          />
        )}
        {canEdit && (
          <button
            type="button"
            onClick={async () => {
              await trashSurvey(shortId, id);
              router.push(workspacePath(shortId, "/surveys"));
            }}
            className="min-h-11 rounded-md border border-border px-3 text-sm hover:bg-surface md:min-h-9"
          >
            🗑️ {s.toBin}
          </button>
        )}
      </div>
      {canEdit ? (
        <textarea
          value={survey.description ?? ""}
          maxLength={4000}
          rows={2}
          placeholder={s.descriptionPlaceholder}
          aria-label={s.descriptionPlaceholder}
          onChange={(e) => change({ ...survey, description: e.target.value || undefined })}
          className="mt-1 w-full resize-y bg-transparent text-sm text-muted outline-none"
        />
      ) : (
        survey.description && <p className="mt-1 whitespace-pre-line text-sm text-muted">{survey.description}</p>
      )}

      {status === "conflict" && (
        <p role="alert" className="mt-2 flex flex-wrap items-center gap-2 rounded-lg border border-danger/40 bg-danger/10 px-3 py-2 text-sm">
          {s.conflict}
          <button type="button" onClick={() => window.location.reload()} className="min-h-9 rounded-md border border-border bg-background px-3">
            {s.reload}
          </button>
        </p>
      )}
      {error && status === "error" && (
        <p role="alert" className="mt-2 text-sm text-danger">
          {error}
        </p>
      )}

      {tabs.length > 1 && (
        <div role="tablist" className="mt-3 flex gap-1 overflow-x-auto border-b border-border">
          {tabs.map((one) => (
            <button
              key={one.key}
              type="button"
              role="tab"
              aria-selected={tab === one.key}
              onClick={() => {
                setTab(one.key);
                if (one.key !== "build") void refreshState();
              }}
              className={`-mb-px min-h-11 whitespace-nowrap border-b-2 px-3 text-sm md:min-h-9 ${tab === one.key ? "border-accent font-medium" : "border-transparent text-muted hover:text-foreground"}`}
            >
              {one.label}
            </button>
          ))}
        </div>
      )}

      <div className="mt-4" role="tabpanel">
        {tab === "build" && canEdit && (
          <>
            <SurveyBuilder survey={survey} onChange={change} hasAnswers={(state.count ?? 0) > 0} />
          </>
        )}
        {tab === "fill" && (
          <>
            {canEdit && <p className="mb-3 text-xs text-muted">{s.form.preview}</p>}
            {/* Opens afresh when the survey starts or stops taking answers, or takes them differently. */}
            <SurveyForm
              key={`${state.closed}|${state.once}|${state.editable}|${state.anonymous}`}
              shortId={shortId}
              id={id}
              survey={survey}
              state={state}
              onSent={() => {
                void refreshState();
              }}
            />
          </>
        )}
        {tab === "results" && state.manager && <SurveyResults shortId={shortId} id={id} survey={survey} canDelete />}
        {tab === "settings" && canEdit && <SurveySettings shortId={shortId} id={id} title={title} state={state} onState={refreshState} />}
      </div>
    </div>
  );
}
