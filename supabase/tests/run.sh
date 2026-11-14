#!/bin/bash
# Runs the SQL test suites against a throwaway local Postgres database.
#
#   supabase/tests/run.sh                 # all suites
#   supabase/tests/run.sh 0017            # only files whose name contains "0017"
#
# Needs a Postgres 15+ server you can create databases on. Connection comes
# from the usual PG* variables (PGHOST, PGPORT, PGUSER, PGPASSWORD); nothing
# here ever touches the real Supabase project.
#
# For every suite: a fresh database, bootstrap.sql, ALL migrations in order,
# the seed, then every migration from 0013 on a second time (they must be
# re-runnable), then the suite. A suite prints one PASS/FAIL line per check.
set -u
cd "$(dirname "$0")"
MIGRATIONS=../migrations
SEED=../seed.sql
FILTER=${1:-}
export PGOPTIONS="${PGOPTIONS:-} --client-min-messages=warning"
PSQL="psql -X -q -v ON_ERROR_STOP=1"
status=0

for suite in 00*.sql; do
  case "$suite" in *"$FILTER"*) ;; *) continue ;; esac
  db="forge_test_${suite%%_*}"
  $PSQL -d postgres -c "drop database if exists $db with (force)" -c "create database $db" >/dev/null || exit 2
  $PSQL -d "$db" -f bootstrap.sql >/dev/null || exit 2
  for m in $MIGRATIONS/*.sql; do
    $PSQL -d "$db" -f "$m" >/dev/null 2>/tmp/forge_test_err.txt || { echo "migration failed: $m"; cat /tmp/forge_test_err.txt; exit 2; }
  done
  $PSQL -d "$db" -f "$SEED" >/dev/null || exit 2
  for m in $MIGRATIONS/001[3-9]*.sql $MIGRATIONS/00[2-9][0-9]*.sql; do
    [ -f "$m" ] || continue
    $PSQL -d "$db" -f "$m" >/dev/null 2>/tmp/forge_test_err.txt || { echo "migration is not re-runnable: $m"; cat /tmp/forge_test_err.txt; exit 2; }
  done
  case "$suite" in 0014*|0016*) $PSQL -d "$db" -f fixture.sql >/dev/null || exit 2 ;; esac

  out=$(psql -X -q -d "$db" -f "$suite" 2>&1)
  pass=$(printf '%s\n' "$out" | grep -c "PASS  ")
  bad=$(printf '%s\n' "$out" | grep -E "FAIL  |ERROR")
  if [ -n "$bad" ]; then
    echo "$suite: $pass passed, FAILURES:"
    printf '%s\n' "$bad"
    status=1
  else
    echo "$suite: $pass passed"
  fi
  $PSQL -d postgres -c "drop database if exists $db with (force)" >/dev/null
done
exit $status
