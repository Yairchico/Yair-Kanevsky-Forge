-- Split "sets" into real per-set records (planning/PLAN.md, feature 1).
--
-- Before this migration a set wasn't an entity at all: a workout_exercises
-- row carried `sets` (a count), `reps` (free text, e.g. "8-10") and
-- `weight` (free text) for every set at once, and a trainee's performance
-- was a single {weight, reps} value per exercise in workout_logs.actual_sets.
--
-- After it:
--   workout_exercise_sets — the plan: one row per set, each with its own
--                           reps range / weight / RPE target.
--   set_logs              — the performance: one row per set the trainee
--                           actually did, saved the moment they confirm it.
--
-- Nothing is deleted. workout_exercises.sets/reps/weight/rpe and
-- workout_logs.actual_sets stay in place (no longer read or written by the
-- app); a later, separate migration drops the legacy columns once the new
-- code has been in use for a while. workout_logs itself stays as the
-- exercise-level record (the trainee's free-text note).
--
-- Written to be safely re-runnable from the top, like every migration here:
-- tables/indexes are IF NOT EXISTS, policies are dropped and recreated, and
-- both backfills only touch rows that don't have new-style data yet. That
-- also means re-running this file AFTER the new app code is deployed is a
-- safe way to pick up any exercise the old code created in between
-- (an exercise with no rows in workout_exercise_sets gets them from its
-- legacy columns; anything that already has sets is left alone).

-- ---------------------------------------------------------------------------
-- workout_exercise_sets — planned sets
-- ---------------------------------------------------------------------------

create table if not exists public.workout_exercise_sets (
  id uuid primary key default gen_random_uuid(),
  workout_exercise_id uuid not null references public.workout_exercises (id) on delete cascade,
  set_index smallint not null check (set_index >= 1),
  set_type text not null default 'working' check (set_type in ('warmup', 'working', 'backoff')),
  reps_min smallint check (reps_min is null or reps_min > 0),
  reps_max smallint,
  -- Fallback for a target that isn't a number or a range ("AMRAP", "30 שנ׳", "12 לכל צד").
  reps_note text,
  weight_kg numeric(6, 2) check (weight_kg is null or weight_kg >= 0),
  -- Fallback for a non-numeric load ("משקל גוף", "גומייה אדומה").
  weight_note text,
  rpe numeric(3, 1) check (rpe is null or (rpe >= 1 and rpe <= 10)),
  -- Used by training blocks (feature 2): a trainer-edited target that
  -- automatic progression must never overwrite, and the human-readable
  -- reason a computed target is what it is. Added now to avoid another
  -- migration on this table later; unused until then.
  is_manual_override boolean not null default false,
  progression_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint workout_exercise_sets_index_key unique (workout_exercise_id, set_index),
  constraint workout_exercise_sets_reps_range check (reps_max is null or (reps_min is not null and reps_max >= reps_min)),
  -- Replaces migration 0007's "reps NOT NULL" rule: every set needs some
  -- reps target, numeric or not.
  constraint workout_exercise_sets_reps_required check (
    reps_min is not null or length(trim(coalesce(reps_note, ''))) > 0
  )
);

create index if not exists workout_exercise_sets_workout_exercise_id_idx
  on public.workout_exercise_sets (workout_exercise_id);

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists workout_exercise_sets_touch_updated_at on public.workout_exercise_sets;
create trigger workout_exercise_sets_touch_updated_at
  before update on public.workout_exercise_sets
  for each row execute procedure public.touch_updated_at();

-- ---------------------------------------------------------------------------
-- set_logs — performed sets
-- ---------------------------------------------------------------------------

create table if not exists public.set_logs (
  id uuid primary key default gen_random_uuid(),
  workout_exercise_id uuid not null references public.workout_exercises (id) on delete cascade,
  -- null = an extra set the trainee added beyond the plan (or its planned
  -- set was later removed).
  workout_exercise_set_id uuid references public.workout_exercise_sets (id) on delete set null,
  trainee_id uuid not null references public.profiles (id) on delete cascade,
  set_index smallint not null check (set_index >= 1),
  weight_kg numeric(6, 2) check (weight_kg is null or weight_kg >= 0),
  reps smallint check (reps is null or reps >= 0),
  rpe numeric(3, 1) check (rpe is null or (rpe >= 1 and rpe <= 10)),
  status text not null default 'done' check (status in ('done', 'skipped')),
  -- 'legacy' = carried over by this migration from the old one-value-per-
  -- exercise workout_logs; 'trainer_session' is for the trainer-led session
  -- mode (feature 5).
  source text not null default 'trainee' check (source in ('trainee', 'trainer_session', 'legacy')),
  logged_by uuid references public.profiles (id) on delete set null,
  logged_at timestamptz not null default now(),
  constraint set_logs_exercise_trainee_index_key unique (workout_exercise_id, trainee_id, set_index)
);

create index if not exists set_logs_trainee_logged_at_idx on public.set_logs (trainee_id, logged_at desc);
create index if not exists set_logs_workout_exercise_id_idx on public.set_logs (workout_exercise_id);

-- ---------------------------------------------------------------------------
-- Row Level Security — same shape as every other table: the trainer manages
-- the plan, the trainee reads only their own published, non-deleted plan,
-- the superadmin reads everything and writes nothing.
-- ---------------------------------------------------------------------------

alter table public.workout_exercise_sets enable row level security;
alter table public.set_logs enable row level security;

drop policy if exists "trainer manages workout_exercise_sets" on public.workout_exercise_sets;
create policy "trainer manages workout_exercise_sets" on public.workout_exercise_sets
  for all using (public.is_trainer()) with check (public.is_trainer());

drop policy if exists "superadmin reads all workout_exercise_sets" on public.workout_exercise_sets;
create policy "superadmin reads all workout_exercise_sets" on public.workout_exercise_sets
  for select using (public.is_superadmin());

drop policy if exists "trainee reads own published workout_exercise_sets" on public.workout_exercise_sets;
create policy "trainee reads own published workout_exercise_sets" on public.workout_exercise_sets
  for select using (
    exists (
      select 1 from public.workout_exercises we
      join public.workouts w on w.id = we.workout_id
      join public.programs p on p.id = w.program_id
      where we.id = workout_exercise_sets.workout_exercise_id
        and p.trainee_id = auth.uid()
        and p.status = 'published'
        and p.deleted_at is null
    )
  );

-- Write access for the trainer arrives with the trainer-led session mode
-- (feature 5); until then the trainer only reads performance, as with
-- workout_logs today.
drop policy if exists "trainer reads all set_logs" on public.set_logs;
create policy "trainer reads all set_logs" on public.set_logs
  for select using (public.is_trainer());

drop policy if exists "superadmin reads all set_logs" on public.set_logs;
create policy "superadmin reads all set_logs" on public.set_logs
  for select using (public.is_superadmin());

drop policy if exists "trainee reads own set_logs" on public.set_logs;
create policy "trainee reads own set_logs" on public.set_logs
  for select using (trainee_id = auth.uid());

-- Unlike workout_logs (a plain trainee_id = auth.uid() "for all" policy —
-- PLAN.md's RLS review noted a trainee could technically log against any
-- workout_exercise id), a trainee may only write sets for an exercise in
-- their own published, non-deleted program.
drop policy if exists "trainee inserts own set_logs" on public.set_logs;
create policy "trainee inserts own set_logs" on public.set_logs
  for insert with check (
    trainee_id = auth.uid()
    and exists (
      select 1 from public.workout_exercises we
      join public.workouts w on w.id = we.workout_id
      join public.programs p on p.id = w.program_id
      where we.id = set_logs.workout_exercise_id
        and p.trainee_id = auth.uid()
        and p.status = 'published'
        and p.deleted_at is null
    )
  );

drop policy if exists "trainee updates own set_logs" on public.set_logs;
create policy "trainee updates own set_logs" on public.set_logs
  for update using (trainee_id = auth.uid()) with check (
    trainee_id = auth.uid()
    and exists (
      select 1 from public.workout_exercises we
      join public.workouts w on w.id = we.workout_id
      join public.programs p on p.id = w.program_id
      where we.id = set_logs.workout_exercise_id
        and p.trainee_id = auth.uid()
        and p.status = 'published'
        and p.deleted_at is null
    )
  );

drop policy if exists "trainee deletes own set_logs" on public.set_logs;
create policy "trainee deletes own set_logs" on public.set_logs
  for delete using (trainee_id = auth.uid());

-- ---------------------------------------------------------------------------
-- Legacy columns: stop requiring them (the app no longer writes them).
-- Migration 0007's CHECKs stay — they pass for NULL.
-- ---------------------------------------------------------------------------

alter table public.workout_exercises alter column sets drop not null;
alter table public.workout_exercises alter column reps drop not null;

-- ---------------------------------------------------------------------------
-- Backfill 1: planned sets from workout_exercises.sets/reps/weight/rpe.
--
-- reps:   "8"      -> reps_min = reps_max = 8
--         "8-10"   -> reps_min = 8, reps_max = 10   (also "8 - 10", "8–10")
--         anything else -> reps_note, verbatim
-- weight: "80", "82.5", "82,5", "80 ק"ג", "80kg" -> weight_kg
--         anything else non-empty -> weight_note, verbatim
-- Every set of an exercise gets the same values (that's all the old model
-- could express). Set counts are capped at 20 as a sanity guard.
-- ---------------------------------------------------------------------------

with legacy as (
  select
    we.id as workout_exercise_id,
    least(greatest(coalesce(we.sets, 1), 1), 20) as set_count,
    trim(coalesce(we.reps, '')) as reps_text,
    nullif(trim(coalesce(we.weight, '')), '') as weight_text,
    we.rpe
  from public.workout_exercises we
  where not exists (
    select 1 from public.workout_exercise_sets s where s.workout_exercise_id = we.id
  )
),
parsed as (
  select
    l.workout_exercise_id,
    l.set_count,
    l.rpe,
    case
      when l.reps_text ~ '^\d{1,3}$' then l.reps_text::smallint
      when l.reps_text ~ '^\d{1,3}\s*[-–]\s*\d{1,3}$'
        and split_part(regexp_replace(l.reps_text, '\s*[-–]\s*', '-'), '-', 1)::int
            <= split_part(regexp_replace(l.reps_text, '\s*[-–]\s*', '-'), '-', 2)::int
        then split_part(regexp_replace(l.reps_text, '\s*[-–]\s*', '-'), '-', 1)::smallint
    end as reps_min,
    case
      when l.reps_text ~ '^\d{1,3}$' then l.reps_text::smallint
      when l.reps_text ~ '^\d{1,3}\s*[-–]\s*\d{1,3}$'
        and split_part(regexp_replace(l.reps_text, '\s*[-–]\s*', '-'), '-', 1)::int
            <= split_part(regexp_replace(l.reps_text, '\s*[-–]\s*', '-'), '-', 2)::int
        then split_part(regexp_replace(l.reps_text, '\s*[-–]\s*', '-'), '-', 2)::smallint
    end as reps_max,
    l.reps_text,
    l.weight_text,
    case
      when l.weight_text ~* '^\d{1,4}([.,]\d{1,2})?\s*(ק"ג|ק״ג|קג|kg)?$'
        then replace(substring(l.weight_text from '^\d{1,4}(?:[.,]\d{1,2})?'), ',', '.')::numeric(6, 2)
    end as weight_kg
  from legacy l
)
insert into public.workout_exercise_sets
  (workout_exercise_id, set_index, reps_min, reps_max, reps_note, weight_kg, weight_note, rpe)
select
  p.workout_exercise_id,
  gs.n,
  -- A reps_min of 0 ("0" reps) isn't a valid target; keep it as a note.
  case when p.reps_min > 0 then p.reps_min end,
  case when p.reps_min > 0 then p.reps_max end,
  case
    when p.reps_min > 0 then null
    when p.reps_text <> '' then p.reps_text
    else '8-10' -- unreachable in practice (0007 made reps required), but the new CHECK needs something
  end,
  p.weight_kg,
  case when p.weight_kg is null then p.weight_text end,
  p.rpe
from parsed p
cross join lateral generate_series(1, p.set_count) as gs (n)
on conflict (workout_exercise_id, set_index) do nothing;

-- ---------------------------------------------------------------------------
-- Backfill 2: performed sets from workout_logs.actual_sets.
--
-- The old model stored ONE {weight, reps} per exercise, with no way to tell
-- whether that was every set or just one. Rather than invent sets that may
-- not have happened, each old log becomes a single set_logs row (set 1),
-- marked source = 'legacy' so the UI can label it ("מלפני פיצול הסטים").
-- Values that don't parse as numbers stay only in workout_logs, which is
-- left untouched. (QUESTIONS.md Q1.2.)
-- ---------------------------------------------------------------------------

with legacy_logs as (
  select
    wl.workout_exercise_id,
    wl.trainee_id,
    wl.performed_at,
    wl.rpe_actual,
    nullif(trim(coalesce(wl.actual_sets ->> 'weight', '')), '') as weight_text,
    nullif(trim(coalesce(wl.actual_sets ->> 'reps', '')), '') as reps_text
  from public.workout_logs wl
  where wl.actual_sets is not null
    and jsonb_typeof(wl.actual_sets) = 'object'
),
parsed_logs as (
  select
    ll.*,
    case
      when ll.weight_text ~* '^\d{1,4}([.,]\d{1,2})?\s*(ק"ג|ק״ג|קג|kg)?$'
        then replace(substring(ll.weight_text from '^\d{1,4}(?:[.,]\d{1,2})?'), ',', '.')::numeric(6, 2)
    end as weight_kg,
    case when ll.reps_text ~ '^\d{1,3}$' then ll.reps_text::smallint end as reps
  from legacy_logs ll
)
insert into public.set_logs
  (workout_exercise_id, workout_exercise_set_id, trainee_id, set_index, weight_kg, reps, rpe,
   status, source, logged_by, logged_at)
select
  pl.workout_exercise_id,
  (select s.id from public.workout_exercise_sets s
    where s.workout_exercise_id = pl.workout_exercise_id and s.set_index = 1),
  pl.trainee_id,
  1,
  pl.weight_kg,
  pl.reps,
  pl.rpe_actual,
  'done',
  'legacy',
  pl.trainee_id,
  pl.performed_at
from parsed_logs pl
where pl.weight_kg is not null or pl.reps is not null
on conflict (workout_exercise_id, trainee_id, set_index) do nothing;

-- ---------------------------------------------------------------------------
-- Report what happened (shows up in the SQL editor's output), so values
-- that didn't parse are visible rather than silent.
-- ---------------------------------------------------------------------------

do $$
declare
  planned_sets integer;
  reps_notes integer;
  weight_notes integer;
  legacy_set_logs integer;
  unparsed_logs integer;
begin
  select count(*) into planned_sets from public.workout_exercise_sets;
  select count(*) into reps_notes from public.workout_exercise_sets where reps_note is not null;
  select count(*) into weight_notes from public.workout_exercise_sets where weight_note is not null;
  select count(*) into legacy_set_logs from public.set_logs where source = 'legacy';
  select count(*) into unparsed_logs
    from public.workout_logs wl
    where wl.actual_sets is not null
      and (nullif(trim(coalesce(wl.actual_sets ->> 'weight', '')), '') is not null
        or nullif(trim(coalesce(wl.actual_sets ->> 'reps', '')), '') is not null)
      and not exists (
        select 1 from public.set_logs sl
        where sl.workout_exercise_id = wl.workout_exercise_id
          and sl.trainee_id = wl.trainee_id
          and sl.source = 'legacy'
      );
  raise notice 'workout_exercise_sets: % rows (% with a non-numeric reps note, % with a non-numeric weight note)',
    planned_sets, reps_notes, weight_notes;
  raise notice 'set_logs carried over from workout_logs: % (old logs whose values did not parse, kept only in workout_logs: %)',
    legacy_set_logs, unparsed_logs;
end $$;
