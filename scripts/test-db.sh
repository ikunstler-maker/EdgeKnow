#!/usr/bin/env bash
# Applies all migrations to a throwaway Postgres (with a minimal stand-in for
# Supabase's auth schema and roles) and compares security test output with the
# expected file. Usage: PGHOST=... PGPORT=... PGUSER=postgres scripts/test-db.sh [--update]
# --update rewrites the .expected files from the current output (review the diff!).
set -euo pipefail
cd "$(dirname "$0")/.."

DB=edgeknow_test
psql -q -v ON_ERROR_STOP=1 -d postgres -c "drop database if exists $DB" -c "create database $DB" 2>&1 | grep -v NOTICE || true
psql -q -v ON_ERROR_STOP=1 -d $DB -f supabase/tests/supabase_stub.sql
for f in supabase/migrations/*.sql; do
  psql -q -v ON_ERROR_STOP=1 -d $DB -f "$f"
done

status=0
for t in supabase/tests/stage*.sql; do
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
# Upgrade tests: apply migrations older than `before`, load seed.sql (data as it
# existed then), apply the rest — and, with `rollback_to`, run the rollback
# scripts back down to that version — then compare check.sql output.
for dir in supabase/tests/upgrade/*/; do
  [ -f "$dir/before" ] || continue
  cutoff=$(tr -d '[:space:]' < "$dir/before")
  db=edgeknow_upgrade
  psql -q -v ON_ERROR_STOP=1 -d postgres -c "drop database if exists $db" -c "create database $db" 2>&1 | grep -v NOTICE || true
  psql -q -v ON_ERROR_STOP=1 -d $db -f supabase/tests/supabase_stub.sql
  for f in supabase/migrations/*.sql; do
    [ "$(basename "$f" | cut -d_ -f1)" \< "$cutoff" ] && psql -q -v ON_ERROR_STOP=1 -d $db -f "$f"
  done
  psql -q -v ON_ERROR_STOP=1 -d $db -f "$dir/seed.sql" > /dev/null
  for f in supabase/migrations/*.sql; do
    [ "$(basename "$f" | cut -d_ -f1)" \< "$cutoff" ] || psql -q -v ON_ERROR_STOP=1 -d $db -f "$f" 2>&1 | grep -v NOTICE || true
  done
  if [ -f "$dir/rollback_to" ]; then
    target=$(tr -d '[:space:]' < "$dir/rollback_to")
    for f in $(ls supabase/rollbacks/*.down.sql | sort -r); do
      [ "$(basename "$f" | cut -d_ -f1)" \< "$target" ] || psql -q -v ON_ERROR_STOP=1 -d $db -f "$f"
    done
  fi
  expected="$dir/check.expected"
  actual=$(psql -q -d $db -f "$dir/check.sql" 2>&1 | sed -E 's#^psql:[^ ]*:[0-9]+: #psql: #' || true)
  if [ "${1:-}" = "--update" ]; then
    echo "$actual" > "$expected"
    echo "UPDATED $expected"
  elif diff -u "$expected" <(echo "$actual"); then
    echo "PASS $dir"
  else
    echo "FAIL $dir"
    status=1
  fi
done

exit $status
