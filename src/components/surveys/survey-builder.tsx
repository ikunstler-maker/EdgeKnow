"use client";

import { t } from "@/i18n";
import { canJump, isChoice, newId, newQuestion, QUESTION_TYPES, type Question, type QuestionType, type Section, type SurveyData } from "@/lib/surveys";

const b = t.surveys.builder;
const input = "min-h-11 w-full rounded-md border border-border bg-background px-3 text-base md:min-h-9 md:text-sm";
const small = "min-h-11 rounded-md border border-border px-2 text-xs hover:bg-surface disabled:opacity-40 md:min-h-8";

// Editing the form: sections, their questions and where each section (or a
// choice) leads. Every change goes up at once; the screen saves it a moment later.
export function SurveyBuilder({ survey, onChange, hasAnswers }: { survey: SurveyData; onChange: (next: SurveyData) => void; hasAnswers: boolean }) {
  const sections = survey.sections;
  const setSection = (index: number, patch: Partial<Section>) => onChange({ ...survey, sections: sections.map((s, i) => (i === index ? { ...s, ...patch } : s)) });
  const setQuestion = (si: number, qi: number, next: Question | null) =>
    setSection(si, { questions: next ? sections[si].questions.map((q, i) => (i === qi ? next : q)) : sections[si].questions.filter((_, i) => i !== qi) });
  const moveQuestion = (si: number, qi: number, by: -1 | 1) => {
    const list = [...sections[si].questions];
    const target = qi + by;
    if (target >= 0 && target < list.length) {
      [list[qi], list[target]] = [list[target], list[qi]];
      return setSection(si, { questions: list });
    }
    // Over the edge of a section: into the one before or after.
    const other = si + by;
    if (other < 0 || other >= sections.length) return;
    const [moved] = list.splice(qi, 1);
    const otherList = by < 0 ? [...sections[other].questions, moved] : [moved, ...sections[other].questions];
    onChange({ ...survey, sections: sections.map((s, i) => (i === si ? { ...s, questions: list } : i === other ? { ...s, questions: otherList } : s)) });
  };
  // Where a section or a choice can lead.
  const targets = (from: number) => [
    { value: "", label: b.goNext },
    ...sections.map((s, i) => ({ value: s.id, label: b.goSection(i + 1, s.title ?? "") })).filter((_, i) => i !== from),
    { value: "submit", label: b.goSubmit },
  ];

  return (
    <div className="flex flex-col gap-4" data-survey-builder>
      {hasAnswers && <p className="rounded-md bg-surface px-3 py-2 text-xs text-muted">{b.hasAnswers}</p>}
      {sections.map((section, si) => (
        <section key={section.id} className="rounded-xl border border-border p-3 md:p-4" data-survey-section={si + 1}>
          {sections.length > 1 && (
            <div className="mb-3 flex flex-col gap-2">
              <div className="flex items-center gap-2">
                <p className="flex-1 text-xs font-medium uppercase tracking-wide text-muted">{b.section(si + 1, sections.length)}</p>
                <button
                  type="button"
                  onClick={() => {
                    if (section.questions.length && !confirm(b.removeSectionConfirm)) return;
                    onChange({ ...survey, sections: sections.filter((_, i) => i !== si) });
                  }}
                  className={`${small} text-danger`}
                >
                  {b.removeSection}
                </button>
              </div>
              <input value={section.title ?? ""} maxLength={300} placeholder={b.sectionTitle} aria-label={b.sectionTitle} onChange={(e) => setSection(si, { title: e.target.value })} className={`${input} font-medium`} />
              <input value={section.description ?? ""} maxLength={2000} placeholder={b.sectionDescription} aria-label={b.sectionDescription} onChange={(e) => setSection(si, { description: e.target.value })} className={input} />
            </div>
          )}

          <div className="flex flex-col gap-3">
            {section.questions.map((question, qi) => (
              <QuestionEditor
                key={question.id}
                question={question}
                targets={targets(si)}
                first={si === 0 && qi === 0}
                last={si === sections.length - 1 && qi === section.questions.length - 1}
                onChange={(next) => setQuestion(si, qi, next)}
                onMove={(by) => moveQuestion(si, qi, by)}
                onDuplicate={() =>
                  setSection(si, { questions: [...section.questions.slice(0, qi + 1), { ...question, id: newId(), options: question.options?.map((o) => ({ ...o })) }, ...section.questions.slice(qi + 1)] })
                }
              />
            ))}
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button type="button" onClick={() => setSection(si, { questions: [...section.questions, newQuestion("single", b.optionN)] })} className="min-h-11 rounded-md border border-border px-3 text-sm hover:bg-surface md:min-h-9">
              {b.addQuestion}
            </button>
            {sections.length > 1 && (
              <label className="ml-auto flex items-center gap-2 text-sm">
                <span className="text-muted">{b.afterSection}</span>
                <select value={section.next ?? ""} onChange={(e) => setSection(si, { next: e.target.value || undefined })} className="min-h-11 rounded-md border border-border bg-background px-2 text-sm md:min-h-9">
                  {targets(si).map((target) => (
                    <option key={target.value} value={target.value}>
                      {target.label}
                    </option>
                  ))}
                </select>
              </label>
            )}
          </div>
        </section>
      ))}
      <button
        type="button"
        onClick={() => onChange({ ...survey, sections: [...sections, { id: newId(), questions: [newQuestion("single", b.optionN)] }] })}
        className="self-start min-h-11 rounded-md border border-dashed border-border px-3 text-sm hover:bg-surface md:min-h-9"
      >
        {b.addSection}
      </button>
    </div>
  );
}

