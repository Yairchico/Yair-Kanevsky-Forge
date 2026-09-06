@AGENTS.md

# Yair Kanevsky by Forge — project guide

A private fitness-training app for **one strength coach (trainer) and their
trainees**. Hebrew UI, RTL throughout. No multi-tenant/org model — there is
exactly one `role='trainer'` profile with full read/write access to
everything; see `PLAN.md` §0 for why that's a deliberate simplification,
not a gap. (There's also an optional, separate read-only "superadmin"
oversight account — see "Superadmin (read-only oversight)" below; it's not
a second trainer.) `PLAN.md` is the living roadmap/history (stages,
decisions, status checkboxes) — read it for *why*; this file is for *how
to work in this codebase*. `README.md` is
user-facing setup/deploy instructions.

## Stack

- **Next.js 16** (App Router, Turbopack, React 19) + TypeScript + Tailwind v4.
- **Supabase**: Postgres + Auth + Row Level Security. Two server-side client
  factories, not interchangeable:
  - `src/lib/supabase/server.ts` `createClient()` — cookie-scoped, RLS
    enforced as the signed-in user. Use this for everything by default.
  - `src/lib/supabase/admin.ts` `createAdminClient()` — service-role,
    **bypasses RLS entirely**. Only for privileged auth-user operations the
    trainer's own session can't do (creating/editing/deleting a trainee's
    `auth.users` row, sending a password-reset email). Every call site
    must (a) have already checked the caller is the trainer
    (`requireTrainer()` in `src/app/trainer/trainees/actions.ts`) and
    (b) wrap the call in try/catch — it throws *synchronously* if
    `SUPABASE_SERVICE_ROLE_KEY`/`NEXT_PUBLIC_SUPABASE_URL` aren't set,
    and an uncaught throw here becomes Cloudflare's raw crash page instead
    of a readable error (see Known Gotchas).
  - `src/lib/supabase/client.ts` — browser client, rarely needed (almost
    everything is a Server Action or Server Component).
- **Cloudflare Workers** via OpenNext (`@opennextjs/cloudflare`). The Worker
  name is `yair-kanevsky-forge` (`wrangler.jsonc`) — must match whatever
  deploys it, or the `WORKER_SELF_REFERENCE` service binding breaks.
- Username-based login (not email) — `email_for_username()` SECURITY
  DEFINER RPC resolves a username to the (real or placeholder) email
  Supabase Auth still needs internally. See migration `0004`.

## Directory map

```
src/app/login/                       login (username+password)
src/app/reset-password/              where a password-reset email lands
src/app/auth/callback/route.ts       code-exchange for magic-link/recovery flows (?next= param controls redirect)
src/app/trainer/                     trainer area
  trainees/                          list, new, [id] (detail: edit form, programs list, weekly view, delete)
    [id]/programs/new/               create a program for a calendar week (+ "duplicate week")
    [id]/programs/[programId]/       the flow-builder (workouts × exercises)
  exercises/                         shared exercise library (search, add, custom)
src/app/trainee/                     trainee's own area (weekly workout tabs, history)
src/components/ui/                   hand-built primitives (NOT shadcn, despite PLAN.md's original wording — Button, Card, Input, Label, Select, Textarea, SearchInput)
src/components/                      AppShell, BrandMark, SignOutButton
src/lib/supabase/                    client factories + hand-written Database types
src/lib/week.ts                      calendar-week helpers (Sunday-start, Israeli convention)
src/lib/format.ts                    tiny display-formatting helpers usable from both server and client components (e.g. formatWeight) — put shared formatting here, not inside a "use client" file another route imports from
src/proxy.ts + src/lib/supabase/middleware.ts   Next 16 "Proxy" (renamed from middleware) — session refresh + role-based routing only, not an authorization boundary
supabase/migrations/                 numbered, additive SQL migrations (see below)
supabase/seed.sql                    ~58 base exercises, ON CONFLICT DO NOTHING
.github/workflows/deploy.yml         the real deploy path (see Deployment)
```

## Conventions

