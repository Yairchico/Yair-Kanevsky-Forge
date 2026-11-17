-- Migration 0019: the exercise-videos bucket and its policies, a saved workout
-- into a trainee's program, and existing weeks into a block. Builds its own data.
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
select public.week_start_of(public.israel_today()) as wk \gset
select id as squat from exercises where name = 'Back Squat' \gset
select id as bench from exercises where name = 'Bench Press' \gset
select id as dead from exercises where name = 'Deadlift' \gset

-- ===========================================================================
-- 1. Videos
-- ===========================================================================
select pg_temp.eq('the bucket is public, 50MB, video types only', (select public::text || ':' || file_size_limit || ':' || array_to_string(allowed_mime_types, ',') from storage.buckets where id = 'exercise-videos'), 'true:52428800:video/mp4,video/quicktime,video/webm');
select :'squat' || '/11111111-1111-1111-1111-111111111111.mp4' as vpath \gset
select pg_temp.expect('a stored path must have the expected shape', format($q$update exercises set video_storage_path = 'evil/../x.mp4' where id = %L$q$, :'squat'), 'DENIED');
select pg_temp.expect('a link and a file at once is refused', format($q$update exercises set video_url = 'https://youtu.be/dQw4w9WgXcQ', video_storage_path = %L where id = %L$q$, :'vpath', :'squat'), 'DENIED');
select pg_temp.expect('a file alone is fine', format($q$update exercises set video_storage_path = %L where id = %L$q$, :'vpath', :'squat'), 'ROWS:1');

set role authenticated;
select pg_temp.as_user(:'COACH');
select pg_temp.expect('the trainer uploads a video', format($q$insert into storage.objects (bucket_id, name) values ('exercise-videos', %L)$q$, :'vpath'), 'ROWS:1');
select pg_temp.expect('…only under the expected name', $q$insert into storage.objects (bucket_id, name) values ('exercise-videos', 'notes.txt')$q$, 'DENIED');
select pg_temp.as_user(:'T1');
select pg_temp.expect('a trainee cannot upload a video', format($q$insert into storage.objects (bucket_id, name) values ('exercise-videos', %L)$q$, :'squat' || '/22222222-2222-2222-2222-222222222222.mp4'), 'DENIED');
select pg_temp.expect('…but can watch one', $q$select 1 from storage.objects where bucket_id = 'exercise-videos'$q$, 'ROWS:1');
select pg_temp.expect('…and cannot delete it', $q$delete from storage.objects where bucket_id = 'exercise-videos'$q$, 'ROWS:0');
select pg_temp.as_user(:'SA');
select pg_temp.expect('the read-only viewer cannot upload', format($q$insert into storage.objects (bucket_id, name) values ('exercise-videos', %L)$q$, :'squat' || '/33333333-3333-3333-3333-333333333333.mp4'), 'DENIED');
select pg_temp.as_user(:'COACH');
select pg_temp.expect('the trainer removes a video', $q$delete from storage.objects where bucket_id = 'exercise-videos'$q$, 'ROWS:1');
reset role;

-- ===========================================================================
-- 2. A saved workout into a trainee's program
-- ===========================================================================
insert into session_templates (id, title) values ('40000000-0000-0000-0000-000000000001', 'כוח רגליים');
insert into session_template_exercises (id, template_id, exercise_id, order_index, rest_seconds, instructions) values
  ('41000000-0000-0000-0000-000000000001', '40000000-0000-0000-0000-000000000001', :'squat', 0, 180, 'עמוק'),
  ('41000000-0000-0000-0000-000000000002', '40000000-0000-0000-0000-000000000001', :'dead', 1, 120, null);
insert into session_template_sets (template_exercise_id, set_index, set_type, reps_min, reps_max, weight_kg) values
  ('41000000-0000-0000-0000-000000000001', 1, 'warmup', 5, 5, 40),
  ('41000000-0000-0000-0000-000000000001', 2, 'working', 5, 5, 80),
  ('41000000-0000-0000-0000-000000000002', 1, 'working', 3, 5, 100);
insert into session_templates (id, title) values ('40000000-0000-0000-0000-000000000002', 'ריק');
insert into programs (id, trainee_id, title, status, week_start_date)
  values ('10000000-0000-0000-0000-000000000001', :'T1', 'השבוע', 'published', :'wk');

