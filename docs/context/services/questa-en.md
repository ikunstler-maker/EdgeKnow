# Questa — surveys and forms

> **Service card.** Read with `docs/context/00-overview-en.md`. **State as of:** 2027-01-14. Source of truth: `docs/decisions.md` and the code. Ukrainian twin: `questa-uk.md`.

## 1. Purpose

Forms and surveys: for the team and for people without an account. Answers go straight into a connected table.

- **State:** ✅ live.
- **URLs:** `/w/<id>/surveys`, `/w/<id>/surveys/<survey>`; open form — `/f/<workspace>/<token>`.

## 2. What is built

### Form
- Sections with questions: short and long text, single or multiple choice, dropdown, scale, stars, date, **file** (up to 5 files of 4 MB).
- "Required"; jumps between sections, including by the chosen option.
- The database itself validates an answer against the form and stores only answers on the path taken.

### Settings
- **Anonymous** (the name is not recorded at all; cannot change after the first answer).
- One answer per person; editing one's answer (non-anonymous only).
- Accept answers; close after a date or a number of answers.

### Answers
- Seen only by the survey's editors (not guests), its owner, and the workspace owner and admins.
- Summary with a chart per question, average, table of all answers.

### Link for anyone
- Turned on in settings; "New link" disables the old one at once.
- Everything goes through the server only; the database's anonymous role has no access at all.
- Limits: up to 5 answers per device per 10 minutes, up to 300 per hour per survey. The device is a one-way hash; no address is stored.
- The "I'm not a robot" check turns on once its keys are set in hosting settings.
- A file through the link can be added only after sign-in.

### Shared
- List, trash, access, collections.

## 3. Planned

| What | State |
|---|---|
| Surveys in chat (Toker) | after chat |
| Link with CRM (Spilno) | after CRM |
| Answer limit on Free | open pricing question |

## 4. Data

| Table | Holds |
|---|---|
| `service_objects` (service `surveys`) | the form |
| `survey_settings` | settings, public link token, connected table |
| `survey_responses`, `survey_respondents` | answers and who answered |
| `survey_public_hits` | limit counters for the public link |
| `object_files` | answer files |

Answer tables are reachable through database functions only.

## 5. Links with other services

| Service | Link |
|---|---|
| **Sota** | connected table: an answer becomes a row; an edited answer changes its row; a deleted one stays in the table |
| **Wika** | "Survey" block: form or results (results only for those who may see answers) |
| **Kadry** | form or results on a slide |
| **Core** | search (question and option text), "My data" (own non-anonymous answers), file storage |

## 6. Key files

| What | Where |
|---|---|
| Screens | `src/app/w/[wid]/surveys/`, open form — `src/app/f/` |
| Actions | `src/app/survey-actions.ts`, `public-survey-actions.ts` |
| Components | `src/components/surveys/` |
| Logic | `src/lib/surveys.ts`, `survey-uploads.ts` |

## 7. Important decisions

- Anonymity is real: the name is not stored even for the owner.
- The open form is the only place in the product where a person without an account writes; hence server-only and rate-limited.
- Uploaded but not submitted files are cleaned up after a day.

## 8. Known gaps and open questions

- Confirm the "I'm not a robot" check shows on open forms once the keys are added.
- The personal-data warning on open forms — align with the privacy policy before launch.
