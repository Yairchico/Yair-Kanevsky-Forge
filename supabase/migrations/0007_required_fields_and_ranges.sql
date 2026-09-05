-- Two data-integrity fixes, requested together: RPE must always be in the
-- 1-10 range (planned RPE on workout_exercises, actual RPE on workout_logs),
-- and a workout_exercise's sets/reps must always be filled in — a training
-- row with no sets/reps is meaningless. Both were previously only "soft"
-- HTML min/max hints on the input; the app layer now rejects out-of-range
-- saves too (see updateWorkoutExercise / logExercisePerformance), and these
-- constraints are the DB-level backstop.
--
-- Written to be safely re-runnable (existence checks before each ADD
-- CONSTRAINT; ALTER COLUMN ... SET NOT NULL is itself a no-op if already set).

-- Backfill: this is pre-launch test data, so a sane default beats leaving
-- rows the app can no longer edit without also fixing them up first.
update public.workout_exercises set sets = 3 where sets is null;
update public.workout_exercises set reps = '8-10' where reps is null or trim(reps) = '';

alter table public.workout_exercises
  alter column sets set not null,
  alter column reps set not null;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'workout_exercises_sets_positive'
  ) then
    alter table public.workout_exercises
      add constraint workout_exercises_sets_positive check (sets > 0);
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'workout_exercises_reps_not_blank'
  ) then
    alter table public.workout_exercises
      add constraint workout_exercises_reps_not_blank check (length(trim(reps)) > 0);
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'workout_exercises_rpe_range'
  ) then
    alter table public.workout_exercises
      add constraint workout_exercises_rpe_range check (rpe is null or (rpe >= 1 and rpe <= 10));
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'workout_logs_rpe_actual_range'
  ) then
    alter table public.workout_logs
      add constraint workout_logs_rpe_actual_range check (rpe_actual is null or (rpe_actual >= 1 and rpe_actual <= 10));
  end if;
end $$;
