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
exit $status
