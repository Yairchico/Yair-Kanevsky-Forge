-- Migration 0018: the trainee's week lock in RLS, and copy_program_structure. Builds its own data.
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

-- one published program per week for T1: two weeks ago, last week, this week, next week; plus a draft in two weeks
insert into programs (id, trainee_id, title, status, week_start_date)
select ('10000000-0000-0000-0000-00000000000' || n)::uuid, :'T1', 'w' || n, case when n = 5 then 'draft' else 'published' end::program_status, :'wk'::date + 7 * (n - 3)
from generate_series(1, 5) n;
insert into workouts (id, program_id, day_of_week, order_index)
select ('20000000-0000-0000-0000-00000000000' || n)::uuid, ('10000000-0000-0000-0000-00000000000' || n)::uuid, 0, 0 from generate_series(1, 5) n;
insert into workout_exercises (id, workout_id, exercise_id, order_index)
select ('30000000-0000-0000-0000-00000000000' || n)::uuid, ('20000000-0000-0000-0000-00000000000' || n)::uuid, (select id from exercises where name = 'Back Squat'), 0 from generate_series(1, 5) n;
insert into workout_exercise_sets (workout_exercise_id, set_index, reps_min, reps_max, weight_kg)
select ('30000000-0000-0000-0000-00000000000' || n)::uuid, s, 5, 5, 80 from generate_series(1, 5) n, generate_series(1, 2) s;
-- history that already exists in the old week (logged back when it was current)
insert into set_logs (workout_exercise_id, trainee_id, set_index, weight_kg, reps) values ('30000000-0000-0000-0000-000000000001', :'T1', 1, 80, 5);
insert into workout_logs (workout_exercise_id, trainee_id, notes) values ('30000000-0000-0000-0000-000000000001', :'T1', 'old note');
insert into workout_exercise_completions (workout_exercise_id, trainee_id) values ('30000000-0000-0000-0000-000000000001', :'T1');
insert into workout_completions (workout_id, trainee_id) values ('20000000-0000-0000-0000-000000000001', :'T1');

create or replace function pg_temp.ins(n int, idx int) returns text language sql as $$
  select format($q$insert into set_logs (workout_exercise_id, trainee_id, set_index, weight_kg, reps) values ('30000000-0000-0000-0000-00000000000%s', '00000000-0000-0000-0000-0000000000b1', %s, 80, 5)$q$, n, idx)
$$;

-- ===== the trainee: this week, last week and a future week are open; older is closed
set role authenticated;
select pg_temp.as_user(:'T1');
select pg_temp.expect('trainee logs a set this week', pg_temp.ins(3, 1), 'ROWS:1');
select pg_temp.expect('trainee logs a set last week (a late workout)', pg_temp.ins(2, 1), 'ROWS:1');
select pg_temp.expect('trainee logs a set next week (training early)', pg_temp.ins(4, 1), 'ROWS:1');
select pg_temp.expect('trainee cannot log a set two weeks back', pg_temp.ins(1, 2), 'DENIED');
select pg_temp.expect('trainee cannot log into a draft program', pg_temp.ins(5, 1), 'DENIED');
select pg_temp.expect('trainee still READS their old sets', $q$select 1 from set_logs where workout_exercise_id = '30000000-0000-0000-0000-000000000001'$q$, 'ROWS:1');
select pg_temp.expect('trainee cannot rewrite an old set', $q$update set_logs set reps = 50 where workout_exercise_id = '30000000-0000-0000-0000-000000000001'$q$, 'ROWS:0');
select pg_temp.expect('trainee cannot delete an old set', $q$delete from set_logs where workout_exercise_id = '30000000-0000-0000-0000-000000000001'$q$, 'ROWS:0');
select pg_temp.expect('trainee cannot upsert over an old set', $q$insert into set_logs (workout_exercise_id, trainee_id, set_index, weight_kg, reps) values ('30000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000b1', 1, 200, 20) on conflict (workout_exercise_id, trainee_id, set_index) do update set reps = excluded.reps, weight_kg = excluded.weight_kg$q$, 'DENIED');
select pg_temp.expect('trainee cannot move a fresh set onto an old exercise', $q$update set_logs set workout_exercise_id = '30000000-0000-0000-0000-000000000001', set_index = 2 where workout_exercise_id = '30000000-0000-0000-0000-000000000003'$q$, 'DENIED');
select pg_temp.expect('trainee cannot rewrite an old exercise note', $q$update workout_logs set notes = 'rewritten' where workout_exercise_id = '30000000-0000-0000-0000-000000000001'$q$, 'ROWS:0');
select pg_temp.expect('trainee cannot un-mark an old exercise', $q$delete from workout_exercise_completions where workout_exercise_id = '30000000-0000-0000-0000-000000000001'$q$, 'ROWS:0');
select pg_temp.expect('trainee cannot un-submit an old workout', $q$delete from workout_completions where workout_id = '20000000-0000-0000-0000-000000000001'$q$, 'ROWS:0');
select pg_temp.expect('trainee cannot submit an old workout again', $q$insert into workout_completions (workout_id, trainee_id) values ('20000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000b1') on conflict (workout_id, trainee_id) do update set completed_at = now()$q$, 'DENIED');
select pg_temp.expect('trainee edits this week''s set', $q$update set_logs set reps = 6 where workout_exercise_id = '30000000-0000-0000-0000-000000000003'$q$, 'ROWS:1');
select pg_temp.expect('trainee un-logs last week''s set', $q$delete from set_logs where workout_exercise_id = '30000000-0000-0000-0000-000000000002'$q$, 'ROWS:1');
select pg_temp.expect('trainee submits this week''s workout', $q$insert into workout_completions (workout_id, trainee_id) values ('20000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-0000000000b1')$q$, 'ROWS:1');
select pg_temp.expect('trainee un-submits it', $q$delete from workout_completions where workout_id = '20000000-0000-0000-0000-000000000003'$q$, 'ROWS:1');
select pg_temp.expect('trainee writes a note and marks done this week', $q$with a as (insert into workout_logs (workout_exercise_id, trainee_id, notes) values ('30000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-0000000000b1', 'n') returning 1) insert into workout_exercise_completions (workout_exercise_id, trainee_id) values ('30000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-0000000000b1')$q$, 'ROWS:1');
select pg_temp.eq('the helper answers for the caller only', public.trainee_can_log('20000000-0000-0000-0000-000000000003')::text || public.trainee_can_log('20000000-0000-0000-0000-000000000001')::text, 'truefalse');
select pg_temp.as_user(:'T2');
select pg_temp.eq('…and says no about someone else''s workout', public.trainee_can_log('20000000-0000-0000-0000-000000000003')::text || public.trainee_can_log_exercise('30000000-0000-0000-0000-000000000003')::text, 'falsefalse');
select pg_temp.expect('another trainee still cannot log there', pg_temp.ins(3, 2), 'DENIED');
reset role;
select pg_temp.eq('the old history is exactly as it was', (select reps || ':' || weight_kg::float from set_logs where workout_exercise_id = '30000000-0000-0000-0000-000000000001') || '|' || (select notes from workout_logs where workout_exercise_id = '30000000-0000-0000-0000-000000000001') || '|' || (select count(*) from workout_completions where workout_id = '20000000-0000-0000-0000-000000000001') || (select count(*) from workout_exercise_completions where workout_exercise_id = '30000000-0000-0000-0000-000000000001'), '5:80|old note|11');

