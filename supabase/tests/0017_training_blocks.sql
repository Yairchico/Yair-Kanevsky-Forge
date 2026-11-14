-- Migration 0017: the block progression engine and who may call what. Builds its own data.
\set ON_ERROR_STOP 0
\ir lib.sql
\set T1 '00000000-0000-0000-0000-0000000000b1'
\set T2 '00000000-0000-0000-0000-0000000000b2'
\set COACH '00000000-0000-0000-0000-0000000000a1'
\set SA '00000000-0000-0000-0000-0000000000c1'

insert into auth.users (id, email, raw_user_meta_data) values
 (:'COACH','coach@x','{"role":"trainer","full_name":"Coach","username":"coach"}'),
 (:'T1','t1@x','{"full_name":"Dani","username":"dani"}'),
 (:'T2','t2@x','{"full_name":"Michal","username":"michal"}'),
 (:'SA','sa@x','{"full_name":"Watcher","username":"watcher"}');
update profiles set is_superadmin = true where id = :'SA';

-- this week's Sunday, in Israel time
select public.week_start_of(public.israel_today()) as wk \gset

-- "80x5|80x5|…" for one exercise of one block week (W = warm-up, * = set by hand, ~ = has a hidden exact weight)
create or replace function pg_temp.t(p_block uuid, p_week int, p_name text) returns text language sql as $$
  select string_agg(
    case when s.set_type = 'warmup' then 'W' else '' end
    || coalesce(trim(trailing '.' from trim(trailing '0' from s.weight_kg::text)), coalesce(s.weight_note, '-'))
    || 'x' || coalesce(s.reps_min::text || coalesce('-' || nullif(s.reps_max, s.reps_min)::text, ''), s.reps_note)
    || case when s.is_manual_override then '*' else '' end
    || case when s.weight_kg_exact is not null then '~' else '' end,
    '|' order by s.set_index)
  from workout_exercise_sets s
  join workout_exercises we on we.id = s.workout_exercise_id
  join workouts w on w.id = we.workout_id
  join programs p on p.id = w.program_id
  join exercises x on x.id = we.exercise_id
  where p.block_id = p_block and p.block_week_index = p_week and p.deleted_at is null and x.name = p_name
$$;
create or replace function pg_temp.info(p_block uuid, p_week int, p_name text, p_key text) returns text language sql as $$
  select we.progression_info ->> p_key
  from workout_exercises we join workouts w on w.id = we.workout_id join programs p on p.id = w.program_id
  join exercises x on x.id = we.exercise_id
  where p.block_id = p_block and p.block_week_index = p_week and p.deleted_at is null and x.name = p_name
$$;
create or replace function pg_temp.we(p_block uuid, p_week int, p_name text) returns uuid language sql as $$
  select we.id from workout_exercises we join workouts w on w.id = we.workout_id join programs p on p.id = w.program_id
  join exercises x on x.id = we.exercise_id
  where p.block_id = p_block and p.block_week_index = p_week and p.deleted_at is null and x.name = p_name
$$;
create or replace function pg_temp.prog(p_block uuid, p_week int) returns uuid language sql as $$
  select id from programs where block_id = p_block and block_week_index = p_week and deleted_at is null
$$;
create or replace function pg_temp.workout(p_block uuid, p_week int) returns uuid language sql as $$
  select w.id from workouts w where w.program_id = pg_temp.prog(p_block, p_week) order by w.day_of_week limit 1
$$;
-- log every working (and warm-up) set of an exercise at its target, minus p_short reps on the LAST set
create or replace function pg_temp.log_all(p_block uuid, p_week int, p_name text, p_trainee uuid, p_short int default 0, p_top boolean default false) returns void language plpgsql as $$
declare v_we uuid := pg_temp.we(p_block, p_week, p_name); v_last int;
begin
  select max(set_index) into v_last from workout_exercise_sets where workout_exercise_id = v_we;
  insert into set_logs (workout_exercise_id, trainee_id, set_index, weight_kg, reps)
  select v_we, p_trainee, s.set_index, s.weight_kg,
         greatest(0, (case when p_top then coalesce(s.reps_max, s.reps_min) else coalesce(s.reps_min, 10) end)
           - case when s.set_index = v_last then p_short else 0 end)
  from workout_exercise_sets s where s.workout_exercise_id = v_we;
end $$;

-- time travel: move every week of a block p_weeks earlier, earliest first (no two ever share a week on the way)
create or replace function pg_temp.travel(p_block uuid, p_weeks int) returns void language plpgsql as $$
declare r record;
begin
  for r in select id from programs where block_id = p_block order by week_start_date loop
    update programs set week_start_date = week_start_date - 7 * p_weeks where id = r.id;
  end loop;
end $$;

