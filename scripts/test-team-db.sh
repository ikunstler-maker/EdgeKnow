#!/usr/bin/env bash
# Applies the team database migrations (path C) to a throwaway Postgres and
# compares the team security tests with their expected output.
# Usage: PGHOST=... PGPORT=... PGUSER=postgres scripts/test-team-db.sh [--update]
set -euo pipefail
cd "$(dirname "$0")/.."

DB=edgeknow_team_test
psql -q -v ON_ERROR_STOP=1 -d postgres -c "drop database if exists $DB" -c "create database $DB" 2>&1 | grep -v NOTICE || true
psql -q -v ON_ERROR_STOP=1 -d $DB -f supabase/tests/supabase_stub.sql
psql -q -v ON_ERROR_STOP=1 -d $DB -f supabase/team/tests/team_stub.sql
for f in supabase/team/migrations/*.sql; do
  psql -q -v ON_ERROR_STOP=1 -d $DB -f "$f"
done

status=0
for t in supabase/team/tests/team*_*.sql; do
  [ "$(basename "$t")" = team_stub.sql ] && continue
  expected="${t%.sql}.expected"
  actual=$(psql -q -d $DB -f "$t" 2>&1 | sed -E 's#^psql:[^ ]*:[0-9]+: #psql: #' || true)
  if [ "${1:-}" = "--update" ]; then
    echo "$actual" > "$expected"
    echo "UPDATED $expected"
  elif diff -u "$expected" <(echo "$actual"); then
    echo "PASS $t"
  else
    echo "FAIL $t"
    status=1
  fi
done

# Every team migration has a rollback, and rolling all of them back (newest
# first) leaves nothing of EdgeKnow in public.
for f in $(ls -r supabase/team/migrations/*.sql); do
  down="supabase/team/rollbacks/$(basename "${f%.sql}").down.sql"
  if [ -f "$down" ]; then
    psql -q -v ON_ERROR_STOP=1 -v VERBOSITY=terse -d $DB -c "set client_min_messages = warning" -f "$down"
  else
    echo "FAIL missing rollback for $f"; status=1
  fi
done
left=$(psql -Atq -d $DB -c "select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public'")
leftf=$(psql -Atq -d $DB -c "select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public'")
if [ "$left" = 0 ] && [ "$leftf" = 0 ]; then echo "PASS rollback leaves nothing"; else echo "FAIL rollback left $left relations, $leftf functions"; status=1; fi
exit $status
