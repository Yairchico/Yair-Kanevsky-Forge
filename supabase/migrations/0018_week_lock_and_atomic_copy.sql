-- Two leftovers from the security/consistency audit, both of which only
-- became easy once migration 0017 added israel_today() / week_start_of()
-- and block_copy_structure().
--
-- 1. The trainee's "week lock" in the database, not only in the app.
--    A trainee may change what they logged in the current week and the one
--    before it (and may log a future week early) — src/app/trainee/
--    actions.ts enforces that, but the RLS policies didn't: with their own
--    session token and a direct API call a trainee could still rewrite or
--    delete months-old history, or un-submit an old workout. Since training
--    blocks, that history is also what next week's targets are computed
--    from. The trainer is not affected (their own "for all" policies).
--
-- 2. "שכפול שבוע" as one transaction. The app copied a program's workouts,
--    exercises and sets with dozens of separate requests; a failure halfway
--    left a half-copied program behind. It's one function call now.
--
-- Safely re-runnable. Needs migrations 0014 and 0017.

-- ---------------------------------------------------------------------------
-- 1. Week lock
-- ---------------------------------------------------------------------------

-- May the signed-in trainee record (or change, or remove) performance on
-- this workout right now? Their own, published, not deleted program — and
-- not older than last week.
create or replace function public.trainee_can_log(p_workout_id uuid)
returns boolean
language sql
stable
security definer set search_path = public
as $$
  select exists (
    select 1
    from public.workouts w
    join public.programs p on p.id = w.program_id
    where w.id = p_workout_id
      and p.trainee_id = auth.uid()
      and p.status = 'published'
      and p.deleted_at is null
      and p.week_start_date >= public.week_start_of(public.israel_today()) - 7
  );
$$;

create or replace function public.trainee_can_log_exercise(p_workout_exercise_id uuid)
returns boolean
language sql
stable
security definer set search_path = public
as $$
  select coalesce(
    (select public.trainee_can_log(we.workout_id)
     from public.workout_exercises we
     where we.id = p_workout_exercise_id),
    false
  );
$$;

-- Used inside policies, which run with the caller's privileges. Telling a
-- trainee whether THEY may log one of THEIR OWN workouts gives nothing away.
revoke execute on function public.trainee_can_log(uuid) from public, anon;
revoke execute on function public.trainee_can_log_exercise(uuid) from public, anon;
grant execute on function public.trainee_can_log(uuid) to authenticated;
grant execute on function public.trainee_can_log_exercise(uuid) to authenticated;

-- Same three policies (insert / update / delete) on each of the four
-- performance tables, replacing migration 0013's and 0014's. What changes:
-- the week condition everywhere, and DELETE now has the same conditions as
-- the other two (it used to be just "your own row").
do $$
declare
  t text;
  v_check text;
begin
  foreach t in array array['set_logs', 'workout_logs', 'workout_exercise_completions', 'workout_completions'] loop
    v_check := case
      when t = 'workout_completions' then 'trainee_id = auth.uid() and public.trainee_can_log(workout_id)'
      else 'trainee_id = auth.uid() and public.trainee_can_log_exercise(workout_exercise_id)'
    end;

    execute format('drop policy if exists %I on public.%I', 'trainee inserts own ' || t, t);
    execute format('create policy %I on public.%I for insert with check (%s)', 'trainee inserts own ' || t, t, v_check);

    execute format('drop policy if exists %I on public.%I', 'trainee updates own ' || t, t);
    execute format(
      'create policy %I on public.%I for update using (%s) with check (%s)',
      'trainee updates own ' || t, t, v_check, v_check
    );

    execute format('drop policy if exists %I on public.%I', 'trainee deletes own ' || t, t);
    execute format('create policy %I on public.%I for delete using (%s)', 'trainee deletes own ' || t, t, v_check);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- 2. Copying a program's contents in one transaction
-- ---------------------------------------------------------------------------

-- Copies every workout, exercise and planned set of p_from into p_to, which
-- must exist and be empty. The copy is its own program: new slots, nothing
-- marked as hand-set. Trainer only.
create or replace function public.copy_program_structure(p_from uuid, p_to uuid)
returns void
language plpgsql
security definer set search_path = public
as $$
begin
  if not public.is_trainer() then
    raise exception 'Only the trainer can copy a program' using errcode = '42501';
  end if;
  if not exists (select 1 from public.programs where id = p_from) then
    raise exception 'The program to copy was not found' using errcode = 'P0002';
  end if;
  if not exists (select 1 from public.programs where id = p_to and deleted_at is null) then
    raise exception 'The new program was not found' using errcode = 'P0002';
  end if;
  if exists (select 1 from public.workouts where program_id = p_to) then
    raise exception 'The new program is not empty' using errcode = 'P0001';
  end if;
  perform public.block_copy_structure(p_from, p_to, false, false);
end;
$$;

revoke execute on function public.copy_program_structure(uuid, uuid) from public, anon;
grant execute on function public.copy_program_structure(uuid, uuid) to authenticated;