set role authenticated;
select pg_temp.as_user(:'T1');
select pg_temp.expect('a trainee cannot add a saved workout', format($q$select add_template_to_program('40000000-0000-0000-0000-000000000001', %L, %L, 2)$q$, :'T1', :'wk'), 'DENIED');
select pg_temp.as_user(:'SA');
select pg_temp.expect('the read-only viewer cannot either', format($q$select add_template_to_program('40000000-0000-0000-0000-000000000001', %L, %L, 2)$q$, :'T1', :'wk'), 'DENIED');
select pg_temp.as_user(:'COACH');
select add_template_to_program('40000000-0000-0000-0000-000000000001', :'T1', (:'wk'::date + 7), 2) as r1 \gset
select pg_temp.eq('a week with no program gets a new draft one, named after the saved workout', (select title || ':' || status from programs where trainee_id = :'T1' and week_start_date = :'wk'::date + 7), 'כוח רגליים:draft');
select pg_temp.eq('…the result says so', (:'r1'::jsonb ->> 'created_program') || ':' || (:'r1'::jsonb ->> 'reverted_to_draft'), 'true:false');
select pg_temp.eq('the workout is on the chosen day, first that day', (select day_of_week || ':' || order_index from workouts where id = (:'r1'::jsonb ->> 'workout_id')::uuid), '2:0');
select pg_temp.eq('exercises, rest and notes were copied', (select string_agg(x.name || ':' || coalesce(we.rest_seconds::text, '-') || ':' || coalesce(we.instructions, '-'), ',' order by we.order_index) from workout_exercises we join exercises x on x.id = we.exercise_id where we.workout_id = (:'r1'::jsonb ->> 'workout_id')::uuid), 'Back Squat:180:עמוק,Deadlift:120:-');
select pg_temp.eq('the target sets were copied, warm-up included', (select string_agg(s.set_type || ':' || s.reps_min || '-' || s.reps_max || '@' || s.weight_kg::float, ',' order by we.order_index, s.set_index) from workout_exercise_sets s join workout_exercises we on we.id = s.workout_exercise_id where we.workout_id = (:'r1'::jsonb ->> 'workout_id')::uuid), 'warmup:5-5@40,working:5-5@80,working:3-5@100');
select add_template_to_program('40000000-0000-0000-0000-000000000001', :'T1', (:'wk'::date + 7), 2) as r2 \gset
select pg_temp.eq('a second time the same day: the second workout of the day', (select order_index::text from workouts where id = (:'r2'::jsonb ->> 'workout_id')::uuid), '1');
select pg_temp.expect('a third time that day is refused (BK003)', format($q$select add_template_to_program('40000000-0000-0000-0000-000000000001', %L, %L::date + 7, 2)$q$, :'T1', :'wk'), 'DENIED');
select pg_temp.eq('…and nothing was added', (select count(*)::text from workouts w join programs p on p.id = w.program_id where p.trainee_id = :'T1' and p.week_start_date = :'wk'::date + 7), '2');
select add_template_to_program('40000000-0000-0000-0000-000000000001', :'T1', :'wk', 0, 'לא בשימוש') as r3 \gset
select pg_temp.eq('into an existing published program: added, and back to draft', (select status::text || ':' || title from programs where id = '10000000-0000-0000-0000-000000000001') || ':' || (:'r3'::jsonb ->> 'reverted_to_draft') || ':' || (:'r3'::jsonb ->> 'created_program'), 'draft:השבוע:true:false');
select add_template_to_program('40000000-0000-0000-0000-000000000001', :'T1', (:'wk'::date + 14), 4, 'שבוע מיוחד') as r4 \gset
select pg_temp.eq('a new program can be given its own name', (select title from programs where trainee_id = :'T1' and week_start_date = :'wk'::date + 14), 'שבוע מיוחד');
select pg_temp.expect('a week that does not start on Sunday is refused', format($q$select add_template_to_program('40000000-0000-0000-0000-000000000001', %L, %L::date + 3, 2)$q$, :'T1', :'wk'), 'DENIED');
select pg_temp.expect('a past week is refused', format($q$select add_template_to_program('40000000-0000-0000-0000-000000000001', %L, %L::date - 7, 2)$q$, :'T1', :'wk'), 'DENIED');
select pg_temp.expect('a day out of range is refused', format($q$select add_template_to_program('40000000-0000-0000-0000-000000000001', %L, %L, 7)$q$, :'T1', :'wk'), 'DENIED');
select pg_temp.expect('an empty saved workout is refused', format($q$select add_template_to_program('40000000-0000-0000-0000-000000000002', %L, %L, 3)$q$, :'T1', :'wk'), 'DENIED');
select pg_temp.expect('a program is only for a trainee', format($q$select add_template_to_program('40000000-0000-0000-0000-000000000001', %L, %L, 3)$q$, :'COACH', :'wk'), 'DENIED');
reset role;
update session_templates set deleted_at = now() where id = '40000000-0000-0000-0000-000000000002';
update session_templates set deleted_at = now() where id = '40000000-0000-0000-0000-000000000001';
set role authenticated; select pg_temp.as_user(:'COACH');
select pg_temp.expect('a deleted saved workout is refused', format($q$select add_template_to_program('40000000-0000-0000-0000-000000000001', %L, %L, 3)$q$, :'T1', :'wk'), 'DENIED');
reset role;
update session_templates set deleted_at = null where id = '40000000-0000-0000-0000-000000000001';

