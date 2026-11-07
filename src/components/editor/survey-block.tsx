"use client";

import Link from "next/link";
import { useEffect, useRef, useState, useTransition } from "react";
import { createReactBlockSpec } from "@blocknote/react";
import { t } from "@/i18n";
import { workspacePath } from "@/lib/paths";
import { readSurvey } from "@/lib/surveys";
import { useOptionalPages } from "@/components/pages/pages-provider";
import { createSurvey, surveyView, surveysForEmbed, type SurveySummary, type SurveyView } from "@/app/survey-actions";
import { SurveyForm } from "@/components/surveys/survey-form";
import { SurveyResults } from "@/components/surveys/survey-results";

const e = t.surveys.embed;
// The page editor must not see the form's keys, clipboard or drops.
const ISOLATED = ["keydown", "keyup", "keypress", "paste", "copy", "cut", "drop", "dragover", "dragstart", "beforeinput", "input", "compositionstart", "compositionend"];

// A survey on a wiki page (step О4): its form to fill in right here, or its
// summary with charts (for those who may see the answers). Only the id and the
// view are stored in the page; what shows is read live with the reader's access.
export const surveyBlock = createReactBlockSpec(
  {
    type: "surveyEmbed",
    propSchema: { surveyId: { default: "" }, view: { default: "form" } },
    content: "none",
  },
  {
    meta: { selectable: false },
    render: ({ block, editor }) => (
      <SurveyEmbed
        surveyId={block.props.surveyId}
        view={block.props.view === "summary" ? "summary" : "form"}
        pageEditable={editor.isEditable}
        onPick={(surveyId, view) => editor.updateBlock(block, { props: { surveyId, view } })}
      />
    ),
    toExternalHTML: () => <p>[{e.title}]</p>,
  },
);

export function SurveyEmbed({
  surveyId,
  view: mode,
  pageEditable,
  onPick,
}: {
  surveyId: string;
  view: "form" | "summary";
  pageEditable: boolean;
  onPick: (surveyId: string, view: "form" | "summary") => void;
}) {
  const pages = useOptionalPages();
  const shortId = pages?.workspace.shortId ?? "";
  const [view, setView] = useState<SurveyView | null | undefined>(undefined);
  const [list, setList] = useState<SurveySummary[] | null>(null);
  const [picked, setPicked] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [tick, setTick] = useState(0);
  const box = useRef<HTMLDivElement>(null);

  // Read now, every minute while shown (the summary) and when the tab comes back.
  useEffect(() => {
    if (!shortId || !surveyId) return;
    let alive = true;
    surveyView(shortId, surveyId).then((result) => alive && setView(result));
    const again = () => document.visibilityState === "visible" && setTick((n) => n + 1);
    const poll = mode === "summary" ? setInterval(again, 60_000) : undefined;
    document.addEventListener("visibilitychange", again);
    return () => {
      alive = false;
      clearInterval(poll);
      document.removeEventListener("visibilitychange", again);
    };
  }, [shortId, surveyId, mode, tick]);
  useEffect(() => {
    if (!surveyId && pageEditable && shortId && !list) surveysForEmbed(shortId).then(setList);
  }, [surveyId, pageEditable, shortId, list]);

  useEffect(() => {
    const element = box.current;
    if (!element) return;
    const stop = (event: Event) => event.stopPropagation();
    for (const name of ISOLATED) element.addEventListener(name, stop);
    return () => {
      for (const name of ISOLATED) element.removeEventListener(name, stop);
    };
  }, [view]);

  let body: React.ReactNode;
  if (!surveyId) {
    body = pageEditable ? (
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <select value={picked} onChange={(event) => setPicked(event.target.value)} aria-label={e.choose} className="min-h-9 min-w-0 flex-1 rounded-md border border-border bg-background px-2">
          <option value="">{e.choose}</option>
          {(list ?? []).map((item) => (
            <option key={item.id} value={item.id}>
              📝 {item.title || t.surveys.untitled}
            </option>
          ))}
        </select>
        {picked && (
          <>
            <button type="button" onClick={() => onPick(picked, "form")} className="min-h-9 rounded-md border border-border px-3 hover:bg-surface">
              {e.form}
            </button>
            <button type="button" onClick={() => onPick(picked, "summary")} className="min-h-9 rounded-md border border-border px-3 hover:bg-surface">
              📊 {e.summary}
            </button>
          </>
        )}
        <button
          type="button"
          disabled={pending}
          onClick={() =>
            startTransition(async () => {
              const made = await createSurvey(shortId);
              if (made.ok) onPick(made.id, "form");
              else setNotice(t.surveys.errors[made.error] ?? t.common.unknownError);
            })
          }
          className="min-h-9 rounded-md border border-border px-3 hover:bg-surface"
        >
          {t.surveys.newSurvey}
        </button>
      </div>
    ) : (
      <p className="text-sm text-muted">{e.empty}</p>
    );
  } else if (view === undefined) {
    body = <p className="text-sm text-muted">{e.loading}</p>;
  } else if (view === null) {
    body = <p className="text-sm text-muted">🔒 {e.noAccess}</p>;
  } else {
    const survey = readSurvey(view.data);
    body = (
      <>
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-medium">
            📝 {view.title || t.surveys.untitled}
            {mode === "summary" && ` · ${e.summary}`}
          </span>
          <span className="flex-1" />
          {pageEditable && (
            <button type="button" onClick={() => onPick(view.id, mode === "form" ? "summary" : "form")} className="text-sm text-muted hover:text-foreground hover:underline">
              {mode === "form" ? `📊 ${e.summary}` : e.form}
            </button>
          )}
          <Link href={workspacePath(shortId, `/surveys/${view.id}`)} className="text-sm text-accent hover:underline">
            {e.openEditor} ↗
          </Link>
        </div>
        {survey.description && mode === "form" && <p className="whitespace-pre-line text-sm text-muted">{survey.description}</p>}
        <div ref={box}>
          {mode === "summary" ? (
            view.state.manager ? (
              <SurveyResults shortId={shortId} id={view.id} survey={survey} canDelete={false} summaryOnly refreshKey={tick} />
            ) : (
              <p className="text-sm text-muted">{e.summaryHidden}</p>
            )
          ) : (
            <SurveyForm key={`${view.id}:${view.state.closed}`} shortId={shortId} id={view.id} survey={survey} state={view.state} compact />
          )}
        </div>
      </>
    );
  }

  return (
    <div className="w-full space-y-2 rounded-lg border border-border p-3" contentEditable={false} data-survey-embed={view?.title ?? ""}>
      {body}
      {notice && (
        <p role="status" className="text-sm text-muted">
          {notice}
        </p>
      )}
    </div>
  );
}
