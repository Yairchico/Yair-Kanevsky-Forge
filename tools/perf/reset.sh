#!/bin/bash
# fresh database + restart only the stand-in (its connections die with the old database)
cd "$(dirname "$0")"
pkill -f "node standin" ; sleep 0.5
./setup-db.sh >/dev/null
[ -n "$1" ] && psql -h ${PGHOST:-/tmp} -U ${PGUSER:-postgres} -d forge_dev -qc "$1"
nohup node standin.mjs > standin.log 2>&1 &
sleep 1
