#!/bin/bash
# (re)creates forge_dev: bootstrap + all migrations + seed + fixture + dev data
set -e
R="$(cd "$(dirname "$0")/../../supabase" && pwd)"
export PGHOST=${PGHOST:-/tmp} PGPORT=${PGPORT:-5432} PGUSER=${PGUSER:-postgres} PGOPTIONS="--client-min-messages=warning"
P="psql -X -q -v ON_ERROR_STOP=1"
$P -d postgres -c "drop database if exists forge_dev with (force)" -c "create database forge_dev"
$P -d forge_dev -f $R/tests/bootstrap.sql >/dev/null
for m in $R/migrations/*.sql; do $P -d forge_dev -f $m >/dev/null; done
$P -d forge_dev -f $R/seed.sql >/dev/null
$P -d forge_dev -f $R/tests/fixture.sql >/dev/null
$P -d forge_dev -f "$(dirname "$0")/seed-dev.sql" | tail -1 > "$(dirname "$0")/ids.txt"
cat "$(dirname "$0")/ids.txt"