-- ===========================================================================
-- 3. Existing weeks into a block
-- ===========================================================================
-- T2: three weeks the trainer built by hand. Week A (two weeks ago): Sunday squat + bench, Wednesday deadlift.
-- Week B (last week): the same, heavier. Week C (this week): the squat moved to Monday.
insert into programs (id, trainee_id, title, status, week_start_date) values
  ('20000000-0000-0000-0000-00000000000a', :'T2', 'A', 'published', :'wk'::date - 14),
  ('20000000-0000-0000-0000-00000000000b', :'T2', 'B', 'published', :'wk'::date - 7),
  ('20000000-0000-0000-0000-00000000000c', :'T2', 'C', 'published', :'wk');
insert into workouts (id, program_id, day_of_week, order_index) values
  ('21000000-0000-0000-0000-0000000000a0', '20000000-0000-0000-0000-00000000000a', 0, 0),
  ('21000000-0000-0000-0000-0000000000a3', '20000000-0000-0000-0000-00000000000a', 3, 0),
  ('21000000-0000-0000-0000-0000000000b0', '20000000-0000-0000-0000-00000000000b', 0, 0),
  ('21000000-0000-0000-0000-0000000000b3', '20000000-0000-0000-0000-00000000000b', 3, 0),
  ('21000000-0000-0000-0000-0000000000c0', '20000000-0000-0000-0000-00000000000c', 0, 0),
  ('21000000-0000-0000-0000-0000000000c1', '20000000-0000-0000-0000-00000000000c', 1, 0),
  ('21000000-0000-0000-0000-0000000000c3', '20000000-0000-0000-0000-00000000000c', 3, 0);
create or replace function pg_temp.ex(p_id text, p_workout text, p_ex uuid, p_order int, p_kg numeric) returns void language sql as $$
  insert into workout_exercises (id, workout_id, exercise_id, order_index) values (p_id::uuid, p_workout::uuid, p_ex, p_order);
  insert into workout_exercise_sets (workout_exercise_id, set_index, reps_min, reps_max, weight_kg)
    select p_id::uuid, n, 5, 5, p_kg from generate_series(1, 3) n;
$$;
select pg_temp.ex('22000000-0000-0000-0000-0000000000a1', '21000000-0000-0000-0000-0000000000a0', :'squat', 0, 80);
select pg_temp.ex('22000000-0000-0000-0000-0000000000a2', '21000000-0000-0000-0000-0000000000a0', :'bench', 1, 60);
select pg_temp.ex('22000000-0000-0000-0000-0000000000a3', '21000000-0000-0000-0000-0000000000a3', :'dead', 0, 100);
select pg_temp.ex('22000000-0000-0000-0000-0000000000b1', '21000000-0000-0000-0000-0000000000b0', :'squat', 0, 82.5);
select pg_temp.ex('22000000-0000-0000-0000-0000000000b2', '21000000-0000-0000-0000-0000000000b0', :'bench', 1, 62.5);
select pg_temp.ex('22000000-0000-0000-0000-0000000000b3', '21000000-0000-0000-0000-0000000000b3', :'dead', 0, 105);
select pg_temp.ex('22000000-0000-0000-0000-0000000000c2', '21000000-0000-0000-0000-0000000000c0', :'bench', 0, 65);
select pg_temp.ex('22000000-0000-0000-0000-0000000000c1', '21000000-0000-0000-0000-0000000000c1', :'squat', 0, 85);
select pg_temp.ex('22000000-0000-0000-0000-0000000000c3', '21000000-0000-0000-0000-0000000000c3', :'dead', 0, 110);
-- week A was trained
insert into set_logs (workout_exercise_id, trainee_id, set_index, weight_kg, reps)
  select '22000000-0000-0000-0000-0000000000a1', :'T2', n, 80, 5 from generate_series(1, 3) n;
