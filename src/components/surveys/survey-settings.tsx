"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { t } from "@/i18n";
import { workspacePath } from "@/lib/paths";
import { linkSurveySheet, setSurveyPublic, setSurveySettings, sheetsToConnect, type SurveySettingsPatch } from "@/app/survey-actions";
import type { SurveyState } from "@/lib/surveys";

const st = t.surveys.settings;
const box = "rounded-xl border border-border p-3 md:p-4";

// "2026-12-01T09:30:00+00:00" → the value of a local datetime-local field, and back.
const toLocalInput = (iso: string | null) => {
  if (!iso) return "";
  const date = new Date(iso);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
};

// How the survey takes answers and the table they go to (its editors; the
// table only for those who see the answers — the database checks both).
export function SurveySettings({
  shortId,
  id,
  title,
  state,
  onState,
}: {
  shortId: string;
  id: string;
  title: string;
  state: SurveyState;
  onState: () => Promise<void> | void;
}) {
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [sheets, setSheets] = useState<{ id: string; title: string }[] | null>(null);
  const [picked, setPicked] = useState("");
  const hasAnswers = (state.count ?? 0) > 0;

  useEffect(() => {
    if (!state.manager) return;
    let live = true;
    sheetsToConnect(shortId).then((list) => live && setSheets(list));
    return () => {
      live = false;
    };
  }, [shortId, state.manager]);

  const save = async (patch: SurveySettingsPatch) => {
    setBusy(true);
    const result = await setSurveySettings(shortId, id, patch).catch(() => null);
    setBusy(false);
    if (!result?.ok) return setError(t.surveys.errors[result && !result.ok ? result.error : "unknown"] ?? t.common.unknownError);
    setError(null);
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
    await onState();
  };

  const link = async (sheet: string | null, disconnect = false) => {
    setBusy(true);
    const result = await linkSurveySheet(shortId, id, sheet, title, disconnect).catch(() => null);
    setBusy(false);
    if (!result?.ok) return setError(t.surveys.errors[result && !result.ok ? result.error : "unknown"] ?? t.common.unknownError);
    setError(null);
    setPicked("");
    await onState();
  };

  const check = (label: string, checked: boolean, onChange: (value: boolean) => void, disabled = false, hint?: string) => (
    <label className={`flex min-h-11 items-start gap-3 py-1 md:min-h-9 ${disabled ? "opacity-60" : "cursor-pointer"}`}>
      <input type="checkbox" checked={checked} disabled={disabled || busy} onChange={(e) => onChange(e.target.checked)} className="mt-1 h-4 w-4" />
      <span>
        <span className="block text-sm">{label}</span>
        {hint && <span className="block text-xs text-muted">{hint}</span>}
      </span>
    </label>
  );

  return (
    <div className="flex flex-col gap-4" data-survey-settings>
      <section className={box}>
        <h3 className="mb-2 font-semibold">{st.answers}</h3>
        {check(st.accepting, state.accepting, (v) => save({ accepting: v }))}
        {check(st.anonymous, state.anonymous, (v) => save({ anonymous: v, ...(v ? { editable: false } : {}) }), hasAnswers, hasAnswers ? st.anonymousLocked : st.anonymousHint)}
        {check(st.once, state.once, (v) => save({ once: v, ...(v ? {} : { editable: false }) }))}
        {check(st.editable, state.editable, (v) => save({ editable: v }), state.anonymous || !state.once, st.editableHint)}
        <div className="mt-2 flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1 text-sm">
            {st.closesAt}
            <input
              type="datetime-local"
              defaultValue={toLocalInput(state.closes_at)}
              key={state.closes_at ?? ""}
              disabled={busy}
              onBlur={(e) => {
                const value = e.target.value ? new Date(e.target.value).toISOString() : null;
                if (value !== (state.closes_at ? new Date(state.closes_at).toISOString() : null)) void save({ closes_at: value });
              }}
              className="min-h-11 rounded-md border border-border bg-background px-2 md:min-h-9"
            />
          </label>
          {state.closes_at && (
            <button type="button" disabled={busy} onClick={() => save({ closes_at: null })} className="min-h-11 rounded-md border border-border px-3 text-sm hover:bg-surface md:min-h-9">
              {st.clearDate}
            </button>
          )}
          <label className="flex flex-col gap-1 text-sm">
            {st.maxResponses}
            <input
              type="number"
              min={1}
              max={10000}
              placeholder={st.noLimit}
              defaultValue={state.max_responses ?? ""}
              key={`max-${state.max_responses ?? ""}`}
              disabled={busy}
              onBlur={(e) => {
                const value = e.target.value ? Math.min(10000, Math.max(1, Math.round(Number(e.target.value)))) : null;
                if (value !== state.max_responses) void save({ max_responses: value });
              }}
              className="min-h-11 w-40 rounded-md border border-border bg-background px-2 md:min-h-9"
            />
          </label>
        </div>
        <p className="mt-2 h-4 text-xs text-muted" role="status">
          {saved ? st.saved : ""}
        </p>
      </section>

      {state.manager && <PublicLink shortId={shortId} id={id} state={state} onState={onState} onError={setError} />}

      {state.manager && (
        <section className={box} data-survey-sheet>
          <h3 className="font-semibold">{st.sheetHeading}</h3>
          <p className="mt-1 text-sm text-muted">{st.sheetIntro}</p>
          {state.sheet ? (
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <span className="text-sm" data-survey-sheet-linked>
                📊 {state.sheet.title !== null ? st.sheetLinked(state.sheet.title || t.sheets.untitled) : st.sheetHidden}
              </span>
              {state.sheet.title !== null && (
                <Link href={workspacePath(shortId, `/sheets/${state.sheet.id}`)} className="min-h-11 rounded-md border border-border px-3 py-2 text-sm hover:bg-surface md:min-h-9 md:py-1.5">
                  {st.openSheet}
                </Link>
              )}
              <button type="button" disabled={busy} onClick={() => confirm(st.disconnectConfirm) && link(null, true)} className="min-h-11 rounded-md border border-border px-3 text-sm hover:bg-surface md:min-h-9">
                {st.disconnect}
              </button>
              {state.sheet.full && (
                <p role="alert" className="w-full text-sm text-danger">
                  {st.sheetFull}
                </p>
              )}
            </div>
          ) : (
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <span className="w-full text-sm text-muted">{st.sheetNone}</span>
              <button type="button" disabled={busy} onClick={() => link(null)} className="min-h-11 rounded-lg bg-accent px-4 text-sm font-medium text-white disabled:opacity-60 md:min-h-9">
                {st.newSheet}
              </button>
              {sheets && sheets.length > 0 && (
                <>
                  <select value={picked} aria-label={st.chooseSheet} onChange={(e) => setPicked(e.target.value)} className="min-h-11 max-w-64 rounded-md border border-border bg-background px-2 text-sm md:min-h-9">
                    <option value="">{st.chooseSheet}</option>
                    {sheets.map((sheet) => (
                      <option key={sheet.id} value={sheet.id}>
                        {sheet.title || t.sheets.untitled}
                      </option>
                    ))}
                  </select>
                  <button type="button" disabled={busy || !picked} onClick={() => link(picked)} className="min-h-11 rounded-md border border-border px-3 text-sm hover:bg-surface disabled:opacity-50 md:min-h-9">
                    {st.connect}
                  </button>
                </>
              )}
            </div>
          )}
          <p className="mt-2 text-xs text-muted">{state.sheet ? st.editingNote : st.connectHint}</p>
        </section>
      )}
      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
    </div>
  );
}

