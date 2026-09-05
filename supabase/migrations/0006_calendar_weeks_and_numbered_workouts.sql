-- Two structural changes, requested together:
--
-- 1. Programs are now tied to a real calendar week (week_start_date, the
--    Sunday that starts it — Israeli week convention) instead of being a
--    free-floating "weekly template". The trainer picks current/next/
--    next-next week when creating one; the trainee/trainer views are
--    driven by comparing week_start_date to today.
--
-- 2. Workouts drop the "one per day of the week" model entirely.
--    program_days (day_index/label) is gone; workouts now belong directly
--    to a program (workouts.program_id) and are just numbered by
--    order_index — "אימון 1", "אימון 2", ... up to 10 per program. The
--    trainer explicitly creates each one (no more lazy-create-on-first-
--    exercise).
--
-- Written to be safely re-runnable: every step is guarded (IF NOT EXISTS /
-- IF EXISTS / OR REPLACE / existence checks) in case an earlier attempt
-- got partway through before failing.

-- ---------------------------------------------------------------------------
-- programs.week_start_date
-- ---------------------------------------------------------------------------

alter table public.programs add column if not exists week_start_date date;

-- Backfill: this is pre-launch test data, so "this week" is a reasonable
-- default for anything created before this migration.
-- date_trunc('week', d) gives the ISO Monday of d's week; +1/-1 shifts
-- that to the Sunday that starts d's *Israeli* week (correct even when d
-- itself is a Sunday, which the naive `date_trunc('week', d) - 1` gets
-- wrong by a full week).
update public.programs
set week_start_date = (date_trunc('week', current_date + 1)::date - 1)
where week_start_date is null;

alter table public.programs alter column week_start_date set not null;

-- One program per trainee per calendar week.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'programs_trainee_week_key'
  ) then
    alter table public.programs
      add constraint programs_trainee_week_key unique (trainee_id, week_start_date);
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- workouts: program_day_id -> program_id
-- ---------------------------------------------------------------------------

alter table public.workouts add column if not exists program_id uuid
  references public.programs (id) on delete cascade;

-- Only relevant while program_day_id (and program_days) still exist —
-- harmless / a no-op once they're gone (see the drops below).
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'workouts' and column_name = 'program_day_id'
  ) then
    update public.workouts w
    set program_id = pd.program_id
    from public.program_days pd
    where w.program_day_id = pd.id
      and w.program_id is null;
  end if;
end $$;

-- Renumber 0-based order_index per program, preserving relative order.
with ranked as (
  select id, row_number() over (partition by program_id order by order_index, id) - 1 as rn
  from public.workouts
)
update public.workouts w
set order_index = ranked.rn
from ranked
where w.id = ranked.id
  and w.order_index is distinct from ranked.rn;

alter table public.workouts alter column program_id set not null;

-- ---------------------------------------------------------------------------
-- RLS: re-point workouts/workout_exercises policies at program_id
-- directly (they used to join through program_days) — this MUST happen
-- before dropping program_day_id below, since the old policies reference
-- it (that dependency is exactly what caused the original failure here).
-- ---------------------------------------------------------------------------

drop policy if exists "trainer manages workouts" on public.workouts;
drop policy if exists "trainee reads own published workouts" on public.workouts;

create policy "trainer manages workouts" on public.workouts
  for all using (public.is_trainer()) with check (public.is_trainer());
create policy "trainee reads own published workouts" on public.workouts
  for select using (
    exists (
      select 1 from public.programs p
      where p.id = workouts.program_id
        and p.trainee_id = auth.uid()
        and p.status = 'published'
    )
  );

drop policy if exists "trainer manages workout_exercises" on public.workout_exercises;
drop policy if exists "trainee reads own published workout_exercises" on public.workout_exercises;

create policy "trainer manages workout_exercises" on public.workout_exercises
  for all using (public.is_trainer()) with check (public.is_trainer());
create policy "trainee reads own published workout_exercises" on public.workout_exercises
  for select using (
    exists (
      select 1 from public.workouts w
      join public.programs p on p.id = w.program_id
      where w.id = workout_exercises.workout_id
        and p.trainee_id = auth.uid()
        and p.status = 'published'
    )
  );

-- ---------------------------------------------------------------------------
-- Now safe to drop program_day_id and program_days.
-- ---------------------------------------------------------------------------

alter table public.workouts drop column if exists program_day_id;
drop table if exists public.program_days;

-- Defense in depth for the "up to 10 workouts" limit (also enforced in
-- the app before insert, so the trainer gets a friendly message first).
create or replace function public.enforce_max_workouts_per_program()
returns trigger
language plpgsql
as $$
begin
  if (select count(*) from public.workouts where program_id = new.program_id) >= 10 then
    raise exception 'תוכנית יכולה להכיל עד 10 אימונים';
  end if;
  return new;
end;
$$;

drop trigger if exists workouts_max_10_per_program on public.workouts;
create trigger workouts_max_10_per_program
  before insert on public.workouts
  for each row execute procedure public.enforce_max_workouts_per_program();
