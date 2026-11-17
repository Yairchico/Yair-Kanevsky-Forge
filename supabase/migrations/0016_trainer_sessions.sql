-- Trainer-led sessions (planning/PLAN.md, features 5, 5b, 5c).
--
-- 5.  A session with a trainee, from their weekly plan: the trainer enters
--     the sets. It is stored exactly like a workout the trainee logged
--     themselves — same set_logs / workout_logs / workout_completions rows,
--     under the trainee's id — so history, "last time" and (later) block
--     progression need no special case. What changes here: the trainer may
--     now WRITE those tables (until now read-only), and a completion records
--     who made it.
--
-- 5b. A free session: not tied to any trainee or program. Exercises are
--     picked on the fly; it can be assigned to a trainee afterwards (or
--     never). It can't live in set_logs — that table hangs off a program's
--     workout_exercise and a trainee — so it gets three small tables of its
--     own.
--
-- 5c. Saved workouts (templates): a reusable list of exercises with target
--     sets. Starting one creates a free session with the targets COPIED into
--     it, so editing the template later never rewrites what a past
--     session's targets were.
--
-- Purely additive (the previously deployed code ignores all of it) and
-- safely re-runnable.

-- ---------------------------------------------------------------------------
-- 5. The trainer writes performance on a trainee's behalf
-- ---------------------------------------------------------------------------

-- "for all" covers SELECT too; the old read-only policies would be redundant.
drop policy if exists "trainer reads all set_logs" on public.set_logs;
drop policy if exists "trainer manages set_logs" on public.set_logs;
create policy "trainer manages set_logs" on public.set_logs
  for all using (public.is_trainer()) with check (public.is_trainer());

drop policy if exists "trainer reads all workout_logs" on public.workout_logs;
drop policy if exists "trainer manages workout_logs" on public.workout_logs;
create policy "trainer manages workout_logs" on public.workout_logs
  for all using (public.is_trainer()) with check (public.is_trainer());

drop policy if exists "trainer reads all workout_completions" on public.workout_completions;
drop policy if exists "trainer manages workout_completions" on public.workout_completions;
create policy "trainer manages workout_completions" on public.workout_completions
  for all using (public.is_trainer()) with check (public.is_trainer());

drop policy if exists "trainer reads all workout_exercise_completions"
  on public.workout_exercise_completions;
drop policy if exists "trainer manages workout_exercise_completions"
  on public.workout_exercise_completions;
create policy "trainer manages workout_exercise_completions"
  on public.workout_exercise_completions
  for all using (public.is_trainer()) with check (public.is_trainer());

-- Who completed the workout, and how. `source` is what the history screens
-- use for the "אימון אישי עם המאמן" tag; `notes` is the session's overall note.
alter table public.workout_completions
  add column if not exists source text not null default 'trainee',
  add column if not exists completed_by uuid references public.profiles (id) on delete set null,
  add column if not exists notes text;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'workout_completions_source_check'
  ) then
    alter table public.workout_completions
      add constraint workout_completions_source_check
      check (source in ('trainee', 'trainer_session'));
  end if;
end $$;