- **Server Actions, not API routes.** A form's action lives in a sibling
  `actions.ts` (`"use server"`), returns a small state shape like
  `{ error?: string; success?: boolean }`, and the client component drives
  it with `useActionState`. A non-form action (toggle, delete, reorder) is
  called directly from an event handler via `useTransition`.
- **Optimistic UI, not `router.refresh()`.** Client components hold the
  list/row state locally; an action fires in the background and returns
  the created/updated row so the client can reconcile without a full
  server round-trip. Temporary optimistic IDs come from a `useRef`
  counter (`tempCounter.current += 1`), never `Date.now()`/`Math.random()`
  inline — that trips the `react-hooks/purity` lint rule.
- **`revalidatePath` after every mutation**, including the *other* side's
  pages when data crosses trainer/trainee — e.g. a trainee logging a
  performance or submitting a workout also revalidates
  `/trainer/trainees/[id]`.
- **Batch-on-submit + localStorage draft** (the trainee's per-exercise
  performance entry, `src/lib/workout-draft.ts`): fields with no
  per-field save button hold their value in local React state that's
  mirrored into `localStorage` (keyed per `workoutId`) on every change, so
  it survives a closed tab; nothing reaches the server until one bulk
  action fires at the end (`submitWorkout` in `src/app/trainee/actions.ts`
  turns the whole draft into one `workout_logs` insert). Reach for this
  pattern — not a save button per row — wherever a trainee fills in
  several small fields before one real "done" action.
