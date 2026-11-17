-- The three pieces of planning/PLAN.md that were left for later:
--
-- 1. Uploading an exercise video (feature 4, phase B): a public Storage
--    bucket "exercise-videos" (50MB per file, mp4/mov/webm), the trainer
--    alone writes to it, and exercises.video_storage_path says which file
--    belongs to which exercise. The file goes from the browser straight to
--    Storage with a signed upload URL — never through the Worker, which
--    can't carry 50MB.
--
-- 2. "הוסף לתוכנית של מתאמן" (feature 5c, Q5.12): a saved workout copied
--    into a trainee's weekly program as a new workout on a chosen day.
--
-- 3. "המר שבועות קיימים לבלוק" (feature 2, Q2.8): weekly programs the
--    trainee already has become the first weeks of a training block, with
--    the same exercise recognised from week to week, optionally followed by
--    new, computed weeks.
--
-- Purely additive; the previously deployed code ignores all of it. Safely
-- re-runnable. Needs migrations 0016 and 0017.

-- ---------------------------------------------------------------------------
-- 1. Exercise videos in our own Storage
-- ---------------------------------------------------------------------------

-- "<exercise id>/<random id>.<ext>". Either a pasted link (video_url) or an
-- uploaded file, never both. The public URL isn't stored: it's derived from
-- the project URL, so the database never holds a host name.
alter table public.exercises add column if not exists video_storage_path text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'exercises_video_storage_path_format') then
    alter table public.exercises add constraint exercises_video_storage_path_format
      check (
        video_storage_path is null
        or video_storage_path ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}\.(mp4|mov|webm)$'
      );
  end if;
  if not exists (select 1 from pg_constraint where conname = 'exercises_one_video') then
    alter table public.exercises add constraint exercises_one_video
      check (video_url is null or video_storage_path is null);
  end if;
end $$;

-- Public read (the <video> tag loads it with no auth headers). The size and
-- type limits are enforced by Storage itself on upload, whatever the client
-- claims.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('exercise-videos', 'exercise-videos', true, 52428800, array['video/mp4', 'video/quicktime', 'video/webm'])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "public reads exercise-videos" on storage.objects;
create policy "public reads exercise-videos" on storage.objects
  for select using (bucket_id = 'exercise-videos');

-- Only the trainer writes, and only under a name of the expected shape.
drop policy if exists "trainer manages exercise-videos" on storage.objects;
create policy "trainer manages exercise-videos" on storage.objects
  for all
  using (bucket_id = 'exercise-videos' and public.is_trainer())
  with check (
    bucket_id = 'exercise-videos'
    and public.is_trainer()
    and name ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}\.(mp4|mov|webm)$'
  );

-- ---------------------------------------------------------------------------
-- 2. A saved workout into a trainee's weekly program
-- ---------------------------------------------------------------------------