insert into workout_completions (workout_id, trainee_id) values ('21000000-0000-0000-0000-0000000000a0', :'T2');
-- a week that's already in a block elsewhere
insert into blocks (id, trainee_id, title, weeks_count) values ('30000000-0000-0000-0000-000000000001', :'T1', 'other', 1);
update programs set block_id = '30000000-0000-0000-0000-000000000001', block_week_index = 1 where id = '10000000-0000-0000-0000-000000000001';

create or replace function pg_temp.t(p_block uuid, p_week int, p_name text) returns text language sql as $$
  select string_agg(trim(trailing '.' from trim(trailing '0' from s.weight_kg::text)) || case when s.is_manual_override then '*' else '' end, '|' order by s.set_index)
  from workout_exercise_sets s join workout_exercises we on we.id = s.workout_exercise_id join workouts w on w.id = we.workout_id
  join programs p on p.id = w.program_id join exercises x on x.id = we.exercise_id
  where p.block_id = p_block and p.block_week_index = p_week and p.deleted_at is null and x.name = p_name
$$;
create or replace function pg_temp.slots(p_name text) returns text language sql as $$
  select count(distinct we.slot_key)::text from workout_exercises we join workouts w on w.id = we.workout_id
  join programs p on p.id = w.program_id join exercises x on x.id = we.exercise_id
  where p.trainee_id = '00000000-0000-0000-0000-0000000000b2' and x.name = p_name and p.block_id is not null
$$;
\set ABC 'array[''20000000-0000-0000-0000-00000000000a'',''20000000-0000-0000-0000-00000000000b'',''20000000-0000-0000-0000-00000000000c'']::uuid[]'

set role authenticated;
select pg_temp.as_user(:'T2');
select pg_temp.expect('a trainee cannot convert weeks', format($q$select convert_programs_to_block(%L, 'x', %s)$q$, :'T2', :'ABC'), 'DENIED');
select pg_temp.as_user(:'SA');
select pg_temp.expect('the read-only viewer cannot convert weeks', format($q$select convert_programs_to_block(%L, 'x', %s)$q$, :'T2', :'ABC'), 'DENIED');
select pg_temp.as_user(:'COACH');
select pg_temp.expect('another trainee''s program cannot be included', format($q$select convert_programs_to_block(%L, 'x', array['20000000-0000-0000-0000-00000000000a', '10000000-0000-0000-0000-000000000001']::uuid[])$q$, :'T2'), 'DENIED');
select pg_temp.expect('a week already in a block cannot be converted (BK004)', format($q$select convert_programs_to_block(%L, 'x', array['10000000-0000-0000-0000-000000000001']::uuid[])$q$, :'T1'), 'DENIED');
select pg_temp.expect('a deload can only be one of the added weeks', format($q$select convert_programs_to_block(%L, 'x', %s, 2, array[2])$q$, :'T2', :'ABC'), 'DENIED');
select pg_temp.expect('no more than 16 weeks', format($q$select convert_programs_to_block(%L, 'x', %s, 14)$q$, :'T2', :'ABC'), 'DENIED');
select pg_temp.expect('nothing chosen is refused', format($q$select convert_programs_to_block(%L, 'x', '{}'::uuid[])$q$, :'T2'), 'DENIED');
reset role;
insert into programs (id, trainee_id, title, week_start_date) values ('20000000-0000-0000-0000-0000000000ff', :'T2', 'taken', :'wk'::date + 14);
set role authenticated; select pg_temp.as_user(:'COACH');
select pg_temp.expect('an added week that is taken stops it (BK001)', format($q$select convert_programs_to_block(%L, 'x', %s, 2)$q$, :'T2', :'ABC'), 'DENIED');
reset role;
select pg_temp.eq('nothing was left behind by the refused attempts', (select count(*)::text from blocks) || ':' || (select count(*)::text from programs where block_id is not null), '1:1');
delete from programs where id = '20000000-0000-0000-0000-0000000000ff';