- **Draft/publish**: editing a published program auto-reverts it to draft
  (`revertToDraftIfPublished` in the program-builder's `actions.ts`) so a
  change never silently reaches a trainee who already saw the published
  version. Returns whether it happened so the client can flip its own
  "פורסם" badge immediately.
- **Real validation, not just HTML hints.** `min`/`max`/`required` on an
  `<input>` is a UX nicety only — every Server Action that writes
  sets/reps/RPE/etc. re-validates server-side and returns a friendly
  Hebrew error on rejection (see `validateWorkoutExerciseFields` in the
  program-builder's `actions.ts`). Matching DB CHECK/NOT NULL constraints
  (migration `0007`) are the backstop, not the first line of defense.
- **RLS pattern**: `public.is_trainer()` (SECURITY DEFINER) gates a
  trainer's "for all" policy per table; a trainee's policy is always
  scoped to `trainee_id = auth.uid()` and, for anything downstream of a
  program, `status = 'published'`.
- **Calendar weeks.** `programs.week_start_date` is the Sunday starting
  that week (`src/lib/week.ts`'s `getWeekStart`); one program per
  `(trainee_id, week_start_date)`. Each `workouts` row belongs to a
  `day_of_week` (0=Sunday..6=Saturday, `src/lib/week.ts`'s `dayName()`) —
  up to 2 per day, checked both in the Server Action and by a DB trigger
  (migration `0009`). The trainer picks the day when creating a workout
  (a day-picker `Modal`, `src/components/ui/modal.tsx`). There's no stored
  global "אימון N" numbering — it's derived at display time by sorting
  `(day_of_week, order_index)`, so `order_index` only means "1st or 2nd
  that day," not a program-wide position.
- **Hebrew/RTL**: `dir="rtl"` on `<html>` (`src/app/layout.tsx`), Rubik font
  (Hebrew glyph coverage). Use logical Tailwind classes (`ps-`/`pe-`/
  `start-`/`end-`, not `pl-`/`pr-`/`left-`/`right-`). `ArrowRight` (not
  `ArrowLeft`) is the "back" icon since it points backward in RTL.
- **Exercise images**: `src/lib/exercise-image.ts` maps the ~58 base seed
  exercises to real photos (`public/exercises/exercise-<slug>.jpg`,
  downloaded from the public-domain `free-exercise-db` dataset) by exact
  name — no guessing. `exercises.media_url` (settable via file upload to
  the `exercise-images` Storage bucket, or a pasted URL — the exercise
  library's image editor, or at creation time from the program builder's
  "הוספת תרגיל" inline picker) always overrides that. Anything else — a
  trainer's custom exercise with no `media_url` set — gets **no image**
  (`getExerciseImage` returns `null`, `ExercisePhoto` renders a neutral
  `Dumbbell`-icon placeholder): a new exercise is created with
  `media_url: null` on purpose, an image is only ever added proactively,
  never guessed. Two earlier fallback approaches were tried and rejected:
  a hand-drawn stick-figure SVG (too crude) and a movement-pattern photo
  guessed from keywords in the name (not what the trainer meant by "add
  images") — don't reintroduce either.
- **`react-hook-form` and `zod` are in `package.json` but unused** — a
  leftover from `PLAN.md`'s original stack choice. The actual convention
  is plain Server Actions + `useActionState`/`FormData`. Don't reach for
  RHF/Zod without a reason to actually change the convention.

## Superadmin (read-only oversight)

`profiles.is_superadmin` (migration 0011) is a second, orthogonal account
type — not a third `role` enum value. It's for a person who should see
everything (every trainee, every program regardless of status, all
workout history) without ever being able to change anything, including by
mistake. Deliberately separate from `role='trainer'`: a superadmin's own
`role` stays `'trainee'`, so `is_trainer()` is false for them and every
existing "for all" (read/write) RLS policy denies them — the *only* thing
that grants them anything is a handful of SELECT-only policies added
specifically for `is_superadmin()`. That absence of any INSERT/UPDATE/
DELETE policy is the actual enforcement; everything else below is just
about not showing a button that would fail.

- **Routing**: a superadmin lands on `/trainer` (same screens as the real
  trainer) via `src/lib/supabase/middleware.ts` + `src/app/login/actions.ts`,
  both of which cache `is_superadmin` in its own cookie (`app_superadmin`)
  alongside the existing `app_role` cookie, same reasoning as that one
  (routing convenience, not the authorization boundary).
- **UI gating**: `src/lib/viewer.ts`'s `isReadOnlyViewer(supabase, userId)`
  is the one helper every trainer Server Component calls to get a
  `readOnly` boolean, threaded down as a prop to whatever renders a
  mutation control (add/edit/delete/publish/reorder/drag-handle) so it's
  hidden instead of rendered-then-failing. `AppShell`'s `readOnly` prop
  shows a small "צפייה בלבד" badge. A screen that's a pure mutation with
  no read-only equivalent (creating a trainee, an exercise, or a program)
  redirects a superadmin away entirely rather than rendering a form.
- **When adding a new trainer-side mutation control**: thread `readOnly`
  to it too, the same way. There is no single central switch — missing one
  spot doesn't grant real access (RLS still blocks the write), but it does
  show a control that silently does nothing for that account, which is a
  worse experience than just not rendering it.
- **Creating the account**: no in-app "invite" flow, same as the sole
  trainer account today — done manually against Supabase (create an
  `auth.users` row how you'd create any account, then `update public.
  profiles set is_superadmin = true where id = '<their-uuid>'`).

## Database migrations

Numbered, additive, and **written to be safely re-runnable** — guard every
statement with `IF EXISTS`/`IF NOT EXISTS`/`OR REPLACE`/a `DO $$ ... end $$`
existence check, since a migration can fail partway through and need a
clean re-run from the top. Current set (run in order — see README for the
one-time setup walkthrough):

1. `0001_init.sql` — schema, RLS foundation, `is_trainer()`, `handle_new_user()` trigger.
2. `0002_profiles_email_and_exercise_uniqueness.sql`
3. `0003_prevent_role_self_escalation.sql` — blocks a trainee from self-promoting `role`.
4. `0004_username_login.sql` — username-based login, `email_for_username()`.
5. `0005_exercise_completions.sql` — per-exercise "done" checkbox, separate from workout submission.
6. `0006_calendar_weeks_and_numbered_workouts.sql` — the week/workout restructure described above; drops `program_days`.
7. `0007_required_fields_and_ranges.sql` — sets/reps NOT NULL, RPE range CHECKs.
8. `0008_exercise_images_storage.sql` — public Storage bucket `exercise-images` (trainer-write/anyone-read) for uploaded exercise photos.
9. `0009_workout_days.sql` — workouts belong to a day of week (`day_of_week`, 0=Sunday..6=Saturday) with up to 2/day, replacing the old flat max-10/program rule.
10. `0010_soft_delete_programs.sql` — `programs.deleted_at`; deleting a program now sets this instead of a hard DELETE, so the `on delete cascade` chain down to `workout_logs`/`workout_completions` (migration 0001) never fires and a trainee's actual training history survives. Replaces the old `programs_trainee_week_key` unique constraint with a partial unique index (`where deleted_at is null`) so a soft-deleted week's slot is free again; RLS's trainee-facing SELECT policies on `programs`/`workouts`/`workout_exercises` also gained `deleted_at is null`.
11. `0011_superadmin_readonly.sql` — `profiles.is_superadmin` (boolean, default false) + `is_superadmin()` helper + SELECT-only RLS policies on `profiles`/`programs`/`workouts`/`workout_exercises`/`workout_logs`/`workout_completions`. A read-only oversight account, orthogonal to `role` (stays `'trainee'` for this account, so `is_trainer()`'s write policies never apply) — see "Superadmin (read-only oversight)" below.

When adding a migration: bump the number, write it idempotently, and add a
line to README's numbered run-order list under "עדכון סכימה + ספריית
תרגילים".

## Verification (run before every commit)

```bash
npx tsc --noEmit
npx eslint .
cp .env.example .env.local && npm run build   # placeholder env is enough for a build check
npm run cf:build                              # OpenNext/Cloudflare-specific build — catches issues `next build` alone won't
rm .env.local                                 # never commit this
```
This sandbox cannot reach the live `*.workers.dev` deployment or a real
Supabase project — these four commands are the full extent of what can be
verified here. Live behavior needs the user to check and report back;
don't claim to have tested something you couldn't have.

Commit messages: never pass one containing backticks/special shell chars
through `git commit -m "..."` — bash will try to interpret them. Write the
message to a temp file (in the scratchpad dir) and use `git commit -F`.

## Deployment

**Two Workers, two workflows — designed so production is never touched by
an automatic push. In practice, right now, that guarantee is broken; see
the warning below before assuming a push is safe.**

- `.github/workflows/deploy.yml` — runs on **every push to
  `claude/fitness-app-trainers-gccazz`**, builds with `npm run cf:build`,
  and deploys to the **staging** Worker (`yair-kanevsky-forge-staging`,
  `wrangler.jsonc`'s `env.staging`) via `opennextjs-cloudflare deploy
  --env staging`.
- `.github/workflows/deploy-production.yml` — **`workflow_dispatch` only,
  never on push.** Deploys the given branch/ref to the real
  `yair-kanevsky-forge` Worker. Trigger it explicitly (via
  `mcp__github__actions_run_trigger`, method `run_workflow`, workflow
  `deploy-production.yml`, with `ref` set to the branch that was reviewed —
  don't rely on the default-branch fallback) only when the user asks to
  promote/go live — never on your own initiative after an ordinary code
  change.

**⚠️ KNOWN, ACCEPTED RISK — every push to this branch can also deploy
straight to PRODUCTION, outside our workflows entirely.** Discovered
2026-09-06: Cloudflare's own git-connected "Workers Builds" is wired to
`yair-kanevsky-forge` (the production Worker) and builds on push, with
**no GitHub Actions run at all** (`deploy-production.yml`'s run history
stays at zero regardless — this is invisible from GitHub's side). A branch
move to `testing` was tried as a workaround and **reverted** — confirmed
via Cloudflare's own Deployments tab that it triggers on push to `testing`
too, so the integration is not scoped to one branch and moving branches
doesn't help. The user has explicitly chosen to accept this risk for now
(2026-09-06: "תדחוף למיין וזהו, נטפל בזה אחר כך") rather than block
ongoing work on it. The actual fix — a human disconnecting the git
integration in the Cloudflare dashboard (Workers & Pages →
`yair-kanevsky-forge` → Settings → Build) — is still **pending**. Until
that happens: don't assume "it only auto-deploys to staging" is true for
any push here, and don't act surprised or re-litigate this if a change
shows up on the production URL — it's expected until the dashboard setting
is fixed.

Both workflows re-apply every secret with `wrangler secret put` (staging
adds `--env staging`) — piped non-interactively from GitHub's encrypted
repo secrets — before deploying. This exists because Cloudflare's own
dashboard "Variables and Secrets" page repeatedly showed
`SUPABASE_SERVICE_ROLE_KEY` as configured while the deployed Worker's
actual runtime `process.env` never had it — see Known Gotchas. Required
GitHub repo secrets (shared by both workflows — staging and production use
the same Supabase project, only the deployed code differs):
`CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`,
`SUPABASE_SERVICE_ROLE_KEY`, `NEXT_PUBLIC_SUPABASE_URL`,
`NEXT_PUBLIC_SUPABASE_ANON_KEY`.

The user has no local terminal — assume every deploy-adjacent task has to
work through one of these two workflows or the Cloudflare/GitHub web
dashboards, never a `wrangler` command run by the user themselves.

## Known gotchas

- **`NEXT_PUBLIC_*` vars are inlined at *build* time**, wherever
  `process.env.NEXT_PUBLIC_X` appears literally in source — they do not
  depend on the Worker's runtime `env` bindings at all. A server-only var
  (no `NEXT_PUBLIC_` prefix) genuinely does, via OpenNext's
  `populateProcessEnv`. This means "the site mostly works" is not evidence
  that runtime env bindings are configured correctly — it can be entirely
  explained by build-time inlining. Confirmed the hard way: Cloudflare's
  dashboard showed `SUPABASE_SERVICE_ROLE_KEY` configured (even as a
  proper Secret, after a redeploy) while `Object.keys(process.env)`
  contained zero Supabase-related keys at runtime. Root cause never fully
  confirmed from inside this sandbox (no dashboard access) — the fix was
  routing deploys through GitHub Actions instead (see Deployment), which
  sidesteps the dashboard entirely.
- `createAdminClient()` throws synchronously (not a `{error}` return) if
  its env vars are missing. Always wrap its call sites in try/catch —
  otherwise it's an uncaught exception, which Cloudflare renders as a
  generic crash page with no useful detail.
- Next.js 16 renamed `middleware.ts` → `proxy.ts` (export `middleware` →
  `proxy`). `AGENTS.md` (imported at the top of this file, auto-regenerated
  by `next dev` — keep it committed) has the pointer to read
  `node_modules/next/dist/docs/` before assuming anything about Next.js
  APIs matches training data; this version has real breaking changes.
- `src/proxy.ts`/`middleware.ts` uses `getSession()` (local cookie decode),
  not `getUser()` (network round-trip), purely for *routing* — which page
  shell to render. It is never the authorization boundary; RLS is. Don't
  "fix" this to `getUser()` for security reasons, it isn't a security gap
  — every real data query independently goes through RLS.
- Forwarding user id/email as request headers from the proxy to skip a
  `getUser()` call downstream was tried and reverted — it didn't reliably
  survive Server Action requests under OpenNext's experimental Cloudflare
  "Node.js middleware" runtime (a trainee-creation submit silently bounced
  to `/login`). Pages/actions call `supabase.auth.getUser()` directly.
- `src/lib/supabase/types.ts` is hand-written (no live Supabase project to
  `supabase gen types` against from this sandbox). Every table needs
  `Relationships: []` and the schema needs `Views`/`Functions` populated
  (even as `Record<string, never>`) or `@supabase/postgrest-js`'s generic
  constraints silently degrade column types to `never`.
- The max-2-workouts-per-day limit is enforced twice on purpose: a
  friendly check in the Server Action (fast, nice message) and a DB
  trigger (`enforce_max_workouts_per_day`, migration `0009`, superseding
  migration `0006`'s flat max-10-per-program version) as the real backstop.
