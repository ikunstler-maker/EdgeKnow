# Troubleshooting (symptom → root cause → fix)

Grep before debugging. Rules: `docs/MASTER_GUIDE.md` A2.

## Env / tooling
## Docker images can't be pulled in the cloud session — Env
- Symptom: `docker pull` → `CONNECT tunnel failed, response 403` / `no such host` for cloudfront or pkg-containers.
- Root cause: network policy blocks image registries' blob hosts; local Supabase stacks can't start.
- Fix: verify DB with `scripts/test-db.sh` / `scripts/test-team-db.sh` on local Postgres; UI with a temporary harness page; full e2e runs only in CI.
- Seen: 2026-11-03

## Local Postgres "Connection refused" — Env
- Symptom: `psql: ... .s.PGSQL.5432 failed: Connection refused` though `pg_ctlcluster` says running.
- Root cause: stale pid after a container restart.
- Fix: `sudo pg_ctlcluster 16 main stop; sudo pg_ctlcluster 16 main start`.
- Seen: 2026-11-03

## `origin/main` is stale — Git
- Symptom: rebases/PRs based on an old main; PR "dirty".
- Root cause: the remote ref isn't refreshed by the proxy setup.
- Fix: `git fetch https://github.com/ikunstler-maker/EdgeKnow main` and use `FETCH_HEAD`; push with `--force-with-lease=branch:sha` only on own branches.
- Seen: 2026-11

## Site not reachable from the session — Env
- Symptom: `curl https://edge-know.vercel.app` → 403 from the proxy.
- Fix: check deploys via `gh api repos/<repo>/commits/<sha>/status` (context "Vercel").
- Seen: 2026-11-03

## DB
## plpgsql "syntax error at end of input" around CASE — DB
- Symptom: error inside `if ... > case when ... then ... end then`.
- Root cause: plpgsql splits the IF condition at the first THEN.
- Fix: compute the CASE into a variable first.
- Seen: 2026-11-03

## Function result ignores a change made in the same statement — DB tests
- Symptom: `select set_x(...) || get_state(...)` shows the old state.
- Root cause: a STABLE function sees the statement's snapshot.
- Fix: split into separate statements in tests.
- Seen: 2026-11-03

## Team test runs before members exist — DB tests
- Symptom: team test returns `forbidden` for everything.
- Root cause: glob order: `team10_*` sorts before `team1_access` (which seeds members).
- Fix: name new team tests `team9b_*`, `team9c_*`, … (after `team9_*`).
- Seen: 2026-11-03

## Policy calls a function members can't execute — DB
- Symptom: `permission denied for function can_read_survey_answers` in unrelated tests.
- Root cause: functions in RLS policies run with the caller's rights.
- Fix: `grant execute ... to authenticated` for helpers used in policies (they must only answer about the caller).
- Seen: 2026-11-03

## Tombstone counts change in stage4 — DB tests
- Symptom: `stage4_attachments.expected` diff in tombstone counts.
- Root cause: a later-sorted test (e.g. stage35) left `attachment_tombstones` rows.
- Fix: delete the test's own tombstones at its end.
- Seen: 2026-11-03

## CI / e2e
## e2e `getByText` counts 2 instead of 1 — e2e
- Symptom: a check expecting one match fails although the UI is right.
- Root cause: the same text also sits in a screen-reader-only `legend`/label.
- Fix: select by a `data-*` attribute (e.g. `[data-question="…"]`).
- Seen: 2026-11-03

## Flaky: sheet embed "a change made elsewhere shows up" — e2e (nodes)
- Symptom: passes on reruns with the same code.
- Root cause: the page has two embeds of the same table (grid + chart); the test waited for the first to update, then counted both.
- Fix (done): wait for `.nth(1)`. Same pattern for any multi-embed check (also the survey form + summary check: wait for the checked elements, not the frame).
- Seen: 2026-11-03

## Main re-runs all tests after merge — CI
- Fix (done): `tested` job skips tests when the merge tree equals a PR head that already passed. Docs/config-only changes don't trigger the workflow.
- Seen: 2026-11-03

## UI / libraries
## Task board: drop into another column lands in the old one — dnd-kit
- Root cause: `closestCorners` measures to a droppable's corners; a tall column loses to card slots near the pointer. PointerSensor also fought touch scrolling.
- Fix: collision = `pointerWithin` (card slots first), fallback `closestCorners`; MouseSensor + TouchSensor (long press) instead of PointerSensor.
- Seen: 2026-12-16
## Fortune-sheet TRUE/FALSE treated as cell labels; dates as JS strings — Tables
- Fix: wrapped `_callCellValue` and date serials with `formatForFormula` (`src/lib/sheet-functions.ts`).
- Seen: 2026-11

## React #185 / "reading '0'" in table embed — Tables
- Root cause: editor got new data/hooks every render.
- Fix: take data once (`useState`), stable hooks (`useMemo([])`), callbacks in a ref.
- Seen: 2026-11

## Image generator miscounts objects — Landing assets
- Symptom: Gemini draws 10–12 tiles when asked for 9.
- Fix: generate, then use the image-edit call to remove extras; or let the owner pick. Make edges transparent (luma key + padding) so no frame shows on the dark page.
- Seen: 2026-11-03