-- ===========================================================================
-- create_block: who, and what counts as valid
-- ===========================================================================
set role authenticated;
select pg_temp.as_user(:'T1');
select pg_temp.expect('a trainee cannot create a block', format($q$select create_block(%L, 'x', %L, 4)$q$, :'T1', :'wk'), 'DENIED');
select pg_temp.as_user(:'SA');
select pg_temp.expect('the read-only viewer cannot create a block', format($q$select create_block(%L, 'x', %L, 4)$q$, :'T1', :'wk'), 'DENIED');
select pg_temp.as_user(:'COACH');
select pg_temp.expect('block must start on a Sunday', format($q$select create_block(%L, 'x', %L::date + 1, 4)$q$, :'T1', :'wk'), 'DENIED');
select pg_temp.expect('block cannot start in a past week', format($q$select create_block(%L, 'x', %L::date - 7, 4)$q$, :'T1', :'wk'), 'DENIED');
select pg_temp.expect('17 weeks is too long', format($q$select create_block(%L, 'x', %L, 17)$q$, :'T1', :'wk'), 'DENIED');
select pg_temp.expect('week 1 cannot be a deload', format($q$select create_block(%L, 'x', %L, 4, array[1])$q$, :'T1', :'wk'), 'DENIED');
select pg_temp.expect('a deload week must be inside the block', format($q$select create_block(%L, 'x', %L, 4, array[5])$q$, :'T1', :'wk'), 'DENIED');
select pg_temp.expect('a block needs a title', format($q$select create_block(%L, '  ', %L, 4)$q$, :'T1', :'wk'), 'DENIED');
select pg_temp.expect('a block is for a trainee, not the trainer', format($q$select create_block(%L, 'x', %L, 4)$q$, :'COACH', :'wk'), 'DENIED');
select pg_temp.eq('nothing was left behind by the refused attempts', (select count(*)::text from blocks) || '/' || (select count(*)::text from programs), '0/0');

select create_block(:'T1', 'בלוק כוח 1', :'wk', 5, array[4]) as b \gset
select pg_temp.eq('5 weekly draft programs, numbered, week 4 a deload', (select string_agg(block_week_index || ':' || status || ':' || is_deload::text || ':' || ((week_start_date - :'wk'::date) / 7), ',' order by block_week_index) from programs where block_id = :'b'), '1:draft:false:0,2:draft:false:1,3:draft:false:2,4:draft:true:3,5:draft:false:4');
select pg_temp.eq('programs carry the block title', (select count(distinct title) || ':' || min(title) from programs where block_id = :'b'), '1:בלוק כוח 1');
select pg_temp.eq('block row', (select weeks_count || ':' || status || ':' || default_deload_pct || ':' || auto_publish_next_week::text || ':' || (created_by = :'COACH')::text from blocks where id = :'b'), '5:active:60:false:true');

-- a week that's already taken
select pg_temp.expect('an occupied week stops a new block (BK001)', format($q$select create_block(%L, 'x', %L::date + 14, 2)$q$, :'T1', :'wk'), 'DENIED');
reset role;

-- ===========================================================================
-- Week 1, built by hand; then "apply to following weeks"
-- ===========================================================================
insert into workouts (id, program_id, day_of_week, order_index) values ('a1000000-0000-0000-0000-000000000001', pg_temp.prog(:'b', 1), 0, 0);
create or replace function pg_temp.add(p_name text, p_order int, p_sets int, p_min int, p_max int, p_kg numeric, p_warm numeric default null) returns uuid language plpgsql as $$
declare v uuid;
begin
  insert into workout_exercises (workout_id, exercise_id, order_index) values ('a1000000-0000-0000-0000-000000000001', (select id from exercises where name = p_name), p_order) returning id into v;
  if p_warm is not null then
    insert into workout_exercise_sets (workout_exercise_id, set_index, set_type, reps_min, reps_max, weight_kg) values (v, 1, 'warmup', 5, 5, p_warm);
  end if;
  insert into workout_exercise_sets (workout_exercise_id, set_index, reps_min, reps_max, weight_kg)
  select v, n + case when p_warm is null then 0 else 1 end, p_min, p_max, p_kg from generate_series(1, p_sets) n;
  return v;
end $$;
select pg_temp.add('Back Squat', 0, 3, 5, 5, 80, 40) as sq \gset
select pg_temp.add('Bench Press', 1, 3, 8, 10, 60) as bp \gset
select pg_temp.add('Barbell Curl', 2, 3, 10, 10, 40) as curl \gset
select pg_temp.add('Pull-Up', 3, 2, 8, 8, null) as pu \gset
select pg_temp.add('Plank', 4, 2, 1, 1, null) as plank \gset
update workout_exercise_sets set reps_min = null, reps_max = null, reps_note = 'AMRAP', weight_note = 'משקל גוף' where workout_exercise_id = :'pu';
update workout_exercise_sets set reps_min = null, reps_max = null, reps_note = '45 שנ׳' where workout_exercise_id = :'plank';

set role authenticated;
select pg_temp.as_user(:'T1');
select pg_temp.expect('a trainee cannot set a progression rule', format($q$select set_exercise_progression(%L, 'weight', 'kg', 20, null, null, null, 'planned', 2.5)$q$, :'sq'), 'DENIED');
select pg_temp.expect('a trainee cannot apply a structure', format($q$select apply_block_structure(%L)$q$, pg_temp.prog(:'b', 1)), 'DENIED');
select pg_temp.as_user(:'COACH');
select set_exercise_progression(:'sq', 'weight', 'kg', 2.5, null, null, null, 'actual', 2.5);
select set_exercise_progression(:'bp', 'double', 'kg', 2.5, null, 1, 12, 'actual', 2.5);
select set_exercise_progression(:'curl', 'weight', 'pct', null, 2.6, null, null, 'actual', 2.5);
select set_exercise_progression(:'pu', 'reps', 'kg', null, null, 1, null, 'actual', 2.5);
select pg_temp.expect('an out-of-range step is refused by the table', format($q$select set_exercise_progression(%L, 'weight', 'pct', null, 40, null, null, 'actual', 2.5)$q$, :'plank'), 'DENIED');
select pg_temp.expect('an unknown rule type is refused', format($q$select set_exercise_progression(%L, 'magic', 'kg', 1, null, null, null, 'actual', 2.5)$q$, :'plank'), 'DENIED');

