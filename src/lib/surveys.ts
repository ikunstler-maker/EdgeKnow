// Surveys (steps О1, О2): a form is sections of questions. A choice may send the
// person to another section or to the end; each section says where to go after
// it. The database walks the same path when it checks an answer
// (public.survey_clean_answers), so what is shown here is only for the person.

export const QUESTION_TYPES = ["short", "long", "single", "multi", "dropdown", "scale", "rating", "date", "file"] as const;
export type QuestionType = (typeof QUESTION_TYPES)[number];

// goTo / next: a section id, "submit" (the end) or nothing (the next section).
export type Option = { label: string; goTo?: string };
export type Question = {
  id: string;
  type: QuestionType;
  title: string;
  help?: string;
  required?: boolean;
  options?: Option[];
  min?: number;
  max?: number;
  minLabel?: string;
  maxLabel?: string;
};
export type Section = { id: string; title?: string; description?: string; next?: string; questions: Question[] };
export type SurveyData = { description?: string; sections: Section[] };
// A "file" answer is the ids of the files added (up to 5); their names come with the answers.
export type Answer = string | string[] | number;
export const MAX_FILES_PER_ANSWER = 5;
export type SurveyFiles = Record<string, { name: string; bytes: number }>;
export type Answers = Record<string, Answer>;

export const CHOICE_TYPES: QuestionType[] = ["single", "multi", "dropdown"];
export const isChoice = (type: QuestionType) => CHOICE_TYPES.includes(type);
// Only these may send the person elsewhere (one answer each).
export const canJump = (type: QuestionType) => type === "single" || type === "dropdown";

export const newId = () => Math.random().toString(36).slice(2, 10);

export function newQuestion(type: QuestionType, optionLabel: (n: number) => string): Question {
  const question: Question = { id: newId(), type, title: "" };
  if (isChoice(type)) question.options = [{ label: optionLabel(1) }, { label: optionLabel(2) }];
  if (type === "scale") Object.assign(question, { min: 1, max: 5 });
  if (type === "rating") question.max = 5;
  return question;
}

export const emptySurvey = (question: Question): SurveyData => ({ sections: [{ id: newId(), questions: [question] }] });

const text = (value: unknown, max: number) => (typeof value === "string" ? value.slice(0, max) : undefined);
const int = (value: unknown, low: number, high: number, fallback: number) =>
  typeof value === "number" && Number.isInteger(value) ? Math.min(high, Math.max(low, value)) : fallback;

// Only well-formed parts survive (a broken save never breaks the form).
export function readSurvey(data: unknown): SurveyData {
  const raw = (data ?? {}) as { description?: unknown; sections?: unknown };
  const sections = (Array.isArray(raw.sections) ? raw.sections : [])
    .filter((s): s is Record<string, unknown> => Boolean(s) && typeof s === "object" && typeof (s as Section).id === "string")
    .map((s) => ({
      id: String(s.id),
      title: text(s.title, 300),
      description: text(s.description, 2000),
      next: text(s.next, 40),
      questions: (Array.isArray(s.questions) ? s.questions : [])
        .filter((q): q is Question => Boolean(q) && typeof q === "object" && typeof q.id === "string" && QUESTION_TYPES.includes(q.type))
        .map((q) => {
          const question: Question = { id: q.id, type: q.type, title: text(q.title, 500) ?? "", help: text(q.help, 1000), required: q.required === true };
          if (isChoice(q.type)) {
            question.options = (Array.isArray(q.options) ? q.options : [])
              .filter((o) => o && typeof o.label === "string")
              .map((o) => ({ label: o.label.slice(0, 300), ...(canJump(q.type) && typeof o.goTo === "string" && o.goTo ? { goTo: o.goTo } : {}) }));
          }
          if (q.type === "scale") Object.assign(question, { min: int(q.min, 0, 1, 1), max: int(q.max, 2, 10, 5), minLabel: text(q.minLabel, 60), maxLabel: text(q.maxLabel, 60) });
          if (q.type === "rating") question.max = int(q.max, 3, 10, 5);
          return question;
        }),
    }));
  return { description: text(raw.description, 4000), sections };
}

export const allQuestions = (survey: SurveyData) => survey.sections.flatMap((section) => section.questions);

export const isEmpty = (answer: Answer | undefined) =>
  answer === undefined || answer === null || (typeof answer === "string" && answer.trim() === "") || (Array.isArray(answer) && answer.length === 0);