-- Extends migration 0014's trigger: the trainee_id of a performance row must
-- be the program's trainee (unchanged — and now the thing that keeps a
-- trainer write honest too), and who-did-it columns are decided here, never
-- by the client.
create or replace function public.enforce_performance_owner()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  v_owner uuid;
begin
  if tg_table_name = 'workout_completions' then
    select p.trainee_id into v_owner
    from public.workouts w
    join public.programs p on p.id = w.program_id
    where w.id = new.workout_id;
  else
    select p.trainee_id into v_owner
    from public.workout_exercises we
    join public.workouts w on w.id = we.workout_id
    join public.programs p on p.id = w.program_id
    where we.id = new.workout_exercise_id;
  end if;

  -- A missing parent is the foreign key's job to report (23503).
  if v_owner is not null and v_owner is distinct from new.trainee_id then
    raise exception 'This workout does not belong to that trainee'
      using errcode = '23514';
  end if;

  if tg_table_name = 'set_logs' then
    -- A link to a planned set is only kept when it really is this exercise's
    -- set at this index.
    if new.workout_exercise_set_id is not null and not exists (
      select 1 from public.workout_exercise_sets s
      where s.id = new.workout_exercise_set_id
        and s.workout_exercise_id = new.workout_exercise_id
        and s.set_index = new.set_index
    ) then
      new.workout_exercise_set_id := null;
    end if;

    -- The latest writer of a set is who logged it. (Direct SQL — e.g.
    -- migration 0013's 'legacy' backfill — is left alone.)
    if auth.role() = 'authenticated' then
      new.logged_by := auth.uid();
      new.source := case when auth.uid() = new.trainee_id then 'trainee' else 'trainer_session' end;
    end if;
  end if;

  if tg_table_name = 'workout_completions' then
    if tg_op = 'INSERT' then
      if auth.role() = 'authenticated' then
        new.completed_by := auth.uid();
        new.source := case when auth.uid() = new.trainee_id then 'trainee' else 'trainer_session' end;
      end if;
    else
      -- Whoever submitted it first stays on record: the trainer adding a note
      -- to a workout the trainee submitted doesn't turn it into a session.
      new.source := old.source;
      new.completed_by := old.completed_by;
    end if;
  end if;

  return new;
end;
$$;

revoke execute on function public.enforce_performance_owner() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 5c. Saved workouts (templates)
-- ---------------------------------------------------------------------------

create table if not exists public.session_templates (
  id uuid primary key default gen_random_uuid(),
  title text not null check (length(trim(title)) > 0 and char_length(title) <= 120),
  notes text check (notes is null or char_length(notes) <= 1000),
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Soft delete, so sessions that were started from it can still say where
  -- they came from.
  deleted_at timestamptz
);

create table if not exists public.session_template_exercises (
  id uuid primary key default gen_random_uuid(),
  template_id uuid not null references public.session_templates (id) on delete cascade,
  exercise_id uuid not null references public.exercises (id) on delete restrict,
  order_index integer not null default 0,
  rest_seconds integer check (rest_seconds is null or rest_seconds >= 0),
  instructions text check (instructions is null or char_length(instructions) <= 1000)
);

create index if not exists session_template_exercises_template_id_idx
  on public.session_template_exercises (template_id);

-- Same target columns and rules as workout_exercise_sets (migration 0013).
create table if not exists public.session_template_sets (
  id uuid primary key default gen_random_uuid(),
  template_exercise_id uuid not null references public.session_template_exercises (id) on delete cascade,
  set_index smallint not null check (set_index >= 1),
  set_type text not null default 'working' check (set_type in ('warmup', 'working', 'backoff')),
  reps_min smallint check (reps_min is null or reps_min > 0),
  reps_max smallint,
  reps_note text,
  weight_kg numeric(6, 2) check (weight_kg is null or weight_kg >= 0),
  weight_note text,
  rpe numeric(3, 1) check (rpe is null or (rpe >= 1 and rpe <= 10)),
  constraint session_template_sets_index_key unique (template_exercise_id, set_index),
  constraint session_template_sets_reps_range check (reps_max is null or (reps_min is not null and reps_max >= reps_min)),
  constraint session_template_sets_reps_required check (
    reps_min is not null or length(trim(coalesce(reps_note, ''))) > 0
  )
);

create index if not exists session_template_sets_template_exercise_id_idx
  on public.session_template_sets (template_exercise_id);

drop trigger if exists session_templates_touch_updated_at on public.session_templates;
create trigger session_templates_touch_updated_at
  before update on public.session_templates
  for each row execute procedure public.touch_updated_at();

-- ---------------------------------------------------------------------------
-- 5b. Free sessions
-- ---------------------------------------------------------------------------

create table if not exists public.free_sessions (
  id uuid primary key default gen_random_uuid(),
  -- null = not assigned to anyone (a guest, a trial, the trainer's own).
  trainee_id uuid references public.profiles (id) on delete set null,
  guest_label text check (guest_label is null or char_length(guest_label) <= 80),
  template_id uuid references public.session_templates (id) on delete set null,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  notes text check (notes is null or char_length(notes) <= 2000),
  created_by uuid references public.profiles (id) on delete set null
);

create index if not exists free_sessions_trainee_started_idx
  on public.free_sessions (trainee_id, started_at desc);
create index if not exists free_sessions_started_idx
  on public.free_sessions (started_at desc);

create table if not exists public.free_session_exercises (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.free_sessions (id) on delete cascade,
  exercise_id uuid not null references public.exercises (id) on delete restrict,
  order_index integer not null default 0,
  rest_seconds integer check (rest_seconds is null or rest_seconds >= 0),
  -- From the template (shown as the plan's note during the session).
  instructions text check (instructions is null or char_length(instructions) <= 1000),
  -- Typed during the session.
  notes text check (notes is null or char_length(notes) <= 1000)
);

create index if not exists free_session_exercises_session_id_idx
  on public.free_session_exercises (session_id);

-- One row per set of a session exercise. A row is a target (copied from a
-- template when the session started), a performed set, or both.
create table if not exists public.free_session_sets (
  id uuid primary key default gen_random_uuid(),
  session_exercise_id uuid not null references public.free_session_exercises (id) on delete cascade,
  set_index smallint not null check (set_index >= 1),
  set_type text not null default 'working' check (set_type in ('warmup', 'working', 'backoff')),
  target_reps_min smallint check (target_reps_min is null or target_reps_min > 0),
  target_reps_max smallint,
  target_reps_note text,
  target_weight_kg numeric(6, 2) check (target_weight_kg is null or target_weight_kg >= 0),
  target_weight_note text,
  target_rpe numeric(3, 1) check (target_rpe is null or (target_rpe >= 1 and target_rpe <= 10)),
  weight_kg numeric(6, 2) check (weight_kg is null or weight_kg >= 0),
  reps smallint check (reps is null or reps >= 0),
  rpe numeric(3, 1) check (rpe is null or (rpe >= 1 and rpe <= 10)),
  -- null = planned but not performed (yet).
  logged_at timestamptz,
  constraint free_session_sets_index_key unique (session_exercise_id, set_index),
  constraint free_session_sets_performed_has_reps check (logged_at is null or reps is not null),
  constraint free_session_sets_not_empty check (
    logged_at is not null
    or target_reps_min is not null
    or length(trim(coalesce(target_reps_note, ''))) > 0
  )
);

create index if not exists free_session_sets_session_exercise_id_idx
  on public.free_session_sets (session_exercise_id);

-- ---------------------------------------------------------------------------
-- Row Level Security: the trainer manages all of it; the read-only
-- superadmin reads all of it; a trainee reads free sessions assigned to
-- them (never templates, never anyone else's or unassigned sessions).
-- ---------------------------------------------------------------------------

alter table public.session_templates enable row level security;
alter table public.session_template_exercises enable row level security;
alter table public.session_template_sets enable row level security;
alter table public.free_sessions enable row level security;
alter table public.free_session_exercises enable row level security;
alter table public.free_session_sets enable row level security;

do $$
declare
  t text;
begin
  foreach t in array array[
    'session_templates', 'session_template_exercises', 'session_template_sets',
    'free_sessions', 'free_session_exercises', 'free_session_sets'
  ] loop
    execute format('drop policy if exists %I on public.%I', 'trainer manages ' || t, t);
    execute format(
      'create policy %I on public.%I for all using (public.is_trainer()) with check (public.is_trainer())',
      'trainer manages ' || t, t
    );
    execute format('drop policy if exists %I on public.%I', 'superadmin reads all ' || t, t);
    execute format(
      'create policy %I on public.%I for select using (public.is_superadmin())',
      'superadmin reads all ' || t, t
    );
  end loop;
end $$;

drop policy if exists "trainee reads own free_sessions" on public.free_sessions;
create policy "trainee reads own free_sessions" on public.free_sessions
  for select using (trainee_id = auth.uid());

drop policy if exists "trainee reads own free_session_exercises" on public.free_session_exercises;
create policy "trainee reads own free_session_exercises" on public.free_session_exercises
  for select using (
    exists (
      select 1 from public.free_sessions s
      where s.id = free_session_exercises.session_id
        and s.trainee_id = auth.uid()
    )
  );

drop policy if exists "trainee reads own free_session_sets" on public.free_session_sets;
create policy "trainee reads own free_session_sets" on public.free_session_sets
  for select using (
    exists (
      select 1 from public.free_session_exercises e
      join public.free_sessions s on s.id = e.session_id
      where e.id = free_session_sets.session_exercise_id
        and s.trainee_id = auth.uid()
    )
  );

-- A free session may only be assigned to a trainee — not to the trainer's
-- own profile or the superadmin's.
create or replace function public.enforce_free_session_trainee()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  if new.trainee_id is not null and not exists (
    select 1 from public.profiles p
    where p.id = new.trainee_id and p.role = 'trainee' and not p.is_superadmin
  ) then
    raise exception 'A free session can only be assigned to a trainee'
      using errcode = '23514';
  end if;
  return new;
end;
$$;

drop trigger if exists free_sessions_enforce_trainee on public.free_sessions;
create trigger free_sessions_enforce_trainee
  before insert or update of trainee_id on public.free_sessions
  for each row execute procedure public.enforce_free_session_trainee();

revoke execute on function public.enforce_free_session_trainee() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Multi-row operations as single transactions. Each of these copies an
-- exercise list with its sets; done as several requests from the app, a
-- failure halfway would leave half a template or half a session behind.
-- SECURITY INVOKER: they run as the caller, so RLS still applies — and they
-- refuse anyone but the trainer up front for a clear error.
-- ---------------------------------------------------------------------------

create or replace function public.start_free_session(
  p_template_id uuid default null,
  p_trainee_id uuid default null,
  p_guest_label text default null
)
returns uuid
language plpgsql
set search_path = public
as $$
declare
  v_session uuid;
  v_ex record;
  v_new_ex uuid;
begin
  if not public.is_trainer() then
    raise exception 'Only the trainer can start a session' using errcode = '42501';
  end if;

  if p_template_id is not null and not exists (
    select 1 from public.session_templates t where t.id = p_template_id and t.deleted_at is null
  ) then
    raise exception 'Saved workout not found' using errcode = 'P0002';
  end if;

  -- Housekeeping: sessions that were opened, never used and left behind
  -- (opened by mistake, the browser was closed). The app never lists them;
  -- this keeps them from piling up.
  delete from public.free_sessions s
  where s.finished_at is null
    and s.started_at < now() - interval '24 hours'
    and not exists (
      select 1
      from public.free_session_exercises e
      join public.free_session_sets st on st.session_exercise_id = e.id
      where e.session_id = s.id and st.logged_at is not null
    );

  insert into public.free_sessions (trainee_id, guest_label, template_id, created_by)
  values (p_trainee_id, nullif(trim(coalesce(p_guest_label, '')), ''), p_template_id, auth.uid())
  returning id into v_session;

  if p_template_id is not null then
    for v_ex in
      select * from public.session_template_exercises
      where template_id = p_template_id
      order by order_index, id
    loop
      insert into public.free_session_exercises (session_id, exercise_id, order_index, rest_seconds, instructions)
      values (v_session, v_ex.exercise_id, v_ex.order_index, v_ex.rest_seconds, v_ex.instructions)
      returning id into v_new_ex;

      insert into public.free_session_sets
        (session_exercise_id, set_index, set_type, target_reps_min, target_reps_max, target_reps_note,
         target_weight_kg, target_weight_note, target_rpe)
      select v_new_ex, s.set_index, s.set_type, s.reps_min, s.reps_max, s.reps_note,
             s.weight_kg, s.weight_note, s.rpe
      from public.session_template_sets s
      where s.template_exercise_id = v_ex.id;
    end loop;
  end if;

  return v_session;
end;
$$;

-- Turns what was actually PERFORMED in a session into a saved workout: each
-- exercise with at least one performed set, its performed sets as targets.
-- p_template_id null = create a new template titled p_title; otherwise
-- update that template in place: an exercise it already has (matched by
-- exercise, in order) gets its sets replaced, a new one is appended, and
-- exercises the session didn't perform are left as they were.
create or replace function public.save_session_as_template(
  p_session_id uuid,
  p_title text default null,
  p_template_id uuid default null
)
returns uuid
language plpgsql
set search_path = public
as $$
declare
  v_template uuid := p_template_id;
  v_ex record;
  v_target uuid;
  v_used uuid[] := '{}';
  v_order integer;
begin
  if not public.is_trainer() then
    raise exception 'Only the trainer can save a workout' using errcode = '42501';
  end if;

  if not exists (
    select 1
    from public.free_session_exercises e
    join public.free_session_sets s on s.session_exercise_id = e.id
    where e.session_id = p_session_id and s.logged_at is not null
  ) then
    raise exception 'Nothing was performed in this session' using errcode = 'P0001';
  end if;

  if v_template is null then
    if length(trim(coalesce(p_title, ''))) = 0 then
      raise exception 'A title is required' using errcode = 'P0001';
    end if;
    insert into public.session_templates (title, created_by)
    values (left(trim(p_title), 120), auth.uid())
    returning id into v_template;
    -- The session it was made from counts as its first use — unless that
    -- session was itself started from another saved workout.
    update public.free_sessions set template_id = v_template
    where id = p_session_id and template_id is null;
  elsif not exists (
    select 1 from public.session_templates t where t.id = v_template and t.deleted_at is null
  ) then
    raise exception 'Saved workout not found' using errcode = 'P0002';
  end if;

  select coalesce(max(order_index), -1) into v_order
  from public.session_template_exercises where template_id = v_template;

  for v_ex in
    select e.*
    from public.free_session_exercises e
    where e.session_id = p_session_id
      and exists (
        select 1 from public.free_session_sets s
        where s.session_exercise_id = e.id and s.logged_at is not null
      )
    order by e.order_index, e.id
  loop
    select te.id into v_target
    from public.session_template_exercises te
    where te.template_id = v_template
      and te.exercise_id = v_ex.exercise_id
      and te.id <> all (v_used)
    order by te.order_index, te.id
    limit 1;

    if v_target is null then
      v_order := v_order + 1;
      insert into public.session_template_exercises (template_id, exercise_id, order_index, rest_seconds, instructions)
      values (v_template, v_ex.exercise_id, v_order, v_ex.rest_seconds, v_ex.instructions)
      returning id into v_target;
    else
      delete from public.session_template_sets where template_exercise_id = v_target;
    end if;
    v_used := v_used || v_target;

    insert into public.session_template_sets
      (template_exercise_id, set_index, set_type, reps_min, reps_max, weight_kg)
    select v_target,
           row_number() over (order by s.set_index),
           s.set_type,
           greatest(s.reps, 1),
           greatest(s.reps, 1),
           s.weight_kg
    from public.free_session_sets s
    where s.session_exercise_id = v_ex.id and s.logged_at is not null;
  end loop;

  update public.session_templates set updated_at = now() where id = v_template;
  return v_template;
end;
$$;

create or replace function public.duplicate_session_template(p_template_id uuid)
returns uuid
language plpgsql
set search_path = public
as $$
declare
  v_source public.session_templates%rowtype;
  v_template uuid;
  v_ex record;
  v_new_ex uuid;
begin
  if not public.is_trainer() then
    raise exception 'Only the trainer can duplicate a saved workout' using errcode = '42501';
  end if;

  select * into v_source from public.session_templates
  where id = p_template_id and deleted_at is null;
  if not found then
    raise exception 'Saved workout not found' using errcode = 'P0002';
  end if;

  insert into public.session_templates (title, notes, created_by)
  values (left(v_source.title || ' (עותק)', 120), v_source.notes, auth.uid())
  returning id into v_template;

  for v_ex in
    select * from public.session_template_exercises
    where template_id = p_template_id
    order by order_index, id
  loop
    insert into public.session_template_exercises (template_id, exercise_id, order_index, rest_seconds, instructions)
    values (v_template, v_ex.exercise_id, v_ex.order_index, v_ex.rest_seconds, v_ex.instructions)
    returning id into v_new_ex;

    insert into public.session_template_sets
      (template_exercise_id, set_index, set_type, reps_min, reps_max, reps_note, weight_kg, weight_note, rpe)
    select v_new_ex, s.set_index, s.set_type, s.reps_min, s.reps_max, s.reps_note, s.weight_kg, s.weight_note, s.rpe
    from public.session_template_sets s
    where s.template_exercise_id = v_ex.id;
  end loop;

  return v_template;
end;
$$;

revoke execute on function public.start_free_session(uuid, uuid, text) from public, anon;
revoke execute on function public.save_session_as_template(uuid, text, uuid) from public, anon;
revoke execute on function public.duplicate_session_template(uuid) from public, anon;
grant execute on function public.start_free_session(uuid, uuid, text) to authenticated;
grant execute on function public.save_session_as_template(uuid, text, uuid) to authenticated;
grant execute on function public.duplicate_session_template(uuid) to authenticated;