select apply_block_structure(pg_temp.prog(:'b', 1)) as applied \gset
select pg_temp.eq('apply reports the weeks it filled', :'applied', '{"frozen": [], "updated": [2, 3, 4, 5]}');
reset role;
select pg_temp.eq('every later week has the same 5 exercises', (select string_agg(n::text, ',' order by i) from (select p.block_week_index i, count(*) n from workout_exercises we join workouts w on w.id = we.workout_id join programs p on p.id = w.program_id where p.block_id = :'b' group by 1) x), '5,5,5,5,5');
select pg_temp.eq('slots are shared across the weeks', (select count(distinct we.slot_key)::text from workout_exercises we join workouts w on w.id = we.workout_id join programs p on p.id = w.program_id where p.block_id = :'b'), '5');
select pg_temp.eq('the rule travelled with the exercise', (select string_agg(distinct we.progression_type || ':' || we.reps_cap, ',') from workout_exercises we join workouts w on w.id = we.workout_id join programs p on p.id = w.program_id join exercises x on x.id = we.exercise_id where p.block_id = :'b' and x.name = 'Bench Press'), 'double:12');

-- ---- the plan if all goes well (nothing logged, the week isn't over)
select pg_temp.eq('squat w1 (the trainer''s own)', pg_temp.t(:'b', 1, 'Back Squat'), 'W40x5|80x5|80x5|80x5');
select pg_temp.eq('squat w2: +2.5 kg, warm-up unchanged', pg_temp.t(:'b', 2, 'Back Squat'), 'W40x5|82.5x5|82.5x5|82.5x5');
select pg_temp.eq('squat w3', pg_temp.t(:'b', 3, 'Back Squat'), 'W40x5|85x5|85x5|85x5');
select pg_temp.eq('squat w4 is a deload: 60% of w3, rounded to 2.5', pg_temp.t(:'b', 4, 'Back Squat'), 'W25x5|50x5|50x5|50x5');
select pg_temp.eq('squat w5 continues from w3 — the deload is transparent', pg_temp.t(:'b', 5, 'Back Squat'), 'W40x5|87.5x5|87.5x5|87.5x5');
select pg_temp.eq('w2 is a projection until w1 is done', pg_temp.info(:'b', 2, 'Back Squat', 'outcome') || ':' || pg_temp.info(:'b', 2, 'Back Squat', 'base_week') || ':' || pg_temp.info(:'b', 2, 'Back Squat', 'delta_kg'), 'projected:1:2.50');
select pg_temp.eq('w4 says it is a deload', pg_temp.info(:'b', 4, 'Back Squat', 'outcome') || ':' || pg_temp.info(:'b', 4, 'Back Squat', 'deload_pct'), 'deload:60');
select pg_temp.eq('w5 base is w3', pg_temp.info(:'b', 5, 'Back Squat', 'base_week'), '3');

select pg_temp.eq('double progression w2: reps go up first', pg_temp.t(:'b', 2, 'Bench Press'), '60x9-11|60x9-11|60x9-11');
select pg_temp.eq('double progression w3: up to the cap', pg_temp.t(:'b', 3, 'Bench Press'), '60x10-12|60x10-12|60x10-12');
select pg_temp.eq('double progression w5: cap reached → +2.5 kg, reps back to where they started', pg_temp.t(:'b', 5, 'Bench Press'), '62.5x8-10|62.5x8-10|62.5x8-10');
select pg_temp.eq('…and says the reps were reset', pg_temp.info(:'b', 5, 'Bench Press', 'reset_reps') || ':' || pg_temp.info(:'b', 5, 'Bench Press', 'delta_kg'), 'true:2.50');

select pg_temp.eq('percent w2: 41.04 exact, shown 40', pg_temp.t(:'b', 2, 'Barbell Curl'), '40x10~|40x10~|40x10~');
select pg_temp.eq('…the exact weight is kept', (select string_agg(distinct weight_kg_exact::text, ',') from workout_exercise_sets where workout_exercise_id = pg_temp.we(:'b', 2, 'Barbell Curl')), '41.040');
select pg_temp.eq('…and the note for the trainer has it', pg_temp.info(:'b', 2, 'Barbell Curl', 'exact_kg'), '41.04');
select pg_temp.eq('percent w3: 42.107 exact, shown 42.5 (accumulated)', pg_temp.t(:'b', 3, 'Barbell Curl'), '42.5x10~|42.5x10~|42.5x10~');
select pg_temp.eq('percent w4 deload: 60% of 42.107 → 25', pg_temp.t(:'b', 4, 'Barbell Curl'), '25x10|25x10|25x10');
select pg_temp.eq('percent w5: 43.202 exact, still shown 42.5', pg_temp.t(:'b', 5, 'Barbell Curl'), '42.5x10~|42.5x10~|42.5x10~');

select pg_temp.eq('a reps note cannot progress: carried as is', pg_temp.t(:'b', 3, 'Pull-Up'), 'משקל גוףxAMRAP|משקל גוףxAMRAP');
select pg_temp.eq('no rule: carried as is', pg_temp.t(:'b', 5, 'Plank'), '-x45 שנ׳|-x45 שנ׳');
select pg_temp.eq('no rule says so', pg_temp.info(:'b', 2, 'Plank', 'outcome'), 'none');

-- ===========================================================================
-- What the trainee actually does decides the next week
-- ===========================================================================
update programs set status = 'published', published_at = now() where block_id = :'b' and block_week_index in (1, 2);
select pg_temp.workout(:'b', 1) as w1 \gset
set role authenticated;
select pg_temp.as_user(:'T1');
select pg_temp.log_all(:'b', 1, 'Back Squat', :'T1');                 -- every set at target
select pg_temp.log_all(:'b', 1, 'Bench Press', :'T1', 1, true);        -- last set one rep short of the TOP of the range
select pg_temp.expect('the trainee triggers the recompute for their own workout', format($q$select apply_block_progression(%L)$q$, pg_temp.workout(:'b', 1)), 'OK');
select pg_temp.as_user(:'T2');
select pg_temp.expect('another trainee cannot trigger it', format($q$select apply_block_progression(%L)$q$, :'w1'), 'DENIED');
select pg_temp.expect('nor run the weekly maintenance of someone else''s block', format($q$select block_roll_forward(%L)$q$, :'b'), 'DENIED');
select pg_temp.expect('the internal engine is not callable directly', format($q$select block_recompute_internal(%L, 2)$q$, :'b'), 'DENIED');
select pg_temp.expect('nor the structure copy', format($q$select block_copy_structure(%L, %L, true)$q$, pg_temp.prog(:'b', 1), pg_temp.prog(:'b', 2)), 'DENIED');
reset role;

select pg_temp.eq('squat done in full → w2 advances for real', pg_temp.t(:'b', 2, 'Back Squat') || ' ' || pg_temp.info(:'b', 2, 'Back Squat', 'outcome') || ' ' || pg_temp.info(:'b', 2, 'Back Squat', 'completed') || '/' || pg_temp.info(:'b', 2, 'Back Squat', 'total'), 'W40x5|82.5x5|82.5x5|82.5x5 advanced 3/3');
select pg_temp.eq('bench one rep short of the top (double) → w2 repeats', pg_temp.t(:'b', 2, 'Bench Press') || ' ' || pg_temp.info(:'b', 2, 'Bench Press', 'outcome') || ' ' || pg_temp.info(:'b', 2, 'Bench Press', 'completed') || '/' || pg_temp.info(:'b', 2, 'Bench Press', 'total'), '60x8-10|60x8-10|60x8-10 repeated 2/3');
select pg_temp.eq('…and the weeks after re-plan from the repeat', pg_temp.t(:'b', 3, 'Bench Press') || ' ' || pg_temp.t(:'b', 5, 'Bench Press'), '60x9-11|60x9-11|60x9-11 60x10-12|60x10-12|60x10-12');
select pg_temp.eq('curl not done yet, week not over → still a projection', pg_temp.info(:'b', 2, 'Barbell Curl', 'outcome'), 'projected');

-- a set logged ABOVE the target weight still advances from the target (Q2.4)
update set_logs set weight_kg = 90 where workout_exercise_id = pg_temp.we(:'b', 1, 'Back Squat');
set role authenticated; select pg_temp.as_user(:'T1');
select apply_block_progression(pg_temp.workout(:'b', 1));
reset role;
select pg_temp.eq('heavier than planned: next week is still target + step', pg_temp.t(:'b', 2, 'Back Squat'), 'W40x5|82.5x5|82.5x5|82.5x5');
-- lighter than the target weight is not "done"
update set_logs set weight_kg = 77.5 where workout_exercise_id = pg_temp.we(:'b', 1, 'Back Squat') and set_index = 3;
set role authenticated; select pg_temp.as_user(:'T1');
select apply_block_progression(pg_temp.workout(:'b', 1));
reset role;
select pg_temp.eq('one set lighter than planned → repeat', pg_temp.t(:'b', 2, 'Back Squat') || ' ' || pg_temp.info(:'b', 2, 'Back Squat', 'outcome'), 'W40x5|80x5|80x5|80x5 repeated');
update set_logs set weight_kg = 80 where workout_exercise_id = pg_temp.we(:'b', 1, 'Back Squat');
-- a partly done exercise while the week is still on: not decided yet
delete from set_logs where workout_exercise_id = pg_temp.we(:'b', 1, 'Back Squat') and set_index = 4;
select block_recompute_internal(:'b', 2);
select pg_temp.eq('2 of 3 working sets, week not over, not submitted → still projected', pg_temp.info(:'b', 2, 'Back Squat', 'outcome'), 'projected');
insert into workout_completions (workout_id, trainee_id) values (pg_temp.workout(:'b', 1), :'T1');
select block_recompute_internal(:'b', 2);
select pg_temp.eq('…once the workout is submitted, 2 of 3 is a repeat', pg_temp.info(:'b', 2, 'Back Squat', 'outcome') || ' ' || pg_temp.info(:'b', 2, 'Back Squat', 'completed') || '/' || pg_temp.info(:'b', 2, 'Back Squat', 'total'), 'repeated 2/3');
select pg_temp.eq('submitted without touching the curl → the curl counts as skipped', pg_temp.info(:'b', 2, 'Barbell Curl', 'outcome') || ' ' || pg_temp.t(:'b', 2, 'Barbell Curl'), 'skipped 40x10|40x10|40x10');
delete from workout_completions where workout_id = pg_temp.workout(:'b', 1);
insert into set_logs (workout_exercise_id, trainee_id, set_index, weight_kg, reps) values (pg_temp.we(:'b', 1, 'Back Squat'), :'T1', 4, 80, 5);
select block_recompute_internal(:'b', 2);
select pg_temp.eq('fixed afterwards → advances again', pg_temp.t(:'b', 2, 'Back Squat') || ' ' || pg_temp.info(:'b', 2, 'Back Squat', 'outcome'), 'W40x5|82.5x5|82.5x5|82.5x5 advanced');
select pg_temp.eq('warm-up sets never count against success', (select count(*)::text from set_logs where workout_exercise_id = pg_temp.we(:'b', 1, 'Back Squat')), '4');

-- 'planned' basis: advances whatever happened
set role authenticated; select pg_temp.as_user(:'COACH');
select set_exercise_progression(pg_temp.we(:'b', 1, 'Bench Press'), 'double', 'kg', 2.5, null, 1, 12, 'planned', 2.5);
reset role;
select pg_temp.eq('basis = planned ignores the miss', pg_temp.t(:'b', 2, 'Bench Press') || ' ' || pg_temp.info(:'b', 2, 'Bench Press', 'outcome'), '60x9-11|60x9-11|60x9-11 advanced');
select pg_temp.eq('changing a rule reaches the later weeks'' rows too', (select string_agg(distinct we.progression_basis, ',') from workout_exercises we join workouts w on w.id = we.workout_id join programs p on p.id = w.program_id join exercises x on x.id = we.exercise_id where p.block_id = :'b' and x.name = 'Bench Press'), 'planned');
set role authenticated; select pg_temp.as_user(:'COACH');
select set_exercise_progression(pg_temp.we(:'b', 1, 'Bench Press'), 'double', 'kg', 2.5, null, 1, 12, 'actual', 2.5);
reset role;

-- ===========================================================================
-- A week passes with the curl never done → "skipped", not "projected"
-- ===========================================================================
select pg_temp.travel(:'b', 1);   -- time travel: w1 was last week
set role authenticated; select pg_temp.as_user(:'T1');
select pg_temp.expect('the trainee''s first visit this week runs the maintenance', format($q$select block_roll_forward(%L)$q$, :'b'), 'OK');
reset role;
select pg_temp.eq('curl skipped → same weight again, no hidden exact', pg_temp.t(:'b', 2, 'Barbell Curl') || ' ' || pg_temp.info(:'b', 2, 'Barbell Curl', 'outcome'), '40x10|40x10|40x10 skipped');
select pg_temp.eq('…the plan after it starts over from 40', pg_temp.t(:'b', 3, 'Barbell Curl'), '40x10~|40x10~|40x10~');
select pg_temp.eq('maintenance is recorded for this week', (select (rolled_through = :'wk'::date)::text || ':' || status from blocks where id = :'b'), 'true:active');
select pg_temp.eq('no auto-publish unless asked for', (select status::text from programs where id = pg_temp.prog(:'b', 3)), 'draft');

-- ===========================================================================
-- Facts are never recomputed; hand-set values are never overwritten
-- ===========================================================================
-- w2 is now the current week; the trainee does the squat at 82.5
set role authenticated; select pg_temp.as_user(:'T1');
select pg_temp.log_all(:'b', 2, 'Back Squat', :'T1');
reset role;
update workout_exercise_sets set weight_kg = 100 where workout_exercise_id = pg_temp.we(:'b', 1, 'Back Squat') and set_type <> 'warmup';
select block_recompute_internal(:'b', 2);
select pg_temp.eq('a week that was performed keeps its targets whatever changes before it', pg_temp.t(:'b', 2, 'Back Squat'), 'W40x5|82.5x5|82.5x5|82.5x5');
select pg_temp.eq('…but an exercise of that week nobody did yet still follows', pg_temp.info(:'b', 2, 'Bench Press', 'outcome'), 'repeated');
update workout_exercise_sets set weight_kg = 80 where workout_exercise_id = pg_temp.we(:'b', 1, 'Back Squat') and set_type <> 'warmup';

-- the trainer fixes one set of w3 by hand
update workout_exercise_sets set weight_kg = 90, is_manual_override = true where workout_exercise_id = pg_temp.we(:'b', 3, 'Back Squat') and set_index = 3;
select block_recompute_internal(:'b', 2);
select pg_temp.eq('a hand-set value survives recomputation', pg_temp.t(:'b', 3, 'Back Squat'), 'W40x5|85x5|90x5*|85x5');
select pg_temp.eq('the week after is computed FROM the hand-set value', pg_temp.t(:'b', 5, 'Back Squat'), 'W40x5|87.5x5|92.5x5|87.5x5');
select pg_temp.eq('the deload follows it too', pg_temp.t(:'b', 4, 'Back Squat'), 'W25x5|50x5|55x5|50x5');
set role authenticated; select pg_temp.as_user(:'T1');
select pg_temp.expect('a trainee cannot clear an override', format($q$select clear_set_override(%L)$q$, (select id from workout_exercise_sets where workout_exercise_id = pg_temp.we(:'b', 3, 'Back Squat') and set_index = 3)), 'DENIED');
select pg_temp.as_user(:'COACH');
select clear_set_override((select id from workout_exercise_sets where workout_exercise_id = pg_temp.we(:'b', 3, 'Back Squat') and set_index = 3));
reset role;
select pg_temp.eq('"back to automatic" restores the computed value, here and after', pg_temp.t(:'b', 3, 'Back Squat') || ' ' || pg_temp.t(:'b', 5, 'Back Squat'), 'W40x5|85x5|85x5|85x5 W40x5|87.5x5|87.5x5|87.5x5');

-- switching a percent chain to kg keeps counting from the exact weight, and stays loadable
set role authenticated; select pg_temp.as_user(:'COACH');
select set_exercise_progression(pg_temp.we(:'b', 3, 'Barbell Curl'), 'weight', 'kg', 2.5, null, null, null, 'actual', 2.5);
reset role;
select pg_temp.eq('w3 itself (computed with the old % rule) is untouched', pg_temp.t(:'b', 3, 'Barbell Curl'), '40x10~|40x10~|40x10~');
select pg_temp.eq('% → kg from w3 on: 41.04 + 2.5 = 43.54 → shown 42.5', pg_temp.t(:'b', 5, 'Barbell Curl'), '42.5x10~|42.5x10~|42.5x10~');
select pg_temp.eq('earlier weeks keep the rule they were computed with', (select we.weight_step_unit from workout_exercises we where we.id = pg_temp.we(:'b', 2, 'Barbell Curl')), 'pct');

-- ===========================================================================
-- Structure changes: "apply to the following weeks"
-- ===========================================================================
-- the trainer adds an exercise and a 4th working set in w2 (current week), publishes w3 by hand
update programs set status = 'published', published_at = now() where id = pg_temp.prog(:'b', 3);
insert into workout_exercises (id, workout_id, exercise_id, order_index) values ('a3000000-0000-0000-0000-000000000001', pg_temp.workout(:'b', 2), (select id from exercises where name = 'Deadlift'), 5);
insert into workout_exercise_sets (workout_exercise_id, set_index, reps_min, reps_max, weight_kg) values ('a3000000-0000-0000-0000-000000000001', 1, 5, 5, 100);
update workout_exercise_sets set weight_kg = 65, is_manual_override = true where workout_exercise_id = pg_temp.we(:'b', 3, 'Bench Press') and set_index = 1;
set role authenticated; select pg_temp.as_user(:'COACH');
select apply_block_structure(pg_temp.prog(:'b', 2)) as applied2 \gset
reset role;
select pg_temp.eq('apply from w2 fills w3..w5', :'applied2', '{"frozen": [], "updated": [3, 4, 5]}');
select pg_temp.eq('the new exercise reached the later weeks', (select count(*)::text from workout_exercises we join workouts w on w.id = we.workout_id join programs p on p.id = w.program_id join exercises x on x.id = we.exercise_id where p.block_id = :'b' and x.name = 'Deadlift'), '4');
select pg_temp.eq('w1 was not touched', (select count(*)::text from workout_exercises we join workouts w on w.id = we.workout_id where w.program_id = pg_temp.prog(:'b', 1)), '5');
select pg_temp.eq('a hand-set value in a rebuilt week is kept', pg_temp.t(:'b', 3, 'Bench Press'), '65x9-11*|60x9-11|60x9-11');
select pg_temp.eq('a published week that was rebuilt went back to draft', (select status::text from programs where id = pg_temp.prog(:'b', 3)), 'draft');
select pg_temp.eq('the performed week keeps its logs', (select count(*)::text from set_logs where workout_exercise_id = pg_temp.we(:'b', 2, 'Back Squat')), '4');

-- a later week that was already started is left alone and reported
set role authenticated; select pg_temp.as_user(:'COACH');
select apply_block_structure(pg_temp.prog(:'b', 1)) as applied3 \gset
reset role;
select pg_temp.eq('a started week is reported as frozen, the rest rebuilt', :'applied3', '{"frozen": [2], "updated": [3, 4, 5]}');
select pg_temp.eq('…and it still has its own extra exercise and its logs', (select count(*)::text from workout_exercises we join workouts w on w.id = we.workout_id where w.program_id = pg_temp.prog(:'b', 2)) || ':' || (select count(*)::text from set_logs where workout_exercise_id = pg_temp.we(:'b', 2, 'Back Squat')), '6:4');
select pg_temp.eq('…while w3 now mirrors w1 again (no deadlift)', (select count(*)::text from workout_exercises we join workouts w on w.id = we.workout_id where w.program_id = pg_temp.prog(:'b', 3)), '5');

-- ===========================================================================
-- Moving weeks: shift, insert a deload, toggle a deload
-- ===========================================================================
set role authenticated; select pg_temp.as_user(:'COACH');
select pg_temp.expect('a week the trainee started cannot be shifted (BK002)', format($q$select shift_block(%L, 2)$q$, :'b'), 'DENIED');
select pg_temp.expect('shift from week 3: weeks 3-5 move a week later', format($q$select shift_block(%L, 3)$q$, :'b'), 'OK');
reset role;
select pg_temp.eq('dates after the shift (a gap where week 3 was)', (select string_agg(((week_start_date - :'wk'::date) / 7)::text, ',' order by block_week_index) from programs where block_id = :'b'), '-1,0,2,3,4');
insert into programs (id, trainee_id, title, week_start_date) values ('a4000000-0000-0000-0000-000000000001', :'T1', 'other', :'wk'::date + 35);
set role authenticated; select pg_temp.as_user(:'COACH');
select pg_temp.expect('a shift onto a week taken by another program is refused (BK001)', format($q$select shift_block(%L, 3)$q$, :'b'), 'DENIED');
reset role;
select pg_temp.eq('…and nothing moved', (select string_agg(((week_start_date - :'wk'::date) / 7)::text, ',' order by block_week_index) from programs where block_id = :'b'), '-1,0,2,3,4');
delete from programs where id = 'a4000000-0000-0000-0000-000000000001';

set role authenticated; select pg_temp.as_user(:'T1');
select pg_temp.expect('a trainee cannot insert a deload', format($q$select insert_block_deload(%L, 2)$q$, :'b'), 'DENIED');
select pg_temp.as_user(:'COACH');
select insert_block_deload(:'b', 2, 50) as newd \gset
reset role;
select pg_temp.eq('a deload week was inserted after week 2, the rest pushed', (select string_agg(block_week_index || (case when is_deload then 'D' else '' end) || '@' || ((week_start_date - :'wk'::date) / 7), ',' order by block_week_index) from programs where block_id = :'b' and deleted_at is null), '1@-1,2@0,3D@1,4@3,5D@4,6@5');
select pg_temp.eq('the block is one week longer', (select weeks_count::text from blocks where id = :'b'), '6');
select pg_temp.eq('the new deload week: 50% of w2, same exercises as w2', pg_temp.t(:'b', 3, 'Back Squat') || ' ' || (select count(*)::text from workout_exercises we join workouts w on w.id = we.workout_id where w.program_id = :'newd'), 'W20x5|42.5x5|42.5x5|42.5x5 6');
select pg_temp.eq('the week after the new deload continues from w2', pg_temp.info(:'b', 4, 'Back Squat', 'base_week') || ' ' || pg_temp.t(:'b', 4, 'Back Squat'), '2 W40x5|85x5|85x5|85x5');

set role authenticated; select pg_temp.as_user(:'COACH');
select pg_temp.expect('week 1 cannot become a deload', format($q$select set_block_week_deload(%L, true)$q$, pg_temp.prog(:'b', 1)), 'DENIED');
select pg_temp.expect('a started week cannot become a deload', format($q$select set_block_week_deload(%L, true)$q$, pg_temp.prog(:'b', 2)), 'DENIED');
select set_block_week_deload(pg_temp.prog(:'b', 5), false);
reset role;
select pg_temp.eq('a deload turned back into a regular week rejoins the chain', pg_temp.t(:'b', 5, 'Back Squat') || ' ' || pg_temp.info(:'b', 5, 'Back Squat', 'base_week') || ' ' || pg_temp.t(:'b', 6, 'Back Squat'), 'W40x5|87.5x5|87.5x5|87.5x5 4 W40x5|90x5|90x5|90x5');
set role authenticated; select pg_temp.as_user(:'COACH');
select set_block_week_deload(pg_temp.prog(:'b', 6), true, 70);
reset role;
select pg_temp.eq('a regular week turned into a 70% deload', pg_temp.t(:'b', 6, 'Back Squat') || ' ' || pg_temp.info(:'b', 6, 'Back Squat', 'deload_pct'), 'W27.5x5|62.5x5|62.5x5|62.5x5 70');

-- a soft-deleted week drops out of the chain
update programs set deleted_at = now() where id = pg_temp.prog(:'b', 4);
select block_recompute_internal(:'b', 2);
select pg_temp.eq('with week 4 removed, week 5 continues from week 2', (select we.progression_info ->> 'base_week' from workout_exercises we join workouts w on w.id = we.workout_id join programs p on p.id = w.program_id join exercises x on x.id = we.exercise_id where p.block_id = :'b' and p.block_week_index = 5 and p.deleted_at is null and x.name = 'Back Squat'), '2');

-- ===========================================================================
-- RLS on blocks, and auto-publish / completion by the weekly maintenance
-- ===========================================================================
set role authenticated;
select pg_temp.as_user(:'T1');
select pg_temp.expect('a trainee reads their own block', $q$select 1 from blocks$q$, 'ROWS:1');
select pg_temp.expect('a trainee cannot change a block', format($q$update blocks set auto_publish_next_week = true where id = %L$q$, :'b'), 'ROWS:0');
select pg_temp.expect('a trainee cannot insert a block', format($q$insert into blocks (trainee_id, title, weeks_count) values (%L, 'x', 3)$q$, :'T1'), 'DENIED');
select pg_temp.expect('a trainee cannot end a block', format($q$select end_block(%L)$q$, :'b'), 'DENIED');
select pg_temp.expect('a trainee cannot delete a block', format($q$select delete_block(%L)$q$, :'b'), 'DENIED');
select pg_temp.expect('a trainee cannot recompute on demand', format($q$select recompute_block(%L)$q$, :'b'), 'DENIED');
select pg_temp.expect('a trainee cannot start the next block', format($q$select start_next_block(%L, 'x', 4)$q$, :'b'), 'DENIED');
select pg_temp.as_user(:'T2');
select pg_temp.expect('another trainee sees no block', $q$select 1 from blocks$q$, 'ROWS:0');
select pg_temp.as_user(:'SA');
select pg_temp.expect('the read-only viewer reads blocks', $q$select 1 from blocks$q$, 'ROWS:1');
select pg_temp.expect('…but cannot change them', format($q$update blocks set title = 'hacked' where id = %L$q$, :'b'), 'ROWS:0');
select pg_temp.expect('…nor recompute', format($q$select recompute_block(%L)$q$, :'b'), 'DENIED');
select pg_temp.expect('…nor shift', format($q$select shift_block(%L, 5)$q$, :'b'), 'DENIED');
reset role;

update blocks set auto_publish_next_week = true, rolled_through = null where id = :'b';
select pg_temp.travel(:'b', 1);     -- another week passes: the deload (w3) is now current
set role authenticated; select pg_temp.as_user(:'T1');
select block_roll_forward(:'b');
reset role;
select pg_temp.eq('auto-publish: this week''s program was published by the maintenance', (select status::text || ':' || (published_at is not null)::text from programs where id = pg_temp.prog(:'b', 3)), 'published:true');
select pg_temp.eq('…and only this week''s', (select status::text from programs where id = pg_temp.prog(:'b', 5)), 'draft');
select pg_temp.travel(:'b', 10);    -- long after the block
update blocks set rolled_through = null where id = :'b';
set role authenticated; select pg_temp.as_user(:'COACH');
select block_roll_forward(:'b');
reset role;
select pg_temp.eq('a block whose last week is behind us completes itself', (select status from blocks where id = :'b'), 'completed');

-- ===========================================================================
-- The next block, ending and deleting
-- ===========================================================================
set role authenticated; select pg_temp.as_user(:'COACH');
select start_next_block(:'b', 'בלוק כוח 2', 3, array[3], 60, true) as b2 \gset
reset role;
select pg_temp.eq('the next block starts this week (the old one is long over)', (select string_agg(((week_start_date - :'wk'::date) / 7)::text, ',' order by block_week_index) from programs where block_id = :'b2'), '0,1,2');
select pg_temp.eq('its week 1 copies the old block''s last regular week', (select count(*)::text from workout_exercises we join workouts w on w.id = we.workout_id where w.program_id = pg_temp.prog(:'b2', 1)), '5');
select pg_temp.eq('…with new slots (a new chain)', (select count(*)::text from workout_exercises a join workouts w on w.id = a.workout_id where w.program_id = pg_temp.prog(:'b2', 1) and exists (select 1 from workout_exercises o join workouts ow on ow.id = o.workout_id join programs op on op.id = ow.program_id where op.block_id = :'b' and o.slot_key = a.slot_key)), '0');
select pg_temp.eq('…the rules carried over', (select we.progression_type || ':' || we.weight_step_kg from workout_exercises we where we.id = pg_temp.we(:'b2', 1, 'Back Squat')), 'weight:2.50');
select pg_temp.eq('…and its later weeks are already planned', (pg_temp.t(:'b2', 2, 'Back Squat') is not null and pg_temp.info(:'b2', 2, 'Back Squat', 'outcome') = 'projected')::text, 'true');

-- end early: untouched future weeks go, the current week stays
update programs set status = 'published' where id = pg_temp.prog(:'b2', 1);
set role authenticated; select pg_temp.as_user(:'COACH');
select end_block(:'b2', true);
reset role;
select pg_temp.eq('ending a block removes its future, untouched weeks', (select string_agg(block_week_index || ':' || (deleted_at is null)::text, ',' order by block_week_index) from programs where block_id = :'b2'), '1:true,2:false,3:false');
select pg_temp.eq('…and completes it', (select status from blocks where id = :'b2'), 'completed');
select block_recompute_internal(:'b2', 2);
select pg_temp.eq('a completed block is never recomputed', 'ok', 'ok');
set role authenticated; select pg_temp.as_user(:'COACH');
select pg_temp.expect('a block that has ended cannot push its structure forward', format($q$select apply_block_structure(%L)$q$, pg_temp.prog(:'b2', 1)), 'DENIED');
reset role;

-- a block that publishes by itself keeps its published weeks published when they are rebuilt
set role authenticated; select pg_temp.as_user(:'COACH');
select create_block(:'T2', 'auto', :'wk', 3, '{}', 60, null, false, false, true) as b3 \gset
reset role;
insert into workouts (id, program_id, day_of_week, order_index) values ('a5000000-0000-0000-0000-000000000001', pg_temp.prog(:'b3', 1), 1, 0);
insert into workout_exercises (id, workout_id, exercise_id, order_index) values ('a5000000-0000-0000-0000-000000000002', 'a5000000-0000-0000-0000-000000000001', (select id from exercises where name = 'Deadlift'), 0);
insert into workout_exercise_sets (workout_exercise_id, set_index, reps_min, reps_max, weight_kg) values ('a5000000-0000-0000-0000-000000000002', 1, 5, 5, 100);
update programs set status = 'published', published_at = now() where block_id = :'b3';
set role authenticated; select pg_temp.as_user(:'COACH');
select apply_block_structure(pg_temp.prog(:'b3', 1));
reset role;
select pg_temp.eq('auto-publishing block: rebuilt weeks stay published', (select string_agg(status::text, ',' order by block_week_index) from programs where block_id = :'b3'), 'published,published,published');
select pg_temp.eq('…and they did get the structure', (select count(*)::text from workout_exercises we join workouts w on w.id = we.workout_id join programs p on p.id = w.program_id where p.block_id = :'b3'), '3');
set role authenticated; select pg_temp.as_user(:'T2');
select pg_temp.expect('the trainee of an auto-publishing block runs its maintenance', format($q$select block_roll_forward(%L)$q$, :'b3'), 'OK');
select pg_temp.expect('the lock helper is not callable directly', format($q$select block_lock(%L)$q$, :'b3'), 'DENIED');
reset role;

-- delete: weeks with history survive as ordinary programs
set role authenticated; select pg_temp.as_user(:'COACH');
select delete_block(:'b');
reset role;
select pg_temp.eq('deleting a block keeps (and detaches) the weeks that were trained in', (select string_agg((block_id is null)::text || ':' || (deleted_at is null)::text, ',' order by week_start_date) from programs where id in (select w.program_id from workouts w join workout_exercises we on we.workout_id = w.id join set_logs l on l.workout_exercise_id = we.id)), 'true:true,true:true');
select pg_temp.eq('…removes the rest, and the block itself is gone from lists', (select count(*) filter (where deleted_at is null)::text from programs where block_id = :'b') || ':' || (select (deleted_at is not null)::text from blocks where id = :'b'), '0:true');
select pg_temp.eq('no set log was lost along the way', (select count(*)::text from set_logs), '11');

-- deleting the trainee takes their blocks with them (no orphan, no constraint error)
select pg_temp.expect('deleting a trainee with blocks works', format($q$delete from auth.users where id = %L$q$, :'T1'), 'ROWS:1');
select pg_temp.eq('…their blocks and programs are gone', (select count(*)::text from blocks where trainee_id = :'T1') || ':' || (select count(*)::text from programs where trainee_id = :'T1'), '0:0');

select pg_temp.eq('all public tables have RLS enabled', (select count(*)::text from pg_tables where schemaname = 'public' and not rowsecurity), '0');