-- ===== the trainer is not bound by the week lock
set role authenticated;
select pg_temp.as_user(:'COACH');
select pg_temp.expect('the trainer can still correct an old set', $q$update set_logs set reps = 4 where workout_exercise_id = '30000000-0000-0000-0000-000000000001'$q$, 'ROWS:1');
select pg_temp.expect('…and log one for the trainee in an old week', pg_temp.ins(1, 2), 'ROWS:1');

-- ===== copy_program_structure
insert into programs (id, trainee_id, title, week_start_date) values ('10000000-0000-0000-0000-000000000009', :'T2', 'copy target', :'wk');
update workout_exercise_sets set is_manual_override = true, weight_kg_exact = 81.234 where workout_exercise_id = '30000000-0000-0000-0000-000000000003' and set_index = 1;
select pg_temp.as_user(:'T1');
select pg_temp.expect('a trainee cannot copy a program', $q$select copy_program_structure('10000000-0000-0000-0000-000000000003', '10000000-0000-0000-0000-000000000009')$q$, 'DENIED');
select pg_temp.as_user(:'SA');
select pg_temp.expect('the read-only viewer cannot copy a program', $q$select copy_program_structure('10000000-0000-0000-0000-000000000003', '10000000-0000-0000-0000-000000000009')$q$, 'DENIED');
select pg_temp.as_user(:'COACH');
select pg_temp.expect('the trainer copies a program', $q$select copy_program_structure('10000000-0000-0000-0000-000000000003', '10000000-0000-0000-0000-000000000009')$q$, 'ROWS:1');
select pg_temp.expect('copying into a program that already has workouts is refused', $q$select copy_program_structure('10000000-0000-0000-0000-000000000003', '10000000-0000-0000-0000-000000000009')$q$, 'DENIED');
select pg_temp.expect('copying from a program that does not exist is refused', $q$select copy_program_structure('10000000-0000-0000-0000-0000000000ff', '10000000-0000-0000-0000-000000000005')$q$, 'DENIED');
reset role;
select pg_temp.eq('the copy has the workouts, exercises and sets', (select count(*)::text from workouts where program_id = '10000000-0000-0000-0000-000000000009') || '/' || (select count(*)::text from workout_exercises we join workouts w on w.id = we.workout_id where w.program_id = '10000000-0000-0000-0000-000000000009') || '/' || (select count(*)::text from workout_exercise_sets s join workout_exercises we on we.id = s.workout_exercise_id join workouts w on w.id = we.workout_id where w.program_id = '10000000-0000-0000-0000-000000000009'), '1/1/2');
select pg_temp.eq('…as a program of its own: new slots, nothing hand-set, no hidden exact weight', (select (we.slot_key <> (select slot_key from workout_exercises where id = '30000000-0000-0000-0000-000000000003'))::text || ':' || bool_or(s.is_manual_override)::text || ':' || count(s.weight_kg_exact)::text from workout_exercise_sets s join workout_exercises we on we.id = s.workout_exercise_id join workouts w on w.id = we.workout_id where w.program_id = '10000000-0000-0000-0000-000000000009' group by we.slot_key), 'true:false:0');
select pg_temp.eq('…and no performance came along', (select count(*)::text from set_logs l join workout_exercises we on we.id = l.workout_exercise_id join workouts w on w.id = we.workout_id where w.program_id = '10000000-0000-0000-0000-000000000009'), '0');
select pg_temp.eq('all public tables have RLS enabled', (select count(*)::text from pg_tables where schemaname = 'public' and not rowsecurity), '0');