function QuestionEditor({
  question,
  targets,
  first,
  last,
  onChange,
  onMove,
  onDuplicate,
}: {
  question: Question;
  targets: { value: string; label: string }[];
  first: boolean;
  last: boolean;
  onChange: (next: Question | null) => void;
  onMove: (by: -1 | 1) => void;
  onDuplicate: () => void;
}) {
  const set = (patch: Partial<Question>) => onChange({ ...question, ...patch });
  const changeType = (type: QuestionType) => {
    const fresh = newQuestion(type, b.optionN);
    // Choices are kept when switching between kinds of choice.
    onChange({ ...fresh, id: question.id, title: question.title, help: question.help, required: question.required, ...(isChoice(type) && question.options?.length ? { options: question.options.map((o) => (canJump(type) ? o : { label: o.label })) } : {}), type });
  };
  const options = question.options ?? [];
  const labels = options.map((o) => o.label.trim());
  return (
    <div className="rounded-lg border border-border bg-background p-3" data-question-editor>
      <div className="flex flex-col gap-2 md:flex-row">
        <input value={question.title} maxLength={500} placeholder={b.questionPlaceholder} aria-label={b.questionPlaceholder} onChange={(e) => set({ title: e.target.value })} className={`${input} font-medium md:flex-1`} />
        <select value={question.type} aria-label={b.type} onChange={(e) => changeType(e.target.value as QuestionType)} className="min-h-11 rounded-md border border-border bg-background px-2 text-sm md:min-h-9 md:w-48">
          {QUESTION_TYPES.map((type) => (
            <option key={type} value={type}>
              {t.surveys.types[type]}
            </option>
          ))}
        </select>
      </div>
      <input value={question.help ?? ""} maxLength={1000} placeholder={b.helpPlaceholder} aria-label={b.helpPlaceholder} onChange={(e) => set({ help: e.target.value || undefined })} className={`${input} mt-2 text-muted`} />

      {isChoice(question.type) && (
        <ul className="mt-2 flex flex-col gap-1">
          {options.map((option, i) => (
            <li key={i} className="flex flex-wrap items-center gap-2">
              <span aria-hidden="true" className="w-5 text-center text-muted">
                {question.type === "multi" ? "☐" : question.type === "single" ? "○" : `${i + 1}.`}
              </span>
              <input
                value={option.label}
                maxLength={300}
                aria-label={b.option(i + 1)}
                onChange={(e) => set({ options: options.map((o, j) => (j === i ? { ...o, label: e.target.value } : o)) })}
                className={`${input} min-w-40 flex-1 ${option.label.trim() && labels.indexOf(option.label.trim()) !== i ? "border-danger" : ""}`}
              />
              {canJump(question.type) && targets.length > 2 && (
                <select
                  value={option.goTo ?? ""}
                  aria-label={b.goTo}
                  title={b.goTo}
                  onChange={(e) => set({ options: options.map((o, j) => (j === i ? { label: o.label, ...(e.target.value ? { goTo: e.target.value } : {}) } : o)) })}
                  className="min-h-11 max-w-56 rounded-md border border-border bg-background px-2 text-xs md:min-h-9"
                >
                  {targets.map((target) => (
                    <option key={target.value} value={target.value}>
                      {target.label}
                    </option>
                  ))}
                </select>
              )}
              <button type="button" aria-label={b.removeOption} title={b.removeOption} disabled={options.length <= 1} onClick={() => set({ options: options.filter((_, j) => j !== i) })} className={small}>
                ✕
              </button>
            </li>
          ))}
          <li>
            <button type="button" onClick={() => set({ options: [...options, { label: b.optionN(options.length + 1) }] })} className="ml-7 min-h-11 px-1 text-sm text-accent hover:underline md:min-h-8">
              {b.addOption}
            </button>
          </li>
        </ul>
      )}

      {question.type === "scale" && (
        <div className="mt-2 flex flex-wrap items-center gap-2 text-sm">
          <label className="flex items-center gap-1">
            {b.scaleFrom}
            <select value={question.min ?? 1} onChange={(e) => set({ min: Number(e.target.value) })} className="min-h-11 rounded-md border border-border bg-background px-2 md:min-h-9">
              {[0, 1].map((n) => (
                <option key={n}>{n}</option>
              ))}
            </select>
          </label>
          <label className="flex items-center gap-1">
            {b.scaleTo}
            <select value={question.max ?? 5} onChange={(e) => set({ max: Number(e.target.value) })} className="min-h-11 rounded-md border border-border bg-background px-2 md:min-h-9">
              {[2, 3, 4, 5, 6, 7, 8, 9, 10].map((n) => (
                <option key={n}>{n}</option>
              ))}
            </select>
          </label>
          <input value={question.minLabel ?? ""} maxLength={60} placeholder={b.minLabel} aria-label={b.minLabel} onChange={(e) => set({ minLabel: e.target.value || undefined })} className={`${input} w-auto flex-1`} />
          <input value={question.maxLabel ?? ""} maxLength={60} placeholder={b.maxLabel} aria-label={b.maxLabel} onChange={(e) => set({ maxLabel: e.target.value || undefined })} className={`${input} w-auto flex-1`} />
        </div>
      )}
      {question.type === "rating" && (
        <label className="mt-2 flex items-center gap-2 text-sm">
          {b.stars}
          <select value={question.max ?? 5} onChange={(e) => set({ max: Number(e.target.value) })} className="min-h-11 rounded-md border border-border bg-background px-2 md:min-h-9">
            {[3, 4, 5, 6, 7, 8, 9, 10].map((n) => (
              <option key={n}>{n}</option>
            ))}
          </select>
        </label>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-border pt-2">
        <label className="flex min-h-11 cursor-pointer items-center gap-2 text-sm md:min-h-8">
          <input type="checkbox" checked={question.required === true} onChange={(e) => set({ required: e.target.checked })} className="h-4 w-4" />
          {b.required}
        </label>
        <span className="flex-1" />
        <button type="button" onClick={() => onMove(-1)} disabled={first} className={small} aria-label={b.moveUp} title={b.moveUp}>
          ↑
        </button>
        <button type="button" onClick={() => onMove(1)} disabled={last} className={small} aria-label={b.moveDown} title={b.moveDown}>
          ↓
        </button>
        <button type="button" onClick={onDuplicate} className={small}>
          {b.duplicate}
        </button>
        <button type="button" onClick={() => onChange(null)} className={`${small} text-danger`}>
          {b.remove}
        </button>
      </div>
    </div>
  );
}
