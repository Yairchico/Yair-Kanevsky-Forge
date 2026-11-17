#!/bin/bash
# build the app against the stand-in and (re)start both
source "$(dirname "$0")/env.sh"
cd "${REPO:-$H/../..}"
pkill -f "node standin" ; pkill -f "next start" ; pkill -f "next-server"; sleep 1
: > $H/requests.jsonl
(cd $H && nohup node standin.mjs > standin.log 2>&1 &)
npx next build > $H/build.log 2>&1 || { tail -30 $H/build.log; exit 1; }
PERF_LOG=${PERF_LOG:-0} nohup npx next start -p 3100 > $H/next.log 2>&1 &
for i in $(seq 1 30); do curl -s -o /dev/null http://localhost:3100/login && break; sleep 1; done
echo up