// The link for anyone (step О3): on or off, copied, or replaced by a new one.
function PublicLink({
  shortId,
  id,
  state,
  onState,
  onError,
}: {
  shortId: string;
  id: string;
  state: SurveyState;
  onState: () => Promise<void> | void;
  onError: (message: string | null) => void;
}) {
  const p = t.surveys.public;
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const enabled = state.public?.enabled ?? false;
  const token = state.public?.token ?? null;
  const url = token && typeof window !== "undefined" ? `${window.location.origin}/f/${shortId}/${token}` : "";
  const change = async (on: boolean | null, renew = false) => {
    setBusy(true);
    const result = await setSurveyPublic(shortId, id, on, renew).catch(() => null);
    setBusy(false);
    if (!result?.ok) return onError(t.surveys.errors[result && !result.ok ? result.error : "unknown"] ?? t.common.unknownError);
    onError(null);
    await onState();
  };
  return (
    <section className={box} data-survey-public>
      <h3 className="font-semibold">🌐 {p.heading}</h3>
      <p className="mt-1 text-sm text-muted">{p.intro}</p>
      <label className="mt-3 flex min-h-11 cursor-pointer items-center gap-3 md:min-h-9">
        <input type="checkbox" checked={enabled} disabled={busy} onChange={(e) => change(e.target.checked)} className="h-4 w-4" />
        <span className="text-sm">{p.enable}</span>
      </label>
      {enabled && url && (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <input readOnly value={url} aria-label={p.link} data-survey-public-link onFocus={(e) => e.target.select()} className="min-h-11 min-w-0 flex-1 rounded-md border border-border bg-surface/50 px-3 font-mono text-xs md:min-h-9" />
          <button
            type="button"
            onClick={async () => {
              await navigator.clipboard?.writeText(url).catch(() => {});
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            }}
            className="min-h-11 rounded-md border border-border px-3 text-sm hover:bg-surface md:min-h-9"
          >
            {copied ? p.copied : p.copy}
          </button>
          <button type="button" disabled={busy} onClick={() => confirm(p.renewConfirm) && change(null, true)} className="min-h-11 rounded-md border border-border px-3 text-sm hover:bg-surface md:min-h-9">
            {p.renew}
          </button>
        </div>
      )}
      <p className="mt-3 rounded-md bg-amber-500/10 px-3 py-2 text-xs">⚠️ {p.warning}</p>
      <p className="mt-2 text-xs text-muted">{p.limits}</p>
      <p className="mt-1 text-xs text-muted">{p.robot}</p>
    </section>
  );
}