-- Copies the saved workout (exercises, rest, notes, target sets) into the
-- trainee's program for p_week_start as a new workout on p_day_of_week. If
-- the trainee has no program that week, a draft one is created (titled
-- p_program_title, or the saved workout's title). A published program goes
-- back to draft, like any other edit of the trainer's, so the change isn't
-- seen before the trainer publishes it again.
--
-- Errors: BK003 "DAY_FULL" — that day already has two workouts.
create or replace function public.add_template_to_program(
  p_template_id uuid,
  p_trainee_id uuid,
  p_week_start date,
  p_day_of_week integer,
  p_program_title text default null
)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  v_template public.session_templates%rowtype;
  v_current_week date := public.week_start_of(public.israel_today());
  v_program public.programs%rowtype;
  v_created boolean := false;
  v_reverted boolean := false;
  v_order integer;
  v_workout uuid;
  v_ex record;
  v_new_ex uuid;
begin
  if not public.is_trainer() then
    raise exception 'Only the trainer can change a program' using errcode = '42501';
  end if;

  select * into v_template from public.session_templates where id = p_template_id and deleted_at is null;
  if not found then
    raise exception 'Saved workout not found' using errcode = 'P0002';
  end if;
  if not exists (select 1 from public.session_template_exercises where template_id = p_template_id) then
    raise exception 'The saved workout has no exercises' using errcode = 'P0001';
  end if;
  if not exists (
    select 1 from public.profiles p where p.id = p_trainee_id and p.role = 'trainee' and not p.is_superadmin
  ) then
    raise exception 'Trainee not found' using errcode = 'P0002';
  end if;
  if p_week_start is null or extract(dow from p_week_start) <> 0
     or p_week_start < v_current_week or p_week_start > v_current_week + 7 * 26 then
    raise exception 'A week from this week on, starting on a Sunday' using errcode = 'P0001';
  end if;
  if p_day_of_week is null or p_day_of_week < 0 or p_day_of_week > 6 then
    raise exception 'Day of week out of range' using errcode = 'P0001';
  end if;
  if p_program_title is not null and char_length(trim(p_program_title)) > 120 then
    raise exception 'Title too long' using errcode = 'P0001';
  end if;

  select * into v_program
  from public.programs
  where trainee_id = p_trainee_id and week_start_date = p_week_start and deleted_at is null;

  if not found then
    insert into public.programs (trainee_id, title, week_start_date)
    values (p_trainee_id, coalesce(nullif(trim(coalesce(p_program_title, '')), ''), v_template.title), p_week_start)
    returning * into v_program;
    v_created := true;
  end if;

  -- The day's first free slot (0 or 1); the 0009 trigger is the backstop.
  select min(slot) into v_order
  from (values (0), (1)) s(slot)
  where not exists (
    select 1 from public.workouts w
    where w.program_id = v_program.id and w.day_of_week = p_day_of_week and w.order_index = s.slot
  );
  if v_order is null or (
    select count(*) from public.workouts w where w.program_id = v_program.id and w.day_of_week = p_day_of_week
  ) >= 2 then
    raise exception 'DAY_FULL' using errcode = 'BK003';
  end if;

  insert into public.workouts (program_id, day_of_week, order_index)
  values (v_program.id, p_day_of_week, v_order)
  returning id into v_workout;

  for v_ex in
    select * from public.session_template_exercises where template_id = p_template_id order by order_index, id
  loop
    insert into public.workout_exercises (workout_id, exercise_id, order_index, rest_seconds, instructions)
    values (v_workout, v_ex.exercise_id, v_ex.order_index, v_ex.rest_seconds, v_ex.instructions)
    returning id into v_new_ex;

    insert into public.workout_exercise_sets
      (workout_exercise_id, set_index, set_type, reps_min, reps_max, reps_note, weight_kg, weight_note, rpe)
    select v_new_ex, s.set_index, s.set_type, s.reps_min, s.reps_max, s.reps_note, s.weight_kg, s.weight_note, s.rpe
    from public.session_template_sets s
    where s.template_exercise_id = v_ex.id;
  end loop;

  if v_program.status = 'published' then
    update public.programs set status = 'draft', published_at = null, updated_at = now() where id = v_program.id;
    v_reverted := true;
  end if;

  return jsonb_build_object(
    'program_id', v_program.id,
    'workout_id', v_workout,
    'created_program', v_created,
    'reverted_to_draft', v_reverted
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. Existing weeks into a block
-- ---------------------------------------------------------------------------

-- Makes existing weekly programs of a trainee the weeks of a new training
-- block, in calendar order, and optionally adds p_extra_weeks new weeks
-- after them (copied from the last one, their targets computed).
--
-- Recognising "the same exercise" from one week to the next: within the
-- same workout (same day, 1st or 2nd that day) an exercise matches the
-- exercise in the week before that is the same library exercise, in the
-- same order of occurrence. What's still unmatched then — say the squat
-- moved from Sunday to Monday — matches by exercise anywhere in the week,
-- when it appears exactly once on each side. Everything else starts a
-- chain of its own.
--
-- Existing targets are the trainer's own numbers: in the converted weeks
-- every set of a recognised exercise is marked as set by hand, so nothing
-- the trainer planned is recomputed. A rule set on the last converted week
-- then drives the added weeks. "שחזר לאוטומטי" hands a set to the engine.
--
-- Errors: BK001 a week for the added weeks is taken; BK004 a program is
-- already part of a block.
create or replace function public.convert_programs_to_block(
  p_trainee_id uuid,
  p_title text,
  p_program_ids uuid[],
  p_extra_weeks integer default 0,
  p_deload_weeks integer[] default '{}',
  p_deload_pct integer default 60,
  p_auto_publish boolean default false
)
returns uuid
language plpgsql
security definer set search_path = public
as $$
declare
  v_ids uuid[];
  v_count integer;
  v_extra integer := coalesce(p_extra_weeks, 0);
  v_deload integer[] := coalesce(p_deload_weeks, '{}');
  v_block uuid;
  v_prog record;
  v_prev uuid;
  v_last record;
  v_first_extra date;
  v_date date;
  v_i integer;
  v_pair record;
begin
  if not public.is_trainer() then
    raise exception 'Only the trainer can create a block' using errcode = '42501';
  end if;
  if not exists (
    select 1 from public.profiles p where p.id = p_trainee_id and p.role = 'trainee' and not p.is_superadmin
  ) then
    raise exception 'Trainee not found' using errcode = 'P0002';
  end if;
  if length(trim(coalesce(p_title, ''))) = 0 or char_length(p_title) > 120 then
    raise exception 'A title of up to 120 characters is required' using errcode = 'P0001';
  end if;

  select array_agg(distinct x) into v_ids from unnest(coalesce(p_program_ids, '{}')) x where x is not null;
  v_count := coalesce(array_length(v_ids, 1), 0);
  if v_count = 0 then
    raise exception 'Choose at least one week' using errcode = 'P0001';
  end if;
  if v_extra < 0 or v_count + v_extra > 16 then
    raise exception 'A block is 1 to 16 weeks long' using errcode = 'P0001';
  end if;
  if exists (select 1 from unnest(v_deload) d where d is null or d <= v_count or d > v_count + v_extra) then
    raise exception 'A deload week is one of the added weeks' using errcode = 'P0001';
  end if;
  if p_deload_pct is null or p_deload_pct < 30 or p_deload_pct > 100 then
    raise exception 'The deload percentage is 30 to 100' using errcode = 'P0001';
  end if;
  if (
    select count(*) from public.programs p
    where p.id = any (v_ids) and p.trainee_id = p_trainee_id and p.deleted_at is null
  ) <> v_count then
    raise exception 'A chosen week was not found' using errcode = 'P0002';
  end if;
  if exists (select 1 from public.programs p where p.id = any (v_ids) and p.block_id is not null) then
    raise exception 'ALREADY_IN_BLOCK' using errcode = 'BK004';
  end if;

  -- The added weeks follow the last chosen one, but never start in the past.
  select p.id, p.week_start_date into v_last
  from public.programs p where p.id = any (v_ids) order by p.week_start_date desc limit 1;
  v_first_extra := greatest(v_last.week_start_date + 7, public.week_start_of(public.israel_today()));
  for v_i in 1..v_extra loop
    v_date := v_first_extra + 7 * (v_i - 1);
    if exists (
      select 1 from public.programs p
      where p.trainee_id = p_trainee_id and p.week_start_date = v_date and p.deleted_at is null
    ) then
      raise exception 'WEEK_TAKEN %', v_date using errcode = 'BK001';
    end if;
  end loop;

  insert into public.blocks (
    trainee_id, title, weeks_count, default_deload_pct, auto_publish_next_week, created_by
  )
  values (
    p_trainee_id, trim(p_title), v_count + v_extra, p_deload_pct, coalesce(p_auto_publish, false), auth.uid()
  )
  returning id into v_block;
  perform public.block_lock(v_block);

  v_i := 0;
  v_prev := null;
  for v_prog in
    select p.id from public.programs p where p.id = any (v_ids) order by p.week_start_date
  loop
    v_i := v_i + 1;
    update public.programs set block_id = v_block, block_week_index = v_i, is_deload = false, deload_pct = null
    where id = v_prog.id;

    if v_prev is not null then
      -- (a) the same workout: same day, same position that day
      update public.workouts cur
      set slot_key = prev.slot_key
      from public.workouts prev
      where cur.program_id = v_prog.id and prev.program_id = v_prev
        and cur.day_of_week = prev.day_of_week and cur.order_index = prev.order_index;

      -- (b) inside matched workouts: the same exercise, n-th occurrence to n-th occurrence
      for v_pair in
        with c as (
          select we.id, we.workout_id, w.slot_key as wslot, we.exercise_id,
                 row_number() over (partition by we.workout_id, we.exercise_id order by we.order_index, we.id) n
          from public.workout_exercises we join public.workouts w on w.id = we.workout_id
          where w.program_id = v_prog.id
        ), p as (
          select we.slot_key, w.slot_key as wslot, we.exercise_id,
                 row_number() over (partition by we.workout_id, we.exercise_id order by we.order_index, we.id) n
          from public.workout_exercises we join public.workouts w on w.id = we.workout_id
          where w.program_id = v_prev
        )
        select c.id, p.slot_key from c join p on p.wslot = c.wslot and p.exercise_id = c.exercise_id and p.n = c.n
      loop
        update public.workout_exercises set slot_key = v_pair.slot_key where id = v_pair.id;
      end loop;

      -- (c) what's left: the same exercise once on each side, anywhere in the week
      for v_pair in
        with c as (
          select we.id, we.exercise_id
          from public.workout_exercises we join public.workouts w on w.id = we.workout_id
          where w.program_id = v_prog.id
            and not exists (
              select 1 from public.workout_exercises o join public.workouts ow on ow.id = o.workout_id
              where ow.program_id = v_prev and o.slot_key = we.slot_key
            )
        ), p as (
          select we.slot_key, we.exercise_id
          from public.workout_exercises we join public.workouts w on w.id = we.workout_id
          where w.program_id = v_prev
            and not exists (
              select 1 from public.workout_exercises o join public.workouts ow on ow.id = o.workout_id
              where ow.program_id = v_prog.id and o.slot_key = we.slot_key
            )
        ), c1 as (
          select exercise_id, min(id::text)::uuid id from c group by exercise_id having count(*) = 1
        ), p1 as (
          select exercise_id, min(slot_key::text)::uuid slot_key from p group by exercise_id having count(*) = 1
        )
        select c1.id, p1.slot_key from c1 join p1 using (exercise_id)
      loop
        update public.workout_exercises set slot_key = v_pair.slot_key where id = v_pair.id;
      end loop;

      -- The trainer's own numbers stay the trainer's own.
      update public.workout_exercise_sets s
      set is_manual_override = true
      from public.workout_exercises we
      join public.workouts w on w.id = we.workout_id
      where s.workout_exercise_id = we.id
        and w.program_id = v_prog.id
        and exists (
          select 1 from public.workout_exercises o
          join public.workouts ow on ow.id = o.workout_id
          join public.programs op on op.id = ow.program_id
          where op.block_id = v_block and op.block_week_index < v_i and o.slot_key = we.slot_key
        );
    end if;
    v_prev := v_prog.id;
  end loop;

  for v_i in 1..v_extra loop
    insert into public.programs (trainee_id, title, week_start_date, block_id, block_week_index, is_deload)
    values (
      p_trainee_id, trim(p_title), v_first_extra + 7 * (v_i - 1), v_block, v_count + v_i, (v_count + v_i) = any (v_deload)
    );
  end loop;

  if v_extra > 0 then
    -- The added weeks get the last chosen week's structure.
    perform public.block_apply_structure_internal(v_last.id);
  end if;
  -- Every week from the second on: why its targets are what they are.
  perform public.block_recompute_internal(v_block, 2);

  return v_block;
end;
$$;

revoke execute on function public.add_template_to_program(uuid, uuid, date, integer, text) from public, anon;
revoke execute on function public.convert_programs_to_block(uuid, text, uuid[], integer, integer[], integer, boolean) from public, anon;
grant execute on function public.add_template_to_program(uuid, uuid, date, integer, text) to authenticated;
grant execute on function public.convert_programs_to_block(uuid, text, uuid[], integer, integer[], integer, boolean) to authenticated;
