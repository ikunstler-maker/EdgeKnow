"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Chart, registerables } from "chart.js";
import { dateLocale, t } from "@/i18n";
import { useResolvedTheme } from "@/lib/use-theme";
import { deleteSurveyResponse, surveyAnswers } from "@/app/survey-actions";
import { allQuestions, answerText, summarize, type QuestionSummary, type SurveyData, type SurveyResponse } from "@/lib/surveys";

Chart.register(...registerables);

const r = t.surveys.results;
const ACCENT = "#3b82f6";
const SHOWN_TEXTS = 8;

// The answers of a survey (those who manage it only — the database decides):
// a chart or a list for every question, then each answer on its own.
export function SurveyResults({
  shortId,
  id,
  survey,
  canDelete,
  summaryOnly = false,
  refreshKey = 0,
}: {
  shortId: string;
  id: string;
  survey: SurveyData;
  canDelete: boolean;
  summaryOnly?: boolean;
  refreshKey?: number;
}) {
  const [responses, setResponses] = useState<SurveyResponse[] | null>(null);
  const [failed, setFailed] = useState(false);
  const load = useCallback(async () => {
    const list = await surveyAnswers(shortId, id).catch(() => null);
    if (list) setResponses(list);
    else setFailed(true);
  }, [shortId, id]);
  useEffect(() => {
    let live = true;
    surveyAnswers(shortId, id)
      .catch(() => null)
      .then((list) => {
        if (!live) return;
        if (list) setResponses(list);
        else setFailed(true);
      });
    return () => {
      live = false;
    };
  }, [shortId, id, refreshKey]);

  if (failed) return <p className="text-sm text-muted">{r.onlyManagers}</p>;
  if (!responses) return <p className="text-sm text-muted">{r.loading}</p>;
  const summaries = summarize(survey, responses);
  const questions = allQuestions(survey);
  const when = (value: string) => new Intl.DateTimeFormat(dateLocale(), { dateStyle: "short", timeStyle: "short" }).format(new Date(value));

  return (
    <div className="flex flex-col gap-4" data-survey-results>
      <div className="flex flex-wrap items-center gap-3">
        <p className="font-medium" data-survey-count={responses.length}>
          {r.count(responses.length)}
        </p>
        <button type="button" onClick={() => void load()} className="min-h-11 rounded-md border border-border px-3 text-sm hover:bg-surface md:min-h-9">
          {r.refresh}
        </button>
      </div>
      {responses.length === 0 ? (
        <p className="text-sm text-muted">{r.none}</p>
      ) : (
        <>
          <section aria-label={r.summary} className="grid gap-3 md:grid-cols-2">
            {summaries.map((summary) => (
              <SummaryCard key={summary.question.id} summary={summary} />
            ))}
          </section>
          {!summaryOnly && (
            <section aria-label={r.people}>
              <h3 className="mb-2 font-semibold">{r.people}</h3>
              <div className="overflow-x-auto rounded-lg border border-border">
                <table className="w-full text-left text-sm" data-survey-table>
                  <thead className="bg-surface/60 text-xs text-muted">
                    <tr>
                      <th className="px-3 py-2 font-medium">{r.when}</th>
                      <th className="px-3 py-2 font-medium">{r.who}</th>
                      {questions.map((q) => (
                        <th key={q.id} className="max-w-48 truncate px-3 py-2 font-medium" title={q.title}>
                          {q.title || t.surveys.untitled}
                        </th>
                      ))}
                      {canDelete && <th className="px-3 py-2" />}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {[...responses].reverse().map((response) => (
                      <tr key={response.id} data-survey-response>
                        <td className="whitespace-nowrap px-3 py-2 text-muted">{when(response.updated_at)}</td>
                        <td className="whitespace-nowrap px-3 py-2">{response.name || response.email || r.anonymous}</td>
                        {questions.map((q) => (
                          <td key={q.id} className="max-w-64 px-3 py-2 align-top">
                            {answerText(q, response.answers?.[q.id])}
                          </td>
                        ))}
                        {canDelete && (
                          <td className="px-3 py-2">
                            <button
                              type="button"
                              onClick={async () => {
                                if (!confirm(r.removeConfirm)) return;
                                const done = await deleteSurveyResponse(shortId, id, response.id);
                                if (done.ok) setResponses((now) => (now ?? []).filter((one) => one.id !== response.id));
                              }}
                              className="min-h-9 rounded-md px-2 text-xs text-danger hover:bg-surface"
                            >
                              {r.remove}
                            </button>
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}
        </>
      )}
    </div>
  );
}

function SummaryCard({ summary }: { summary: QuestionSummary }) {
  const { question } = summary;
  return (
    <div className="rounded-lg border border-border p-3" data-survey-summary={question.title}>
      <p className="font-medium">{question.title || t.surveys.untitled}</p>
      <p className="text-xs text-muted">
        {r.answered(summary.total)}
        {summary.kind === "counts" && summary.average !== undefined && ` · ${r.average(summary.average.toLocaleString(dateLocale()))}`}
      </p>
      {summary.kind === "counts" ? (
        summary.total > 0 && <CountsChart counts={summary.counts} />
      ) : (
        <ul className="mt-2 flex flex-col gap-1 text-sm">
          {summary.texts.slice(0, SHOWN_TEXTS).map((text, i) => (
            <li key={i} className="rounded bg-surface/60 px-2 py-1 whitespace-pre-line">
              {text}
            </li>
          ))}
          {summary.texts.length > SHOWN_TEXTS && <li className="text-xs text-muted">{r.more(summary.texts.length - SHOWN_TEXTS)}</li>}
        </ul>
      )}
    </div>
  );
}

// How many chose each option (Chart.js, MIT), in the table charts' calm colour.
function CountsChart({ counts }: { counts: { label: string; count: number }[] }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const theme = useResolvedTheme();
  const key = JSON.stringify(counts);
  useEffect(() => {
    if (!canvas.current) return;
    const text = theme === "dark" ? "#e5e7eb" : "#374151";
    const grid = theme === "dark" ? "rgba(255,255,255,0.1)" : "rgba(0,0,0,0.08)";
    const list = JSON.parse(key) as { label: string; count: number }[];
    const chart = new Chart(canvas.current, {
      type: "bar",
      data: { labels: list.map((c) => c.label), datasets: [{ data: list.map((c) => c.count), backgroundColor: ACCENT, borderRadius: 4 }] },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: false,
        indexAxis: "y",
        plugins: { legend: { display: false } },
        scales: { x: { beginAtZero: true, ticks: { color: text, precision: 0 }, grid: { color: grid } }, y: { ticks: { color: text }, grid: { display: false } } },
      },
    });
    return () => chart.destroy();
  }, [key, theme]);
  return (
    <div className="mt-2" style={{ height: Math.max(80, counts.length * 28 + 30) }}>
      <canvas ref={canvas} data-chart-canvas />
    </div>
  );
}
