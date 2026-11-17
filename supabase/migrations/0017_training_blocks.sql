-- Training blocks with automatic progression (planning/PLAN.md, feature 2).
--
-- A block is a run of consecutive weekly programs for one trainee. It sits
-- ON TOP of the weekly programs rather than replacing them: every block
-- week is an ordinary `programs` row (so every existing screen keeps
-- working), tagged with the block and its week number.
--
-- The trainer builds one week and gives each exercise a progression rule
-- ("+2.5 kg", "+2.6%", "+1 rep", double progression). Every later week's
-- targets are then COMPUTED from the week before it — from its targets and
-- from what the trainee actually did there — by block_recompute_internal()
-- below. All of it lives in the database, not in the app, on purpose:
--
--   * the trainee must not get write access to programs, yet their logging
--     is what moves next week's targets; a SECURITY DEFINER function that
--     checks who is calling does that without the service-role key (which
--     has repeatedly been missing from the Worker at runtime);
--   * multi-row operations (creating a block, copying a week's structure
--     forward, shifting a block by a week) are one transaction each.
--
-- Purely additive except for one unused column (see below); the previously
-- deployed code ignores all of it. Safely re-runnable.

-- ---------------------------------------------------------------------------
-- Tables and columns
-- ---------------------------------------------------------------------------

create table if not exists public.blocks (
  id uuid primary key default gen_random_uuid(),
  trainee_id uuid not null references public.profiles (id) on delete cascade,
  title text not null check (length(trim(title)) > 0 and char_length(title) <= 120),
  weeks_count smallint not null check (weeks_count between 1 and 16),
  status text not null default 'active' check (status in ('active', 'completed')),
  -- A deload week's weights are this percent of the week before it.
  default_deload_pct smallint not null default 60 check (default_deload_pct between 30 and 100),
  -- Off by default: computed weeks stay drafts until the trainer publishes.
  auto_publish_next_week boolean not null default false,
  notes text check (notes is null or char_length(notes) <= 1000),
  -- The calendar week (its Sunday) up to which the once-a-week maintenance
  -- already ran — see block_roll_forward().
  rolled_through date,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create index if not exists blocks_trainee_id_idx on public.blocks (trainee_id);

drop trigger if exists blocks_touch_updated_at on public.blocks;
create trigger blocks_touch_updated_at
  before update on public.blocks
  for each row execute procedure public.touch_updated_at();

-- No start date on the block: it is the date of its first week's program,
-- and storing it twice would only let the two disagree after a shift.
alter table public.programs
  add column if not exists block_id uuid references public.blocks (id) on delete set null,
  add column if not exists block_week_index smallint,
  add column if not exists is_deload boolean not null default false,
  -- null = the block's default.
  add column if not exists deload_pct smallint;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'programs_block_week_index_range') then
    alter table public.programs add constraint programs_block_week_index_range
      check (block_week_index is null or block_week_index between 1 and 16);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'programs_deload_pct_range') then
    alter table public.programs add constraint programs_deload_pct_range
      check (deload_pct is null or deload_pct between 30 and 100);
  end if;
end $$;

create unique index if not exists programs_block_week_key
  on public.programs (block_id, block_week_index)
  where deleted_at is null and block_id is not null;

-- "The same workout / the same exercise" across the weeks of a block. Rows
-- that existed before get a key of their own (the default is evaluated per
-- row), i.e. they're each their own slot — which is what they are.
alter table public.workouts
  add column if not exists slot_key uuid not null default gen_random_uuid();

