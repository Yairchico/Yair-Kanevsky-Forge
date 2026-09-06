-- Soft-delete for programs.
--
-- deleteProgram used to be a hard DELETE, which cascades all the way down
-- (programs -> workouts -> workout_exercises -> workout_logs /
-- workout_completions, all "on delete cascade" per migration 0001) —
-- destroying the trainee's actual training history along with whatever
-- the trainer meant to clean up. "Deleting" a program now just hides it:
-- the row (and everything under it) stays intact, excluded from every
-- listing query and from what a trainee can read via RLS.

alter table public.programs
  add column if not exists deleted_at timestamptz;

-- migration 0006's "one program per trainee per week" unique constraint
-- would otherwise block creating a fresh program for a week whose old
-- program was soft-deleted (the old row still occupies that unique key).
-- Replace it with a partial unique index that only counts live rows.
alter table public.programs
  drop constraint if exists programs_trainee_week_key;

create unique index if not exists programs_trainee_week_active_key
  on public.programs (trainee_id, week_start_date)
  where deleted_at is null;

-- RLS is the real authorization boundary here (see CLAUDE.md), not just
-- the app's own queries — a soft-deleted program must also stop being
-- readable by its trainee directly, not only disappear from the UI.

drop policy if exists "trainee reads own published programs" on public.programs;
create policy "trainee reads own published programs" on public.programs
  for select using (trainee_id = auth.uid() and status = 'published' and deleted_at is null);

drop policy if exists "trainee reads own published workouts" on public.workouts;
create policy "trainee reads own published workouts" on public.workouts
  for select using (
    exists (
      select 1 from public.programs p
      where p.id = workouts.program_id
        and p.trainee_id = auth.uid()
        and p.status = 'published'
        and p.deleted_at is null
    )
  );

drop policy if exists "trainee reads own published workout_exercises" on public.workout_exercises;
create policy "trainee reads own published workout_exercises" on public.workout_exercises
  for select using (
    exists (
      select 1 from public.workouts w
      join public.programs p on p.id = w.program_id
      where w.id = workout_exercises.workout_id
        and p.trainee_id = auth.uid()
        and p.status = 'published'
        and p.deleted_at is null
    )
  );
