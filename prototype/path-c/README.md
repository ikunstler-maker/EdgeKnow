# Prototype: path C ("team data, our code")

Throwaway experiment, not part of the app. Answers one question before stage 1 of
`docs/roadmap-uk.md`: can a person signed in on the central site work with their
team's **own** Supabase project directly from the browser, safely?

Runs in GitHub Actions (`.github/workflows/prototype-path-c.yml`): two local Supabase
stacks stand in for two teams, each with its own signing key. `run.mjs` plays the
central service: it keeps the teams' connection details encrypted, applies the team
schema to each database, mints short-lived tokens and checks what each team's API
accepts. Results go to the job summary.

- `team-schema/` — a minimal team database: notes owned by people, protected by RLS.
- `setup.sh` — creates the two stacks with their own ports and signing keys.
- `run.mjs` — the checks.