alter table public.workout_exercises
  add column if not exists slot_key uuid not null default gen_random_uuid(),
  -- How this exercise moves from THIS week to the next one in the block.
  add column if not exists progression_type text not null default 'none',
  add column if not exists weight_step_unit text not null default 'kg',
  add column if not exists weight_step_kg numeric(5, 2),
  add column if not exists weight_step_pct numeric(4, 2),
  add column if not exists reps_step smallint,
  -- Double progression: add reps up to this many, then add weight.
  add column if not exists reps_cap smallint,
  -- 'actual': only after the trainee hit the target. 'planned': regardless.
  add column if not exists progression_basis text not null default 'actual',
  -- Computed weights (percent steps, deloads) are rounded to a multiple of this.
  add column if not exists rounding_kg numeric(4, 2) not null default 2.5,
  -- Why this week's targets are what they are (set by the computation; read
  -- by the trainer's screens): outcome, base week, sets completed, deltas.
  add column if not exists progression_info jsonb;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'workout_exercises_progression_type_check') then
    alter table public.workout_exercises add constraint workout_exercises_progression_type_check
      check (progression_type in ('none', 'weight', 'reps', 'double'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'workout_exercises_weight_step_unit_check') then
    alter table public.workout_exercises add constraint workout_exercises_weight_step_unit_check
      check (weight_step_unit in ('kg', 'pct'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'workout_exercises_progression_basis_check') then
    alter table public.workout_exercises add constraint workout_exercises_progression_basis_check
      check (progression_basis in ('actual', 'planned'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'workout_exercises_progression_steps_check') then
    alter table public.workout_exercises add constraint workout_exercises_progression_steps_check
      check (
        (weight_step_kg is null or (weight_step_kg > 0 and weight_step_kg <= 100))
        and (weight_step_pct is null or (weight_step_pct > 0 and weight_step_pct <= 25))
        and (reps_step is null or (reps_step between 1 and 20))
        and (reps_cap is null or (reps_cap between 1 and 200))
        and rounding_kg > 0 and rounding_kg <= 20
      );
  end if;
end $$;

create index if not exists workout_exercises_slot_key_idx on public.workout_exercises (slot_key);
create index if not exists programs_block_id_idx on public.programs (block_id);

-- The weight before rounding, so a percent step accumulates correctly:
-- +2.6% on 40 kg is 41.04, shown as 40; the week after is 42.11, shown as
-- 42.5. Without it 40 would round back to 40 forever. null = same as
-- weight_kg (the usual case: the trainer's own number, or a kg step).
alter table public.workout_exercise_sets
  add column if not exists weight_kg_exact numeric(8, 3);

-- Added by migration 0013 for this feature and never used: the reason is
-- kept per exercise (workout_exercises.progression_info) instead.
alter table public.workout_exercise_sets drop column if exists progression_note;

-- ---------------------------------------------------------------------------
-- Row Level Security for blocks
-- ---------------------------------------------------------------------------

alter table public.blocks enable row level security;

drop policy if exists "trainer manages blocks" on public.blocks;
create policy "trainer manages blocks" on public.blocks
  for all using (public.is_trainer()) with check (public.is_trainer());

drop policy if exists "superadmin reads all blocks" on public.blocks;
create policy "superadmin reads all blocks" on public.blocks
  for select using (public.is_superadmin());

-- For "בלוק כוח · שבוע 3 מתוך 6" on the trainee's own screens.
drop policy if exists "trainee reads own blocks" on public.blocks;
create policy "trainee reads own blocks" on public.blocks
  for select using (trainee_id = auth.uid() and deleted_at is null);

-- ---------------------------------------------------------------------------
-- Small helpers
-- ---------------------------------------------------------------------------

-- "Today" where the app's users are. The database clock is UTC.
create or replace function public.israel_today()
returns date
language sql
stable
as $$
  select (now() at time zone 'Asia/Jerusalem')::date;
$$;

-- The Sunday that starts the week containing p_day.
create or replace function public.week_start_of(p_day date)
returns date
language sql
immutable
as $$
  select p_day - extract(dow from p_day)::integer;
$$;

-- Rounds a weight to the nearest multiple of p_step (2.5 → plates).
create or replace function public.block_round(p_value numeric, p_step numeric)
returns numeric
language sql
immutable
as $$
  select case
    when p_value is null then null
    when p_step is null or p_step <= 0 then round(p_value, 2)
    else round(round(p_value / p_step) * p_step, 2)
  end;
$$;

-- Serializes everything that recomputes or rearranges one block for the
-- rest of the transaction: two saves a moment apart (the trainer tabbing
-- through set fields, or the trainee and the trainer logging at once) each
-- trigger a recompute, and two of those interleaving could deadlock or
-- leave a week half-derived from each. Re-entrant within a transaction.
create or replace function public.block_lock(p_block_id uuid)
returns void
language sql
as $$
  select pg_advisory_xact_lock(hashtextextended(p_block_id::text, 17));
$$;

-- Has the trainee (or the trainer, in a session) recorded anything at all
-- in this program? Such a week is "frozen": nothing below ever restructures
-- or deletes it, because that would take the recorded history with it.
create or replace function public.program_has_performance(p_program_id uuid)
returns boolean
language sql
stable
security definer set search_path = public
as $$
  select exists (
    select 1
    from public.workouts w
    where w.program_id = p_program_id
      and (
        exists (select 1 from public.workout_completions c where c.workout_id = w.id)
        or exists (
          select 1
          from public.workout_exercises we
          where we.workout_id = w.id
            and (
              exists (select 1 from public.set_logs l where l.workout_exercise_id = we.id)
              or exists (select 1 from public.workout_logs l where l.workout_exercise_id = we.id)
              or exists (
                select 1 from public.workout_exercise_completions c where c.workout_exercise_id = we.id
              )
            )
        )
      )
  );
$$;

-- Copies every workout, exercise and planned set of one program into
-- another (which must be empty). p_keep_slots = true keeps the slot keys,
-- i.e. the copy is "the same exercises, next week" (inside a block);
-- false starts new slots (week 1 of a new block, copied from elsewhere).
-- p_use_performed: where a set was performed in the source, take the
-- weight that was actually lifted as the new target.
create or replace function public.block_copy_structure(
  p_from uuid,
  p_to uuid,
  p_keep_slots boolean,
  p_use_performed boolean default false
)
returns void
language plpgsql
security definer set search_path = public
as $$
declare
  v_w record;
  v_e record;
  v_new_w uuid;
  v_new_e uuid;
begin
  for v_w in
    select * from public.workouts where program_id = p_from order by day_of_week, order_index, id
  loop
    insert into public.workouts (program_id, day_of_week, order_index, title, notes, slot_key)
    values (
      p_to, v_w.day_of_week, v_w.order_index, v_w.title, v_w.notes,
      case when p_keep_slots then v_w.slot_key else gen_random_uuid() end
    )
    returning id into v_new_w;

    for v_e in
      select * from public.workout_exercises where workout_id = v_w.id order by order_index, id
    loop
      insert into public.workout_exercises (
        workout_id, exercise_id, order_index, rest_seconds, instructions, hide_library_note, slot_key,
        progression_type, weight_step_unit, weight_step_kg, weight_step_pct, reps_step, reps_cap,
        progression_basis, rounding_kg
      )
      values (
        v_new_w, v_e.exercise_id, v_e.order_index, v_e.rest_seconds, v_e.instructions, v_e.hide_library_note,
        case when p_keep_slots then v_e.slot_key else gen_random_uuid() end,
        v_e.progression_type, v_e.weight_step_unit, v_e.weight_step_kg, v_e.weight_step_pct, v_e.reps_step,
        v_e.reps_cap, v_e.progression_basis, v_e.rounding_kg
      )
      returning id into v_new_e;

      insert into public.workout_exercise_sets (
        workout_exercise_id, set_index, set_type, reps_min, reps_max, reps_note,
        weight_kg, weight_note, rpe, is_manual_override, weight_kg_exact
      )
      select
        v_new_e, s.set_index, s.set_type, s.reps_min, s.reps_max, s.reps_note,
        case when p_use_performed and l.weight_kg is not null then l.weight_kg else s.weight_kg end,
        case when p_use_performed and l.weight_kg is not null then null else s.weight_note end,
        s.rpe,
        false,
        -- A new block starts from clean, visible numbers.
        case when p_keep_slots then s.weight_kg_exact else null end
      from public.workout_exercise_sets s
      left join public.set_logs l
        on p_use_performed
        and l.workout_exercise_id = s.workout_exercise_id
        and l.set_index = s.set_index
        and l.status = 'done'
        and l.source <> 'legacy'
      where s.workout_exercise_id = v_e.id;
    end loop;
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- The progression engine
-- ---------------------------------------------------------------------------

-- Recomputes the targets of every week of the block from p_from_index on,
-- in order, each from the last non-deload week before it that has the same
-- exercise slot (its "base"). For one exercise:
--
--   the base's rule says how it moves (none / weight / reps / double);
--   the base's outcome says whether it moves:
--     advanced   every working set was logged at or above its target
--                (reps >= the minimum of the range — the top of it for
--                double progression — at >= the target weight), or the
--                rule's basis is 'planned';
--     repeated   it was done, but short of that: same targets again;
--     skipped    not done at all and that week is over: same targets again;
--     projected  not decided yet (the week isn't over): assume success, so
--                the weeks ahead show the plan if all goes well;
--     deload     this is a deload week: the base's weights at deload_pct,
--                rounded; it never serves as a base itself, so the week
--                after it continues from the week before it;
--     none       no rule: the base's targets are carried over as they are.
--
-- It never touches a set the trainer set by hand (is_manual_override), an
-- exercise the trainee already logged anything on, or a workout that was
-- submitted — those are facts, not plans. Warm-up sets don't progress.
--
-- Weight steps work on the exact weight (weight_kg_exact, or weight_kg when
-- they're the same). A percent step and a deload are rounded to the
-- exercise's rounding_kg for display; a kg step on a clean number stays the
-- trainer's own arithmetic (80 + 2.5 = 82.5).
create or replace function public.block_recompute_internal(p_block_id uuid, p_from_index integer default 2)
returns void
language plpgsql
security definer set search_path = public
as $$
declare
  v_today date := public.israel_today();
  v_status text;
  v_default_pct smallint;
  v_week record;
  v_ex record;
  v_base record;
  v_set record;
  v_b record;
  v_start record;
  v_total integer;
  v_logged integer;
  v_met integer;
  v_any_logs boolean;
  v_submitted boolean;
  v_week_over boolean;
  v_outcome text;
  v_advance boolean;
  v_pct numeric;
  v_exact numeric;
  v_new_exact numeric;
  v_new_weight numeric;
  v_new_min smallint;
  v_new_max smallint;
  v_top smallint;
  v_bump_weight boolean;
  v_can_bump boolean;
  v_reset boolean;
  v_first boolean;
  v_delta_kg numeric;
  v_delta_reps integer;
  v_exact_note numeric;
  v_info jsonb;
begin
  perform public.block_lock(p_block_id);

  select status, default_deload_pct into v_status, v_default_pct
  from public.blocks
  where id = p_block_id and deleted_at is null;
  if not found or v_status <> 'active' then
    return;
  end if;

  for v_week in
    select p.id, p.block_week_index, p.is_deload, p.deload_pct
    from public.programs p
    where p.block_id = p_block_id
      and p.deleted_at is null
      and p.block_week_index >= greatest(coalesce(p_from_index, 2), 2)
    order by p.block_week_index
  loop
    for v_ex in
      select we.id, we.workout_id, we.slot_key
      from public.workout_exercises we
      join public.workouts w on w.id = we.workout_id
      where w.program_id = v_week.id
      order by we.id
    loop
      -- Already performed (or submitted): a fact, not a plan.
      if exists (select 1 from public.set_logs l where l.workout_exercise_id = v_ex.id)
         or exists (select 1 from public.workout_completions c where c.workout_id = v_ex.workout_id) then
        continue;
      end if;

      select we.id, we.workout_id, we.progression_type, we.weight_step_unit, we.weight_step_kg,
             we.weight_step_pct, we.reps_step, we.reps_cap, we.progression_basis, we.rounding_kg,
             p.block_week_index as base_index, p.week_start_date as base_week_start
      into v_base
      from public.workout_exercises we
      join public.workouts w on w.id = we.workout_id
      join public.programs p on p.id = w.program_id
      where p.block_id = p_block_id
        and p.deleted_at is null
        and not p.is_deload
        and p.block_week_index < v_week.block_week_index
        and we.slot_key = v_ex.slot_key
      order by p.block_week_index desc
      limit 1;

      if not found then
        -- The slot's first appearance: its targets are the trainer's own.
        update public.workout_exercises set progression_info = null
        where id = v_ex.id and progression_info is not null;
        continue;
      end if;

      -- ---- what happened in the base week
      select
        count(*),
        count(*) filter (where l.set_index is not null),
        count(*) filter (
          where l.set_index is not null
            and (
              s.reps_min is null
              or l.reps >= case
                when v_base.progression_type = 'double' then coalesce(s.reps_max, s.reps_min)
                else s.reps_min
              end
            )
            and (s.weight_kg is null or (l.weight_kg is not null and l.weight_kg >= s.weight_kg))
        )
      into v_total, v_logged, v_met
      from public.workout_exercise_sets s
      left join public.set_logs l
        on l.workout_exercise_id = s.workout_exercise_id
        and l.set_index = s.set_index
        and l.status = 'done'
      where s.workout_exercise_id = v_base.id and s.set_type <> 'warmup';

      v_any_logs := exists (
        select 1 from public.set_logs l where l.workout_exercise_id = v_base.id and l.status = 'done'
      );
      v_submitted := exists (
        select 1 from public.workout_completions c where c.workout_id = v_base.workout_id
      );
      v_week_over := v_today > v_base.base_week_start + 6;

      if v_week.is_deload then
        v_outcome := 'deload';
        v_advance := false;
      elsif v_base.progression_type = 'none' or v_total = 0 then
        v_outcome := 'none';
        v_advance := false;
      elsif v_base.progression_basis = 'planned' then
        v_outcome := 'advanced';
        v_advance := true;
      elsif not v_any_logs then
        if v_submitted or v_week_over then
          v_outcome := 'skipped';
          v_advance := false;
        else
          v_outcome := 'projected';
          v_advance := true;
        end if;
      elsif v_logged >= v_total or v_submitted or v_week_over then
        if v_met >= v_total then
          v_outcome := 'advanced';
          v_advance := true;
        else
          v_outcome := 'repeated';
          v_advance := false;
        end if;
      else
        -- In the middle of it right now.
        v_outcome := 'projected';
        v_advance := true;
      end if;

      -- ---- this week's targets, set by set
      v_pct := coalesce(v_week.deload_pct, v_default_pct);
      v_first := true;
      v_delta_kg := null;
      v_delta_reps := null;
      v_exact_note := null;
      v_reset := false;

      for v_set in
        select s.id, s.set_index
        from public.workout_exercise_sets s
        where s.workout_exercise_id = v_ex.id and not s.is_manual_override
        order by s.set_index
      loop
        select s.set_type, s.reps_min, s.reps_max, s.reps_note, s.weight_kg, s.weight_note, s.weight_kg_exact
        into v_b
        from public.workout_exercise_sets s
        where s.workout_exercise_id = v_base.id and s.set_index = v_set.set_index;
        if not found then
          continue;
        end if;

        v_exact := coalesce(v_b.weight_kg_exact, v_b.weight_kg);
        v_new_min := v_b.reps_min;
        v_new_max := v_b.reps_max;
        v_new_weight := v_b.weight_kg;
        v_new_exact := v_b.weight_kg_exact;

        if v_week.is_deload then
          if v_exact is not null then
            v_new_weight := public.block_round(v_exact * v_pct / 100.0, v_base.rounding_kg);
            v_new_exact := null;
          end if;
        elsif v_advance and v_b.set_type <> 'warmup' then
          v_bump_weight := false;
          v_can_bump := v_exact is not null and (
            (v_base.weight_step_unit = 'pct' and v_base.weight_step_pct is not null)
            or (v_base.weight_step_unit = 'kg' and v_base.weight_step_kg is not null)
          );

          if v_base.progression_type = 'weight' then
            v_bump_weight := v_can_bump;
          elsif v_base.progression_type = 'reps' then
            if v_b.reps_min is not null and v_base.reps_step is not null then
              v_new_min := v_b.reps_min + v_base.reps_step;
              if v_b.reps_max is not null then
                v_new_max := v_b.reps_max + v_base.reps_step;
              end if;
            end if;
          elsif v_base.progression_type = 'double' then
            v_top := coalesce(v_b.reps_max, v_b.reps_min);
            if v_top is not null and v_base.reps_step is not null and v_base.reps_cap is not null
               and v_top + v_base.reps_step <= v_base.reps_cap then
              v_new_min := v_b.reps_min + v_base.reps_step;
              if v_b.reps_max is not null then
                v_new_max := v_b.reps_max + v_base.reps_step;
              end if;
            elsif v_can_bump then
              -- Reps reached the cap: add weight, and go back to the reps
              -- this slot started the block with.
              v_bump_weight := true;
              select s.reps_min, s.reps_max into v_start
              from public.workout_exercise_sets s
              join public.workout_exercises we on we.id = s.workout_exercise_id
              join public.workouts w on w.id = we.workout_id
              join public.programs p on p.id = w.program_id
              where p.block_id = p_block_id
                and p.deleted_at is null
                and not p.is_deload
                and we.slot_key = v_ex.slot_key
                and s.set_index = v_set.set_index
              order by p.block_week_index
              limit 1;
              if found and v_start.reps_min is not null then
                v_new_min := v_start.reps_min;
                v_new_max := v_start.reps_max;
                v_reset := true;
              end if;
            end if;
          end if;

          if v_bump_weight then
            if v_base.weight_step_unit = 'pct' then
              v_new_exact := v_exact * (1 + v_base.weight_step_pct / 100.0);
              v_new_weight := public.block_round(v_new_exact, v_base.rounding_kg);
            else
              v_new_exact := v_exact + v_base.weight_step_kg;
              if v_b.weight_kg_exact is null then
                v_new_weight := v_new_exact;
              else
                v_new_weight := public.block_round(v_new_exact, v_base.rounding_kg);
              end if;
            end if;
          end if;
        end if;

        -- (least() skips nulls: without the guard a bodyweight set would become 9999 kg.)
        if v_new_weight is not null then
          v_new_weight := least(v_new_weight, 9999);
        end if;
        if v_new_exact is not null and (v_new_exact = v_new_weight or v_new_exact > 99999) then
          v_new_exact := null;
        end if;

        update public.workout_exercise_sets s
        set reps_min = v_new_min,
            reps_max = v_new_max,
            reps_note = v_b.reps_note,
            weight_kg = v_new_weight,
            weight_note = v_b.weight_note,
            weight_kg_exact = v_new_exact
        where s.id = v_set.id
          and (s.reps_min, s.reps_max, s.reps_note, s.weight_kg, s.weight_note, s.weight_kg_exact)
              is distinct from
              (v_new_min, v_new_max, v_b.reps_note, v_new_weight, v_b.weight_note, v_new_exact);

        if v_first and v_b.set_type <> 'warmup' then
          v_first := false;
          v_delta_kg := v_new_weight - v_b.weight_kg;
          v_delta_reps := v_new_min - v_b.reps_min;
          v_exact_note := round(v_new_exact, 2);
        end if;
      end loop;

      v_info := jsonb_strip_nulls(jsonb_build_object(
        'outcome', v_outcome,
        'base_week', v_base.base_index,
        'completed', case when v_outcome in ('repeated', 'advanced') and v_base.progression_basis = 'actual' then v_met end,
        'total', case when v_outcome in ('repeated', 'advanced') and v_base.progression_basis = 'actual' then v_total end,
        'delta_kg', nullif(v_delta_kg, 0),
        'delta_reps', nullif(v_delta_reps, 0),
        'exact_kg', v_exact_note,
        'reset_reps', case when v_reset then true end,
        'deload_pct', case when v_week.is_deload then v_pct end
      ));

      update public.workout_exercises
      set progression_info = v_info
      where id = v_ex.id and progression_info is distinct from v_info;
    end loop;
  end loop;
end;
$$;

-- Gives every later, not-yet-started week of the block the structure of
-- p_program_id's week: the same workouts (days), exercises, rules and sets,
-- then recomputes their targets. Sets the trainer set by hand in those
-- weeks keep their values (matched by exercise slot + set number). A week
-- the trainee already started is left exactly as it is and reported back.
-- A published week that changes goes back to draft, like any trainer edit
-- (not in a block that publishes its weeks automatically).
create or replace function public.block_apply_structure_internal(p_program_id uuid)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  v_source record;
  v_week record;
  v_overrides jsonb;
  v_updated integer[] := '{}';
  v_frozen integer[] := '{}';
  v_block public.blocks%rowtype;
begin
  select p.id, p.block_id, p.block_week_index into v_source
  from public.programs p
  where p.id = p_program_id and p.deleted_at is null and p.block_id is not null;
  if not found then
    raise exception 'This program is not part of a block' using errcode = 'P0002';
  end if;
  perform public.block_lock(v_source.block_id);

  select * into v_block from public.blocks where id = v_source.block_id and deleted_at is null;
  if not found or v_block.status <> 'active' then
    -- Nothing would recompute the copies: they'd be this week's targets verbatim.
    raise exception 'The block has ended' using errcode = 'P0001';
  end if;

  for v_week in
    select p.id, p.block_week_index, p.status
    from public.programs p
    where p.block_id = v_source.block_id
      and p.deleted_at is null
      and p.block_week_index > v_source.block_week_index
    order by p.block_week_index
  loop
    if public.program_has_performance(v_week.id) then
      v_frozen := v_frozen || v_week.block_week_index::integer;
      continue;
    end if;

    select coalesce(jsonb_agg(jsonb_build_object(
      'slot_key', we.slot_key, 'set_index', s.set_index,
      'reps_min', s.reps_min, 'reps_max', s.reps_max, 'reps_note', s.reps_note,
      'weight_kg', s.weight_kg, 'weight_note', s.weight_note
    )), '[]'::jsonb)
    into v_overrides
    from public.workout_exercise_sets s
    join public.workout_exercises we on we.id = s.workout_exercise_id
    join public.workouts w on w.id = we.workout_id
    where w.program_id = v_week.id and s.is_manual_override;

    -- Safe: nothing was ever recorded under these rows (checked above).
    delete from public.workouts where program_id = v_week.id;
    perform public.block_copy_structure(v_source.id, v_week.id, true);

    update public.workout_exercise_sets s
    set reps_min = o.reps_min,
        reps_max = o.reps_max,
        reps_note = o.reps_note,
        weight_kg = o.weight_kg,
        weight_note = o.weight_note,
        weight_kg_exact = null,
        is_manual_override = true
    from jsonb_to_recordset(v_overrides) as o(
      slot_key uuid, set_index smallint, reps_min smallint, reps_max smallint, reps_note text,
      weight_kg numeric, weight_note text
    )
    join public.workout_exercises we on we.slot_key = o.slot_key
    join public.workouts w on w.id = we.workout_id and w.program_id = v_week.id
    where s.workout_exercise_id = we.id and s.set_index = o.set_index;

    -- Like any trainer edit, a published week that changed goes back to
    -- draft for review — unless the block publishes by itself, in which
    -- case the trainer already chose not to review week by week.
    if v_week.status = 'published' and not v_block.auto_publish_next_week then
      update public.programs set status = 'draft', published_at = null, updated_at = now()
      where id = v_week.id;
    end if;
    v_updated := v_updated || v_week.block_week_index::integer;
  end loop;

  perform public.block_recompute_internal(v_source.block_id, v_source.block_week_index + 1);
  return jsonb_build_object('updated', to_jsonb(v_updated), 'frozen', to_jsonb(v_frozen));
end;
$$;

-- ---------------------------------------------------------------------------
-- What the app calls. Every one of these checks who is calling first: they
-- run with the definer's rights (RLS does not apply inside them).
-- ---------------------------------------------------------------------------

-- Two error codes of this file's own, for the two refusals the app turns
-- into a specific message (deliberately not P0003/P0004: those are
-- plpgsql's too_many_rows and assert_failure):
--   BK001  WEEK_TAKEN <date>            that calendar week already has a program
--   BK002  WEEK_HAS_PERFORMANCE <date>  that week was already started; it is never
--                                       replaced, moved or restructured
--
-- Creates a block and one draft program per week. Week 1 can be copied from
-- an existing program of the same trainee (then the later weeks get the
-- same structure right away). A week that already has a program stops the
-- whole thing (BK001) unless p_replace_existing — and even then a week
-- with recorded performance is never replaced (BK002).
create or replace function public.create_block(
  p_trainee_id uuid,
  p_title text,
  p_start_week date,
  p_weeks_count integer,
  p_deload_weeks integer[] default '{}',
  p_deload_pct integer default 60,
  p_source_program_id uuid default null,
  p_use_performed boolean default false,
  p_replace_existing boolean default false,
  p_auto_publish boolean default false
)
returns uuid
language plpgsql
security definer set search_path = public
as $$
declare
  v_current_week date := public.week_start_of(public.israel_today());
  v_deload integer[] := coalesce(p_deload_weeks, '{}');
  v_block uuid;
  v_week1 uuid;
  v_program uuid;
  v_existing uuid;
  v_date date;
  v_i integer;
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
  if p_weeks_count is null or p_weeks_count < 1 or p_weeks_count > 16 then
    raise exception 'A block is 1 to 16 weeks long' using errcode = 'P0001';
  end if;
  if p_start_week is null or extract(dow from p_start_week) <> 0 then
    raise exception 'A block starts on a Sunday' using errcode = 'P0001';
  end if;
  if p_start_week < v_current_week or p_start_week > v_current_week + 7 * 26 then
    raise exception 'A block starts this week or later' using errcode = 'P0001';
  end if;
  if p_deload_pct is null or p_deload_pct < 30 or p_deload_pct > 100 then
    raise exception 'The deload percentage is 30 to 100' using errcode = 'P0001';
  end if;
  if exists (select 1 from unnest(v_deload) d where d is null or d < 2 or d > p_weeks_count) then
    raise exception 'A deload week is one of weeks 2 and on' using errcode = 'P0001';
  end if;
  if p_source_program_id is not null and not exists (
    select 1 from public.programs p where p.id = p_source_program_id and p.trainee_id = p_trainee_id
  ) then
    raise exception 'The program to copy was not found' using errcode = 'P0002';
  end if;

  for v_i in 1..p_weeks_count loop
    v_date := p_start_week + 7 * (v_i - 1);
    select p.id into v_existing
    from public.programs p
    where p.trainee_id = p_trainee_id and p.week_start_date = v_date and p.deleted_at is null;
    if found then
      if not coalesce(p_replace_existing, false) then
        raise exception 'WEEK_TAKEN %', v_date using errcode = 'BK001';
      end if;
      if public.program_has_performance(v_existing) then
        raise exception 'WEEK_HAS_PERFORMANCE %', v_date using errcode = 'BK002';
      end if;
      -- Same soft delete as removing a program by hand (migration 0010).
      update public.programs set deleted_at = now(), status = 'draft' where id = v_existing;
    end if;
  end loop;

  insert into public.blocks (
    trainee_id, title, weeks_count, default_deload_pct, auto_publish_next_week, created_by
  )
  values (
    p_trainee_id, trim(p_title), p_weeks_count, p_deload_pct, coalesce(p_auto_publish, false), auth.uid()
  )
  returning id into v_block;

  for v_i in 1..p_weeks_count loop
    insert into public.programs (trainee_id, title, week_start_date, block_id, block_week_index, is_deload)
    values (
      p_trainee_id, trim(p_title), p_start_week + 7 * (v_i - 1), v_block, v_i, v_i = any (v_deload)
    )
    returning id into v_program;
    if v_i = 1 then
      v_week1 := v_program;
    end if;
  end loop;

  if p_source_program_id is not null then
    perform public.block_copy_structure(p_source_program_id, v_week1, false, coalesce(p_use_performed, false));
    perform public.block_apply_structure_internal(v_week1);
  end if;

  return v_block;
end;
$$;

-- "החל את המבנה של השבוע הזה על השבועות הבאים".
create or replace function public.apply_block_structure(p_program_id uuid)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
begin
  if not public.is_trainer() then
    raise exception 'Only the trainer can change a block' using errcode = '42501';
  end if;
  return public.block_apply_structure_internal(p_program_id);
end;
$$;

-- "חשב מחדש": recompute the block's weeks from p_from_index on.
create or replace function public.recompute_block(p_block_id uuid, p_from_index integer default 2)
returns void
language plpgsql
security definer set search_path = public
as $$
begin
  if not public.is_trainer() then
    raise exception 'Only the trainer can recompute a block' using errcode = '42501';
  end if;
  perform public.block_recompute_internal(p_block_id, p_from_index);
end;
$$;

-- Called after the trainee (or the trainer, in a session) logged something
-- on a workout: recomputes the block weeks after that workout's week. The
-- caller must be that workout's trainee or the trainer; a workout that
-- isn't in a block is simply a no-op. Takes no values from the caller — it
-- only re-derives targets from what is already recorded.
create or replace function public.apply_block_progression(p_workout_id uuid)
returns void
language plpgsql
security definer set search_path = public
as $$
declare
  v record;
begin
  select p.block_id, p.block_week_index, p.trainee_id into v
  from public.workouts w
  join public.programs p on p.id = w.program_id
  where w.id = p_workout_id;
  if not found then
    return;
  end if;
  if auth.uid() is distinct from v.trainee_id and not public.is_trainer() then
    raise exception 'Not your workout' using errcode = '42501';
  end if;
  if v.block_id is null then
    return;
  end if;
  perform public.block_recompute_internal(v.block_id, v.block_week_index + 1);
end;
$$;

-- Once-a-week maintenance, run lazily the first time anyone concerned (the
-- trainee or the trainer) looks at the block in a new calendar week:
--   * recompute, because time passing changes outcomes by itself (a week
--     nobody trained in turns from "projected" into "skipped");
--   * publish this week's program if the block is set to do that;
--   * mark the block completed once its last week is behind us.
create or replace function public.block_roll_forward(p_block_id uuid)
returns void
language plpgsql
security definer set search_path = public
as $$
declare
  v_block public.blocks%rowtype;
  v_week date := public.week_start_of(public.israel_today());
  v_last date;
begin
  select * into v_block from public.blocks where id = p_block_id and deleted_at is null;
  if not found then
    return;
  end if;
  if auth.uid() is distinct from v_block.trainee_id and not public.is_trainer() then
    raise exception 'Not your block' using errcode = '42501';
  end if;
  if v_block.status <> 'active' or (v_block.rolled_through is not null and v_block.rolled_through >= v_week) then
    return;
  end if;

  perform public.block_recompute_internal(p_block_id, 2);

  if v_block.auto_publish_next_week then
    update public.programs p
    set status = 'published', published_at = now(), updated_at = now()
    where p.block_id = p_block_id
      and p.deleted_at is null
      and p.status = 'draft'
      and p.week_start_date = v_week
      and exists (
        select 1
        from public.workouts w
        join public.workout_exercises we on we.workout_id = w.id
        where w.program_id = p.id
      );
  end if;

  select max(p.week_start_date) into v_last
  from public.programs p
  where p.block_id = p_block_id and p.deleted_at is null;

  update public.blocks
  set rolled_through = v_week,
      status = case when v_last is null or v_last < v_week then 'completed' else status end
  where id = p_block_id;
end;
$$;

-- One exercise's rule, for this week and every later week of the block
-- (earlier weeks keep the rule they were computed with), then recompute.
create or replace function public.set_exercise_progression(
  p_workout_exercise_id uuid,
  p_type text,
  p_unit text,
  p_step_kg numeric,
  p_step_pct numeric,
  p_reps_step integer,
  p_reps_cap integer,
  p_basis text,
  p_rounding_kg numeric
)
returns void
language plpgsql
security definer set search_path = public
as $$
declare
  v record;
begin
  if not public.is_trainer() then
    raise exception 'Only the trainer can change a progression rule' using errcode = '42501';
  end if;

  select we.slot_key, p.block_id, p.block_week_index into v
  from public.workout_exercises we
  join public.workouts w on w.id = we.workout_id
  join public.programs p on p.id = w.program_id
  where we.id = p_workout_exercise_id;
  if not found then
    raise exception 'Exercise not found' using errcode = 'P0002';
  end if;

  update public.workout_exercises we
  set progression_type = p_type,
      weight_step_unit = p_unit,
      weight_step_kg = p_step_kg,
      weight_step_pct = p_step_pct,
      reps_step = p_reps_step,
      reps_cap = p_reps_cap,
      progression_basis = p_basis,
      rounding_kg = p_rounding_kg
  where we.id = p_workout_exercise_id
     or (
       v.block_id is not null
       and we.slot_key = v.slot_key
       and exists (
         select 1
         from public.workouts w
         join public.programs p on p.id = w.program_id
         where w.id = we.workout_id
           and p.block_id = v.block_id
           and p.deleted_at is null
           and p.block_week_index > v.block_week_index
       )
     );

  if v.block_id is not null then
    perform public.block_recompute_internal(v.block_id, v.block_week_index + 1);
  end if;
end;
$$;

-- "שחזר לאוטומטי": the set goes back to following the computation.
create or replace function public.clear_set_override(p_set_id uuid)
returns void
language plpgsql
security definer set search_path = public
as $$
declare
  v record;
begin
  if not public.is_trainer() then
    raise exception 'Only the trainer can change a set' using errcode = '42501';
  end if;

  select p.block_id, p.block_week_index into v
  from public.workout_exercise_sets s
  join public.workout_exercises we on we.id = s.workout_exercise_id
  join public.workouts w on w.id = we.workout_id
  join public.programs p on p.id = w.program_id
  where s.id = p_set_id;
  if not found then
    raise exception 'Set not found' using errcode = 'P0002';
  end if;

  update public.workout_exercise_sets set is_manual_override = false where id = p_set_id;
  if v.block_id is not null then
    perform public.block_recompute_internal(v.block_id, v.block_week_index);
  end if;
end;
$$;

-- "דחה את הבלוק בשבוע": the trainee missed a whole week. Every block week
-- from p_from_index on moves one calendar week later. Refused if any of
-- those weeks was already started (BK002) or the week it would land on is
-- taken by a program outside this move (BK001).
create or replace function public.shift_block(p_block_id uuid, p_from_index integer)
returns void
language plpgsql
security definer set search_path = public
as $$
declare
  v_trainee uuid;
  v_week record;
  v_ids uuid[];
begin
  if not public.is_trainer() then
    raise exception 'Only the trainer can change a block' using errcode = '42501';
  end if;
  select trainee_id into v_trainee from public.blocks where id = p_block_id and deleted_at is null;
  if not found then
    raise exception 'Block not found' using errcode = 'P0002';
  end if;
  perform public.block_lock(p_block_id);

  select array_agg(p.id) into v_ids
  from public.programs p
  where p.block_id = p_block_id and p.deleted_at is null and p.block_week_index >= p_from_index;
  if v_ids is null then
    return;
  end if;

  for v_week in
    select p.id, p.week_start_date from public.programs p where p.id = any (v_ids)
  loop
    if public.program_has_performance(v_week.id) then
      raise exception 'WEEK_HAS_PERFORMANCE %', v_week.week_start_date using errcode = 'BK002';
    end if;
    if exists (
      select 1 from public.programs o
      where o.trainee_id = v_trainee
        and o.deleted_at is null
        and o.week_start_date = v_week.week_start_date + 7
        and o.id <> all (v_ids)
    ) then
      raise exception 'WEEK_TAKEN %', v_week.week_start_date + 7 using errcode = 'BK001';
    end if;
  end loop;

  -- Latest first, so no two of them ever share a week on the way.
  for v_week in
    select p.id from public.programs p where p.id = any (v_ids) order by p.week_start_date desc
  loop
    update public.programs set week_start_date = week_start_date + 7, updated_at = now() where id = v_week.id;
  end loop;

  perform public.block_recompute_internal(p_block_id, 2);
end;
$$;

-- Adds a NEW deload week right after week p_after_index, pushing the weeks
-- after it one week later (the block gets one week longer). The same
-- refusals as shift_block for the weeks that have to move.
create or replace function public.insert_block_deload(
  p_block_id uuid,
  p_after_index integer,
  p_deload_pct integer default null
)
returns uuid
language plpgsql
security definer set search_path = public
as $$
declare
  v_block public.blocks%rowtype;
  v_after record;
  v_base uuid;
  v_week record;
  v_ids uuid[];
  v_new uuid;
begin
  if not public.is_trainer() then
    raise exception 'Only the trainer can change a block' using errcode = '42501';
  end if;
  select * into v_block from public.blocks where id = p_block_id and deleted_at is null;
  if not found then
    raise exception 'Block not found' using errcode = 'P0002';
  end if;
  perform public.block_lock(p_block_id);
  if v_block.weeks_count >= 16 then
    raise exception 'A block is at most 16 weeks long' using errcode = 'P0001';
  end if;
  if p_deload_pct is not null and (p_deload_pct < 30 or p_deload_pct > 100) then
    raise exception 'The deload percentage is 30 to 100' using errcode = 'P0001';
  end if;

  select p.id, p.week_start_date into v_after
  from public.programs p
  where p.block_id = p_block_id and p.deleted_at is null and p.block_week_index = p_after_index;
  if not found then
    raise exception 'Week not found' using errcode = 'P0002';
  end if;

  -- What the deload week copies: the last real (non-deload) week up to here.
  select p.id into v_base
  from public.programs p
  where p.block_id = p_block_id and p.deleted_at is null and not p.is_deload
    and p.block_week_index <= p_after_index
  order by p.block_week_index desc
  limit 1;
  if not found then
    raise exception 'A deload week needs a regular week before it' using errcode = 'P0001';
  end if;

  select coalesce(array_agg(p.id), '{}') into v_ids
  from public.programs p
  where p.block_id = p_block_id and p.deleted_at is null and p.block_week_index > p_after_index;

  for v_week in
    select p.id, p.week_start_date from public.programs p where p.id = any (v_ids)
  loop
    if public.program_has_performance(v_week.id) then
      raise exception 'WEEK_HAS_PERFORMANCE %', v_week.week_start_date using errcode = 'BK002';
    end if;
    if exists (
      select 1 from public.programs o
      where o.trainee_id = v_block.trainee_id
        and o.deleted_at is null
        and o.week_start_date = v_week.week_start_date + 7
        and o.id <> all (v_ids)
    ) then
      raise exception 'WEEK_TAKEN %', v_week.week_start_date + 7 using errcode = 'BK001';
    end if;
  end loop;
  if exists (
    select 1 from public.programs o
    where o.trainee_id = v_block.trainee_id
      and o.deleted_at is null
      and o.week_start_date = v_after.week_start_date + 7
      and o.id <> all (v_ids)
  ) then
    raise exception 'WEEK_TAKEN %', v_after.week_start_date + 7 using errcode = 'BK001';
  end if;

  -- Latest first: neither the calendar week nor the block week number of
  -- two programs ever coincide on the way.
  for v_week in
    select p.id from public.programs p where p.id = any (v_ids) order by p.block_week_index desc
  loop
    update public.programs
    set week_start_date = week_start_date + 7, block_week_index = block_week_index + 1, updated_at = now()
    where id = v_week.id;
  end loop;

  insert into public.programs (
    trainee_id, title, week_start_date, block_id, block_week_index, is_deload, deload_pct
  )
  values (
    v_block.trainee_id, v_block.title, v_after.week_start_date + 7, p_block_id, p_after_index + 1, true, p_deload_pct
  )
  returning id into v_new;

  perform public.block_copy_structure(v_base, v_new, true);
  update public.blocks set weeks_count = weeks_count + 1 where id = p_block_id;
  perform public.block_recompute_internal(p_block_id, p_after_index + 1);
  return v_new;
end;
$$;

-- Turns an existing block week into a deload week (or back), in place.
-- Not week 1 (nothing to deload from), and not a week already started.
create or replace function public.set_block_week_deload(
  p_program_id uuid,
  p_is_deload boolean,
  p_deload_pct integer default null
)
returns void
language plpgsql
security definer set search_path = public
as $$
declare
  v record;
begin
  if not public.is_trainer() then
    raise exception 'Only the trainer can change a block' using errcode = '42501';
  end if;
  select p.id, p.block_id, p.block_week_index, p.week_start_date into v
  from public.programs p
  where p.id = p_program_id and p.deleted_at is null and p.block_id is not null;
  if not found then
    raise exception 'Week not found' using errcode = 'P0002';
  end if;
  if v.block_week_index < 2 then
    raise exception 'The first week of a block cannot be a deload' using errcode = 'P0001';
  end if;
  if p_deload_pct is not null and (p_deload_pct < 30 or p_deload_pct > 100) then
    raise exception 'The deload percentage is 30 to 100' using errcode = 'P0001';
  end if;
  perform public.block_lock(v.block_id);
  if public.program_has_performance(v.id) then
    raise exception 'WEEK_HAS_PERFORMANCE %', v.week_start_date using errcode = 'BK002';
  end if;

  update public.programs
  set is_deload = coalesce(p_is_deload, false),
      deload_pct = case when coalesce(p_is_deload, false) then p_deload_pct else null end,
      updated_at = now()
  where id = v.id;

  -- The week changes its nature: values set by hand for its old one don't carry over.
  update public.workout_exercise_sets s
  set is_manual_override = false
  from public.workout_exercises we
  join public.workouts w on w.id = we.workout_id
  where s.workout_exercise_id = we.id and w.program_id = v.id and s.is_manual_override;

  perform public.block_recompute_internal(v.block_id, v.block_week_index);
end;
$$;

-- Ends a block now. p_remove_future also removes (soft-deletes) its weeks
-- that haven't begun yet and have nothing recorded in them.
create or replace function public.end_block(p_block_id uuid, p_remove_future boolean default true)
returns void
language plpgsql
security definer set search_path = public
as $$
declare
  v_week date := public.week_start_of(public.israel_today());
begin
  if not public.is_trainer() then
    raise exception 'Only the trainer can end a block' using errcode = '42501';
  end if;
  if not exists (select 1 from public.blocks where id = p_block_id and deleted_at is null) then
    raise exception 'Block not found' using errcode = 'P0002';
  end if;

  if coalesce(p_remove_future, true) then
    update public.programs p
    set deleted_at = now(), status = 'draft'
    where p.block_id = p_block_id
      and p.deleted_at is null
      and p.week_start_date > v_week
      and not public.program_has_performance(p.id);
  end if;
  update public.blocks set status = 'completed' where id = p_block_id;
end;
$$;

-- Deletes a block. Its weeks with nothing recorded go with it (soft
-- delete); a week the trainee trained in stays, as an ordinary weekly
-- program — history is never removed.
create or replace function public.delete_block(p_block_id uuid)
returns void
language plpgsql
security definer set search_path = public
as $$
begin
  if not public.is_trainer() then
    raise exception 'Only the trainer can delete a block' using errcode = '42501';
  end if;
  if not exists (select 1 from public.blocks where id = p_block_id and deleted_at is null) then
    return;
  end if;

  update public.programs p
  set deleted_at = now(), status = 'draft'
  where p.block_id = p_block_id and p.deleted_at is null and not public.program_has_performance(p.id);

  update public.programs
  set block_id = null, block_week_index = null, is_deload = false, deload_pct = null
  where block_id = p_block_id and deleted_at is null;

  update public.blocks set deleted_at = now(), status = 'completed' where id = p_block_id;
end;
$$;

-- "התחל בלוק חדש": a new block right after this one (or from this week, if
-- this one is already behind us), whose first week is a copy of this
-- block's last regular week — its targets, or the weights actually lifted.
create or replace function public.start_next_block(
  p_block_id uuid,
  p_title text,
  p_weeks_count integer,
  p_deload_weeks integer[] default '{}',
  p_deload_pct integer default 60,
  p_use_performed boolean default false,
  p_replace_existing boolean default false
)
returns uuid
language plpgsql
security definer set search_path = public
as $$
declare
  v_block public.blocks%rowtype;
  v_source uuid;
  v_last date;
begin
  if not public.is_trainer() then
    raise exception 'Only the trainer can create a block' using errcode = '42501';
  end if;
  select * into v_block from public.blocks where id = p_block_id and deleted_at is null;
  if not found then
    raise exception 'Block not found' using errcode = 'P0002';
  end if;

  select p.id into v_source
  from public.programs p
  where p.block_id = p_block_id and p.deleted_at is null and not p.is_deload
  order by p.block_week_index desc
  limit 1;

  select max(p.week_start_date) into v_last
  from public.programs p
  where p.block_id = p_block_id and p.deleted_at is null;

  return public.create_block(
    v_block.trainee_id,
    p_title,
    greatest(coalesce(v_last + 7, public.week_start_of(public.israel_today())),
             public.week_start_of(public.israel_today())),
    p_weeks_count,
    p_deload_weeks,
    p_deload_pct,
    v_source,
    p_use_performed,
    p_replace_existing,
    v_block.auto_publish_next_week
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Who may call what. The internal pieces are reachable only through the
-- checked functions above (which run as their owner).
-- ---------------------------------------------------------------------------

revoke execute on function public.block_lock(uuid) from public, anon, authenticated;
revoke execute on function public.program_has_performance(uuid) from public, anon, authenticated;
revoke execute on function public.block_copy_structure(uuid, uuid, boolean, boolean) from public, anon, authenticated;
revoke execute on function public.block_recompute_internal(uuid, integer) from public, anon, authenticated;
revoke execute on function public.block_apply_structure_internal(uuid) from public, anon, authenticated;

revoke execute on function public.create_block(uuid, text, date, integer, integer[], integer, uuid, boolean, boolean, boolean) from public, anon;
revoke execute on function public.apply_block_structure(uuid) from public, anon;
revoke execute on function public.recompute_block(uuid, integer) from public, anon;
revoke execute on function public.apply_block_progression(uuid) from public, anon;
revoke execute on function public.block_roll_forward(uuid) from public, anon;
revoke execute on function public.set_exercise_progression(uuid, text, text, numeric, numeric, integer, integer, text, numeric) from public, anon;
revoke execute on function public.clear_set_override(uuid) from public, anon;
revoke execute on function public.shift_block(uuid, integer) from public, anon;
revoke execute on function public.insert_block_deload(uuid, integer, integer) from public, anon;
revoke execute on function public.set_block_week_deload(uuid, boolean, integer) from public, anon;
revoke execute on function public.end_block(uuid, boolean) from public, anon;
revoke execute on function public.delete_block(uuid) from public, anon;
revoke execute on function public.start_next_block(uuid, text, integer, integer[], integer, boolean, boolean) from public, anon;

grant execute on function public.create_block(uuid, text, date, integer, integer[], integer, uuid, boolean, boolean, boolean) to authenticated;
grant execute on function public.apply_block_structure(uuid) to authenticated;
grant execute on function public.recompute_block(uuid, integer) to authenticated;
grant execute on function public.apply_block_progression(uuid) to authenticated;
grant execute on function public.block_roll_forward(uuid) to authenticated;
grant execute on function public.set_exercise_progression(uuid, text, text, numeric, numeric, integer, integer, text, numeric) to authenticated;
grant execute on function public.clear_set_override(uuid) to authenticated;
grant execute on function public.shift_block(uuid, integer) to authenticated;
grant execute on function public.insert_block_deload(uuid, integer, integer) to authenticated;
grant execute on function public.set_block_week_deload(uuid, boolean, integer) to authenticated;
grant execute on function public.end_block(uuid, boolean) to authenticated;
grant execute on function public.delete_block(uuid) to authenticated;
grant execute on function public.start_next_block(uuid, text, integer, integer[], integer, boolean, boolean) to authenticated;
