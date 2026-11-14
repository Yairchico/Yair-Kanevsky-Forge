-- Migration 0014: privilege escalation and the trainee's limits on the performance tables.
-- Needs the fixture: run.sh loads fixture.sql first for this file.
\set ON_ERROR_STOP 0
\ir lib.sql
\set T1 '00000000-0000-0000-0000-0000000000b1'
\set T2 '00000000-0000-0000-0000-0000000000b2'
\set COACH '00000000-0000-0000-0000-0000000000a1'
\set SA '00000000-0000-0000-0000-0000000000c1'

set role authenticated;
select pg_temp.as_user(:'T1');
-- 1. profile escalation
select pg_temp.expect('trainee cannot set is_superadmin', $q$update profiles set is_superadmin = true where id = '00000000-0000-0000-0000-0000000000b1'$q$, 'ROWS:0');
select pg_temp.expect('trainee cannot set role', $q$update profiles set role = 'trainer' where id = '00000000-0000-0000-0000-0000000000b1'$q$, 'ROWS:0');
select pg_temp.expect('trainee cannot rename self', $q$update profiles set username = 'hacked' where id = '00000000-0000-0000-0000-0000000000b1'$q$, 'ROWS:0');
select pg_temp.eq('trainee still sees only own profile', (select count(*)::text from profiles), '1');
-- 3. performance tables
select pg_temp.expect('trainee logs own published exercise', $q$insert into workout_logs (workout_exercise_id, trainee_id, notes) values ('30000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-0000000000b1','n')$q$, 'ROWS:1');
select pg_temp.expect('trainee upserts own log', $q$insert into workout_logs (workout_exercise_id, trainee_id, notes) values ('30000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-0000000000b1','n2') on conflict (workout_exercise_id, trainee_id) do update set notes = excluded.notes$q$, 'ROWS:1');
select pg_temp.expect('trainee cannot log DRAFT exercise', $q$insert into workout_logs (workout_exercise_id, trainee_id) values ('30000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-0000000000b1')$q$, 'DENIED');
select pg_temp.expect('trainee cannot log other trainee''s exercise', $q$insert into workout_logs (workout_exercise_id, trainee_id) values ('30000000-0000-0000-0000-000000000003','00000000-0000-0000-0000-0000000000b1')$q$, 'DENIED');
select pg_temp.expect('trainee cannot log as another trainee', $q$insert into workout_logs (workout_exercise_id, trainee_id) values ('30000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-0000000000b2')$q$, 'DENIED');
select pg_temp.expect('trainee completes own published workout', $q$insert into workout_completions (workout_id, trainee_id) values ('20000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-0000000000b1')$q$, 'ROWS:1');
select pg_temp.expect('trainee cannot complete DRAFT workout', $q$insert into workout_completions (workout_id, trainee_id) values ('20000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-0000000000b1')$q$, 'DENIED');
select pg_temp.expect('trainee cannot complete other''s workout', $q$insert into workout_completions (workout_id, trainee_id) values ('20000000-0000-0000-0000-000000000003','00000000-0000-0000-0000-0000000000b1')$q$, 'DENIED');
select pg_temp.expect('trainee marks own exercise done (upsert)', $q$insert into workout_exercise_completions (workout_exercise_id, trainee_id) values ('30000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-0000000000b1') on conflict (workout_exercise_id, trainee_id) do nothing$q$, 'ROWS:1');
select pg_temp.expect('trainee cannot mark other''s exercise', $q$insert into workout_exercise_completions (workout_exercise_id, trainee_id) values ('30000000-0000-0000-0000-000000000003','00000000-0000-0000-0000-0000000000b1')$q$, 'DENIED');
select pg_temp.expect('trainee un-submits (delete own completion)', $q$delete from workout_completions where workout_id = '20000000-0000-0000-0000-000000000001'$q$, 'ROWS:1');
-- 4. set_logs: source/logged_by are facts
select pg_temp.expect('trainee logs a set claiming trainer_session', $q$insert into set_logs (workout_exercise_id, trainee_id, set_index, reps, source, logged_by, workout_exercise_set_id) values ('30000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-0000000000b1',1,5,'trainer_session','00000000-0000-0000-0000-0000000000a1',(select id from workout_exercise_sets where workout_exercise_id='30000000-0000-0000-0000-000000000003' and set_index=1))$q$, 'ROWS:1');
reset role;
select pg_temp.eq('…source forced to trainee', (select source from set_logs where set_index = 1 and trainee_id = :'T1'), 'trainee');
select pg_temp.eq('…logged_by forced to self', (select logged_by::text from set_logs where set_index = 1 and trainee_id = :'T1'), :'T1');
select pg_temp.eq('…foreign planned-set link dropped', (select workout_exercise_set_id::text from set_logs where set_index = 1 and trainee_id = :'T1'), null);

