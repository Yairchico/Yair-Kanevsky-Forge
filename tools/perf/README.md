# Local speed measurements

Counts, for every page and for the frequent actions, how many requests the
server makes to Supabase and — the number that matters when the database is
far away — how many of them had to wait for one another ("sequential waits").
Nothing here touches the real Supabase project or the live site, and none of
it is part of the app's build.

How it works: the app is built and run locally against a small stand-in for
Supabase (`standin.mjs`) that speaks the subset of PostgREST and Auth the
app's server side uses, on top of a local Postgres with the real migrations —
so RLS, triggers and SQL functions are the real ones. The stand-in waits
100ms before answering each request (`DELAY_MS`) and records when every
request started and ended; the scripts read that record.

```bash
# once: a local Postgres 15+ reachable through PGHOST/PGPORT/PGUSER (defaults: /tmp, 5432, postgres)
cd tools/perf && npm install --no-package-lock   # pg + jose
ln -s "$(npm root -g)/playwright" node_modules/playwright   # the scripts use the preinstalled Playwright
node genkeys.mjs                        # local signing keys (keys.json, git-ignored)

./setup-db.sh                           # database forge_dev: all migrations + seed + sample data
./up.sh                                 # build the app against the stand-in, start both (app on :3100)

node pages.mjs                          # every page, as trainee / trainer / read-only viewer
node actions.mjs                        # confirm a set, un-confirm, trainer session, builder edit (real browser)
node crawl.mjs                          # opens every screen per role: console errors, failed requests, redirects
node flows.mjs                          # log sets → leave → come back → reload; free session; the viewer can't write
node trainee-entry.mjs                  # the trainee's quick entry, every step checked against the database
node one.mjs trainer /trainer/session   # the request timeline of one page

./reset.sh                              # fresh database between runs that write (actions.mjs, flows.mjs)
JWT_ALG=ES256 node pages.mjs            # as a project with asymmetric JWT signing keys (token verified locally)
REPO=/path/to/another/checkout ./up.sh  # measure a different version of the code (e.g. a worktree of the old commit)
```

Reading the output: `reqs` = requests to Supabase, `waves` = sequential
waits, then the time at 100ms per request. In `actions.mjs`, `saved` is when
the screen showed the result, `all-done` when everything the click caused had
finished, and `bg(...)` what happened later in the background (the delayed
sync, `src/app/sync-actions.ts`).

Limits: the stand-in supports flat selects, the filters the app uses,
insert / upsert / update / delete, `count=exact` and RPC — not embedded
selects (`table(columns)`), and not Storage. The sample data is tiny, so this
measures the SHAPE of the loading (how many waits), not query cost on a large
database. The builder test edits a published program, which sends it back to
draft — run `./reset.sh` before measuring the trainee again.