// Where the person goes after a section: another section's index, or "submit".
export function nextStep(survey: SurveyData, at: number, answers: Answers): number | "submit" {
  const section = survey.sections[at];
  let jump: string | undefined;
  for (const question of section?.questions ?? []) {
    const answer = answers[question.id];
    if (!canJump(question.type) || typeof answer !== "string") continue;
    const goTo = question.options?.find((o) => o.label === answer)?.goTo;
    if (goTo) jump = goTo;
  }
  const next = jump ?? section?.next ?? "";
  if (next === "submit") return "submit";
  if (!next) return at + 1 >= survey.sections.length ? "submit" : at + 1;
  const index = survey.sections.findIndex((s) => s.id === next);
  return index < 0 ? "submit" : index;
}

// The required questions of a section the person has not answered.
export const missingIn = (section: Section, answers: Answers) => section.questions.filter((q) => q.required && isEmpty(answers[q.id])).map((q) => q.id);

// Only the answers on the path the person took (as the database keeps them).
export function answersOnPath(survey: SurveyData, answers: Answers): Answers {
  const kept: Answers = {};
  let at: number | "submit" = survey.sections.length ? 0 : "submit";
  for (let steps = 0; at !== "submit" && steps <= survey.sections.length; steps++) {
    for (const question of survey.sections[at].questions) if (!isEmpty(answers[question.id])) kept[question.id] = answers[question.id];
    at = nextStep(survey, at, answers);
  }
  return kept;
}

export type SurveyResponse = { id: string; created_at: string; updated_at: string; answers: Answers; name: string | null; email: string | null; public?: boolean };

export type QuestionSummary =
  | { kind: "counts"; question: Question; total: number; counts: { label: string; count: number }[]; average?: number }
  | { kind: "texts"; question: Question; total: number; texts: string[] };

// What the answers add up to, question by question (the charts of the results).
export function summarize(survey: SurveyData, responses: SurveyResponse[], files: SurveyFiles = {}): QuestionSummary[] {
  return allQuestions(survey).map((question) => {
    const given = responses.map((r) => r.answers?.[question.id]).filter((a): a is Answer => !isEmpty(a));
    if (isChoice(question.type)) {
      const labels = (question.options ?? []).map((o) => o.label);
      const counts = new Map(labels.map((label) => [label, 0]));
      for (const answer of given) for (const label of Array.isArray(answer) ? answer : [String(answer)]) counts.set(label, (counts.get(label) ?? 0) + 1);
      return { kind: "counts", question, total: given.length, counts: [...counts].map(([label, count]) => ({ label, count })) };
    }
    if (question.type === "scale" || question.type === "rating") {
      const low = question.type === "rating" ? 1 : (question.min ?? 1);
      const high = question.max ?? 5;
      const numbers = given.map(Number).filter((n) => Number.isFinite(n));
      const counts = Array.from({ length: high - low + 1 }, (_, i) => ({ label: String(low + i), count: numbers.filter((n) => n === low + i).length }));
      const average = numbers.length ? Math.round((numbers.reduce((a, b) => a + b, 0) / numbers.length) * 10) / 10 : undefined;
      return { kind: "counts", question, total: numbers.length, counts, average };
    }
    return { kind: "texts", question, total: given.length, texts: given.map((a) => answerText(question, a, files)).reverse() };
  });
}

// 2026-12-01 → 01.12.2026
export const formatDate = (value: string) => (/^\d{4}-\d{2}-\d{2}$/.test(value) ? value.split("-").reverse().join(".") : value);

export const answerText = (question: Question, answer: Answer | undefined, files: SurveyFiles = {}) =>
  isEmpty(answer)
    ? "—"
    : question.type === "file" && Array.isArray(answer)
      ? answer.map((id) => files[id]?.name ?? "…").join(", ")
      : Array.isArray(answer)
        ? answer.join(", ")
        : question.type === "date"
          ? formatDate(String(answer))
          : String(answer);

export type SurveyState = {
  anonymous: boolean;
  once: boolean;
  editable: boolean;
  accepting: boolean;
  closes_at: string | null;
  max_responses: number | null;
  closed: boolean;
  answered: boolean;
  mine: Answers | null;
  manager: boolean;
  count: number | null;
  sheet: { id: string; title: string | null; name: string; full: boolean } | null;
  public?: { enabled: boolean; token: string | null } | null;
};

// A file added to an answer, before the answer is sent.
export type AddedFile = { id: string; name: string };
// How the form sends its answer and its files: inside the workspace, or through the link for anyone.
export type SurveyTransport = {
  submit: (answers: Answers) => Promise<{ ok: true; edited?: boolean } | { ok: false; error: string; question?: string }>;
  upload: ((file: File) => Promise<{ ok: true; id: string } | { ok: false; error: string }>) | null;
  // Not signed in (the link for anyone): files can't be added; where to sign in.
  signInHref?: string;
};