set role authenticated; select pg_temp.as_user(:'COACH');
select convert_programs_to_block(:'T2', 'בלוק מהשבועות הקיימים', :ABC, 2, array[5], 50) as b \gset
reset role;
select pg_temp.eq('the chosen weeks are weeks 1-3 in calendar order, then two added weeks', (select string_agg(block_week_index || ':' || title || ':' || status || case when is_deload then ':D' else '' end || ':' || ((week_start_date - :'wk'::date) / 7), ',' order by block_week_index) from programs where block_id = :'b' and deleted_at is null), '1:A:published:-2,2:B:published:-1,3:C:published:0,4:בלוק מהשבועות הקיימים:draft:1,5:בלוק מהשבועות הקיימים:draft:D:2');
select pg_temp.eq('the block is 5 weeks, active, 50% deloads', (select weeks_count || ':' || status || ':' || default_deload_pct from blocks where id = :'b'), '5:active:50');
select pg_temp.eq('the squat is one exercise across all weeks — even after it moved to Monday', pg_temp.slots('Back Squat'), '1');
select pg_temp.eq('the bench is one exercise across all weeks (it moved up in the order)', pg_temp.slots('Bench Press'), '1');
select pg_temp.eq('the deadlift too', pg_temp.slots('Deadlift'), '1');
select pg_temp.eq('the Sunday and Wednesday workouts keep their identity', (select count(distinct w.slot_key)::text from workouts w join programs p on p.id = w.program_id where p.block_id = :'b' and w.day_of_week in (0, 3)), '2');
select pg_temp.eq('week 1 targets are untouched and not marked', pg_temp.t(:'b', 1, 'Back Squat'), '80|80|80');
select pg_temp.eq('the trainer''s later numbers are kept, marked as set by hand', pg_temp.t(:'b', 2, 'Back Squat') || ' ' || pg_temp.t(:'b', 3, 'Back Squat') || ' ' || pg_temp.t(:'b', 3, 'Deadlift'), '82.5*|82.5*|82.5* 85*|85*|85* 110*|110*|110*');
select pg_temp.eq('the added weeks copy the last week and are computed (no rule yet: same targets)', pg_temp.t(:'b', 4, 'Back Squat') || ' ' || pg_temp.t(:'b', 4, 'Deadlift'), '85|85|85 110|110|110');
select pg_temp.eq('the added deload is 50% of the week before it', pg_temp.t(:'b', 5, 'Back Squat'), '42.5|42.5|42.5');
select pg_temp.eq('every week from the second on says where its targets come from', (select count(*)::text from workout_exercises we join workouts w on w.id = we.workout_id join programs p on p.id = w.program_id where p.block_id = :'b' and p.block_week_index >= 2 and we.progression_info is null), '0');
select pg_temp.eq('the logged week keeps its logs', (select count(*)::text from set_logs where workout_exercise_id = '22000000-0000-0000-0000-0000000000a1'), '3');

set role authenticated; select pg_temp.as_user(:'COACH');
select set_exercise_progression('22000000-0000-0000-0000-0000000000c1', 'weight', 'kg', 2.5, null, null, null, 'planned', 2.5);
reset role;
select pg_temp.eq('a rule on the last converted week drives the added weeks', pg_temp.t(:'b', 4, 'Back Squat') || ' ' || pg_temp.t(:'b', 3, 'Back Squat'), '87.5|87.5|87.5 85*|85*|85*');
set role authenticated; select pg_temp.as_user(:'COACH');
select clear_set_override(s.id) from workout_exercise_sets s where s.workout_exercise_id = '22000000-0000-0000-0000-0000000000b1' and s.set_index = 1;
reset role;
select pg_temp.eq('"back to automatic" on a converted set: week 1''s numbers carried (week 1 had no rule)', pg_temp.t(:'b', 2, 'Back Squat'), '80|82.5*|82.5*');

set role authenticated; select pg_temp.as_user(:'T2');
select pg_temp.expect('the trainee sees the new block', $q$select 1 from blocks$q$, 'ROWS:1');
select pg_temp.as_user(:'COACH');
select convert_programs_to_block(:'T1', 'one week', array[(select id from programs where trainee_id = :'T1' and week_start_date = :'wk'::date + 7)]::uuid[]) as b1 \gset
reset role;
select pg_temp.eq('a single week with nothing added is a one-week block', (select weeks_count || ':' || (select count(*) from programs where block_id = :'b1') from blocks where id = :'b1'), '1:1');

select pg_temp.eq('all public tables have RLS enabled', (select count(*)::text from pg_tables where schemaname = 'public' and not rowsecurity), '0');
