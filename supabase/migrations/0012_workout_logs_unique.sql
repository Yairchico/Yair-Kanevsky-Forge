-- submitWorkout (src/app/trainee/actions.ts) used to INSERT a fresh
-- workout_logs row per exercise on every submit, including a trainee
-- toggling "הגש אימון" off and back on with nothing changed — so the same
-- (workout_exercise_id, trainee_id) could end up with many duplicate rows,
-- which is exactly what showed up as repeated entries on the history page.
-- Adding a uniqueness constraint lets that action upsert instead: one log
-- row per exercise per (week-scoped) workout occurrence, updated in place
-- on resubmit rather than piling up.

-- Dedup first — an existing database can already have duplicates from the
-- old insert-always behavior, and the constraint below would fail to
-- apply over them. Keep only the most recent row per pair (ties broken by
-- id, arbitrary but deterministic).
delete from public.workout_logs
where id in (
  select id from (
    select id, row_number() over (
      partition by workout_exercise_id, trainee_id
      order by performed_at desc, id desc
    ) as rn
    from public.workout_logs
  ) ranked
  where ranked.rn > 1
);

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'workout_logs_workout_exercise_trainee_key'
  ) then
    alter table public.workout_logs
      add constraint workout_logs_workout_exercise_trainee_key
      unique (workout_exercise_id, trainee_id);
  end if;
end $$;