-- superadmin
set role authenticated;
select pg_temp.as_user(:'SA');
select pg_temp.eq('superadmin reads exercise completions', (select count(*)::text from workout_exercise_completions), '1');
select pg_temp.expect('superadmin cannot write completions', $q$insert into workout_completions (workout_id, trainee_id) values ('20000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-0000000000b1')$q$, 'DENIED');
select pg_temp.expect('superadmin cannot drop own flag... (no-op)', $q$update profiles set is_superadmin = false where id = '00000000-0000-0000-0000-0000000000c1'$q$, 'ROWS:0');

-- trainer
select pg_temp.as_user(:'COACH');
select pg_temp.expect('trainer edits trainee identity', $q$update profiles set full_name = 'Dani C', username = 'danic' where id = '00000000-0000-0000-0000-0000000000b1'$q$, 'ROWS:1');
select pg_temp.expect('trainer cannot promote via app session', $q$update profiles set role = 'trainer' where id = '00000000-0000-0000-0000-0000000000b1'$q$, 'DENIED');
select pg_temp.expect('trainer cannot grant superadmin via app session', $q$update profiles set is_superadmin = true where id = '00000000-0000-0000-0000-0000000000b1'$q$, 'DENIED');
select pg_temp.expect('trainer cannot demote self', $q$update profiles set role = 'trainee' where id = '00000000-0000-0000-0000-0000000000a1'$q$, 'DENIED');
reset role;
select pg_temp.as_user('');

-- 2. sign-up metadata
insert into auth.users (id, email, raw_user_meta_data) values ('00000000-0000-0000-0000-0000000000e1','evil@x','{"role":"trainer","full_name":"Evil","username":"evil"}');
select pg_temp.eq('sign-up with role=trainer becomes a trainee', (select role::text from profiles where id = '00000000-0000-0000-0000-0000000000e1'), 'trainee');
insert into auth.users (id, email, raw_user_meta_data) values ('00000000-0000-0000-0000-0000000000e2','odd@x','{"role":"admin","full_name":"Odd","username":"oddone"}');
select pg_temp.eq('unknown role value no longer breaks sign-up', (select role::text from profiles where id = '00000000-0000-0000-0000-0000000000e2'), 'trainee');
select pg_temp.eq('exactly one trainer', (select count(*)::text from profiles where role = 'trainer'), '1');
-- dashboard (direct SQL) can still manage flags
select pg_temp.expect('dashboard can grant superadmin', $q$update profiles set is_superadmin = true where id = '00000000-0000-0000-0000-0000000000e2'$q$, 'ROWS:1');
-- integrity trigger for any writer
select pg_temp.expect('direct write with wrong trainee rejected', $q$insert into workout_completions (workout_id, trainee_id) values ('20000000-0000-0000-0000-000000000003','00000000-0000-0000-0000-0000000000b1')$q$, 'DENIED');
-- every public table has RLS on
select pg_temp.eq('all public tables have RLS enabled', (select coalesce(string_agg(c.relname, ','), '') from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity), '');
