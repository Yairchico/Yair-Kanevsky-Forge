-- Lets a trainee mark each exercise in a workout as done individually
-- (separate from workout_completions, which marks the whole workout as
-- "submitted"). Kept as its own table rather than repurposing
-- workout_logs, since workout_logs is reserved for actual performance
-- entry (weights/reps used) — a checkbox and a performance record are
-- different things, even though both aren't fully built out yet.

create table public.workout_exercise_completions (
  id uuid primary key default gen_random_uuid(),
  workout_exercise_id uuid not null references public.workout_exercises (id) on delete cascade,
  trainee_id uuid not null references public.profiles (id) on delete cascade,
  completed_at timestamptz not null default now(),
  unique (workout_exercise_id, trainee_id)
);

create index workout_exercise_completions_trainee_id_idx
  on public.workout_exercise_completions (trainee_id);

alter table public.workout_exercise_completions enable row level security;

create policy "trainer reads all workout_exercise_completions" on public.workout_exercise_completions
  for select using (public.is_trainer());
create policy "trainee manages own workout_exercise_completions" on public.workout_exercise_completions
  for all using (trainee_id = auth.uid()) with check (trainee_id = auth.uid());
