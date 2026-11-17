-- 0020: one round trip instead of several when a set is confirmed.
--
-- Confirming a set (✓) is the most frequent write in the app, and before
-- writing it the server has to know a few things about the exercise: which
-- workout and program it belongs to (whose it is, which week, published or
-- not, in a training block or not), which sets are planned for it, and
-- which were already performed. Until now those were up to five separate
-- queries, one after the other — and the database is far from the server,
-- so every query is a noticeable wait.
--
-- set_log_context(workout_exercise_id) returns all of it at once, as jsonb.
--
-- SECURITY INVOKER on purpose: it runs with the caller's own rights, so
-- Row Level Security decides what it returns exactly as it does for the
-- separate queries it replaces — a trainee gets an answer only for an
-- exercise of their own published, non-deleted program; the trainer and
-- the read-only viewer for any; anyone else gets NULL. It only reads.
--
-- The app keeps working without this migration (it falls back to the
-- separate queries when the function doesn't exist), so the order of
-- "run the migration" and "deploy the code" doesn't matter — it's just
-- slower until the migration has run. Safe to re-run.

create or replace function public.set_log_context(p_workout_exercise_id uuid)
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  select jsonb_build_object(
    'workout_id', w.id,
    'program_id', p.id,
    'trainee_id', p.trainee_id,
    'week_start_date', p.week_start_date,
    'status', p.status,
    'deleted_at', p.deleted_at,
    'block_id', p.block_id,
    -- the plan of this exercise, one entry per set
    'planned', coalesce(
      (
        select jsonb_agg(
          jsonb_build_object('id', s.id, 'set_index', s.set_index, 'set_type', s.set_type)
          order by s.set_index
        )
        from public.workout_exercise_sets s
        where s.workout_exercise_id = we.id
      ),
      '[]'::jsonb
    ),
    -- which sets the program's trainee has already performed
    'logged', coalesce(
      (
        select jsonb_agg(l.set_index order by l.set_index)
        from public.set_logs l
        where l.workout_exercise_id = we.id
          and l.trainee_id = p.trainee_id
          and l.status = 'done'
      ),
      '[]'::jsonb
    )
  )
  from public.workout_exercises we
  join public.workouts w on w.id = we.workout_id
  join public.programs p on p.id = w.program_id
  where we.id = p_workout_exercise_id
$$;

revoke execute on function public.set_log_context(uuid) from public, anon;
grant execute on function public.set_log_context(uuid) to authenticated;
