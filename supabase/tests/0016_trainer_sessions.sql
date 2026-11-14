-- Migration 0016: the trainer writing on a trainee's behalf, free sessions, saved workouts.
-- Needs the fixture: run.sh loads fixture.sql first for this file.
\set ON_ERROR_STOP 0
\ir lib.sql
\set T1 '00000000-0000-0000-0000-0000000000b1'
\set T2 '00000000-0000-0000-0000-0000000000b2'
\set COACH '00000000-0000-0000-0000-0000000000a1'
\set SA '00000000-0000-0000-0000-0000000000c1'

-- ===== trainer writes performance for a trainee
set role authenticated;
select pg_temp.as_user(:'COACH');
select pg_temp.expect('trainer logs a set for the trainee', $q$insert into set_logs (workout_exercise_id, trainee_id, set_index, reps, weight_kg) values ('30000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-0000000000b1',1,5,80)$q$, 'ROWS:1');
select pg_temp.expect('trainer cannot log it under the WRONG trainee', $q$insert into set_logs (workout_exercise_id, trainee_id, set_index, reps) values ('30000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-0000000000b2',2,5)$q$, 'DENIED');
select pg_temp.expect('trainer can log on a DRAFT program (session auto-publishes in the app)', $q$insert into set_logs (workout_exercise_id, trainee_id, set_index, reps) values ('30000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-0000000000b1',1,5)$q$, 'ROWS:1');
select pg_temp.expect('trainer completes the workout', $q$insert into workout_completions (workout_id, trainee_id, notes) values ('20000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-0000000000b1','good session')$q$, 'ROWS:1');
select pg_temp.expect('trainer marks exercise done', $q$insert into workout_exercise_completions (workout_exercise_id, trainee_id) values ('30000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-0000000000b1')$q$, 'ROWS:1');
select pg_temp.expect('trainer writes exercise note', $q$insert into workout_logs (workout_exercise_id, trainee_id, notes) values ('30000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-0000000000b1','knee ok')$q$, 'ROWS:1');
reset role;
select pg_temp.eq('set source = trainer_session', (select source from set_logs where workout_exercise_id='30000000-0000-0000-0000-000000000001' and set_index=1), 'trainer_session');
select pg_temp.eq('set logged_by = trainer', (select logged_by::text from set_logs where workout_exercise_id='30000000-0000-0000-0000-000000000001' and set_index=1), :'COACH');
select pg_temp.eq('completion source = trainer_session', (select source from workout_completions where workout_id='20000000-0000-0000-0000-000000000001'), 'trainer_session');
select pg_temp.eq('completion completed_by = trainer', (select completed_by::text from workout_completions where workout_id='20000000-0000-0000-0000-000000000001'), :'COACH');

-- trainee later re-confirms a set / updates the completion: set flips to trainee, completion keeps its origin
set role authenticated;
select pg_temp.as_user(:'T1');
select pg_temp.expect('trainee sees the trainer-logged set', $q$select 1 from set_logs where set_index = 1 and workout_exercise_id='30000000-0000-0000-0000-000000000001'$q$, 'ROWS:1');
select pg_temp.expect('trainee overwrites that set', $q$insert into set_logs (workout_exercise_id, trainee_id, set_index, reps, weight_kg) values ('30000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-0000000000b1',1,6,80) on conflict (workout_exercise_id, trainee_id, set_index) do update set reps = excluded.reps$q$, 'ROWS:1');
select pg_temp.expect('trainee re-submits (upsert) the completed workout', $q$insert into workout_completions (workout_id, trainee_id) values ('20000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-0000000000b1') on conflict (workout_id, trainee_id) do update set completed_at = now()$q$, 'ROWS:1');
select pg_temp.expect('trainee cannot claim a completion was a trainer session', $q$update workout_completions set source = 'trainee', completed_by = null where workout_id = '20000000-0000-0000-0000-000000000001'$q$, 'ROWS:1');
reset role;
select pg_temp.eq('set now source = trainee', (select source from set_logs where workout_exercise_id='30000000-0000-0000-0000-000000000001' and set_index=1), 'trainee');
select pg_temp.eq('completion origin preserved', (select source || ':' || completed_by::text from workout_completions where workout_id='20000000-0000-0000-0000-000000000001'), 'trainer_session:' || :'COACH');

-- ===== templates + free sessions
set role authenticated;
select pg_temp.as_user(:'COACH');
insert into session_templates (id, title) values ('40000000-0000-0000-0000-000000000001', 'כוח רגליים');
insert into session_template_exercises (id, template_id, exercise_id, order_index, rest_seconds, instructions) values
  ('41000000-0000-0000-0000-000000000001','40000000-0000-0000-0000-000000000001',(select id from exercises where name='Back Squat'),0,120,'לאט'),
  ('41000000-0000-0000-0000-000000000002','40000000-0000-0000-0000-000000000001',(select id from exercises where name='Lunge'),1,null,null);
insert into session_template_sets (template_exercise_id, set_index, set_type, reps_min, reps_max, weight_kg) values
  ('41000000-0000-0000-0000-000000000001',1,'warmup',10,10,40),
  ('41000000-0000-0000-0000-000000000001',2,'working',5,5,80),
  ('41000000-0000-0000-0000-000000000001',3,'working',5,5,80);
insert into session_template_sets (template_exercise_id, set_index, reps_note, weight_note) values
  ('41000000-0000-0000-0000-000000000002',1,'12 לכל צד','משקל גוף');
select pg_temp.expect('template set without reps rejected', $q$insert into session_template_sets (template_exercise_id, set_index) values ('41000000-0000-0000-0000-000000000002',2)$q$, 'DENIED');

select start_free_session(p_template_id => '40000000-0000-0000-0000-000000000001', p_trainee_id => :'T1') as sid \gset
select pg_temp.eq('session from template: exercises copied', (select count(*)::text from free_session_exercises where session_id = :'sid'), '2');
select pg_temp.eq('session from template: targets copied', (select string_agg(coalesce(target_weight_kg::text, target_weight_note) || 'x' || coalesce(target_reps_min::text, target_reps_note), ',' order by e.order_index, s.set_index) from free_session_sets s join free_session_exercises e on e.id = s.session_exercise_id where e.session_id = :'sid'), '40.00x10,80.00x5,80.00x5,משקל גוףx12 לכל צד');
select pg_temp.eq('session remembers its template + trainee + creator', (select (template_id = '40000000-0000-0000-0000-000000000001')::text || (trainee_id = :'T1')::text || (created_by = :'COACH')::text from free_sessions where id = :'sid'), 'truetruetrue');
-- perform: squat sets 2,3 (not the warm-up), nothing on lunge; add an extra exercise with 2 sets
update free_session_sets set weight_kg = 82.5, reps = 5, logged_at = now() where session_exercise_id = (select id from free_session_exercises where session_id = :'sid' and order_index = 0) and set_index in (2,3);
insert into free_session_exercises (id, session_id, exercise_id, order_index) values ('51000000-0000-0000-0000-000000000009', :'sid', (select id from exercises where name='Deadlift'), 2);
select pg_temp.expect('ad-hoc set must be performed or targeted', $q$insert into free_session_sets (session_exercise_id, set_index) values ('51000000-0000-0000-0000-000000000009', 1)$q$, 'DENIED');
select pg_temp.expect('performed set needs reps', $q$insert into free_session_sets (session_exercise_id, set_index, weight_kg, logged_at) values ('51000000-0000-0000-0000-000000000009', 1, 100, now())$q$, 'DENIED');
insert into free_session_sets (session_exercise_id, set_index, weight_kg, reps, logged_at) values ('51000000-0000-0000-0000-000000000009', 1, 100, 5, now()), ('51000000-0000-0000-0000-000000000009', 2, 105, 3, now());

select save_session_as_template(p_session_id => :'sid', p_title => 'מהאימון של היום') as newt \gset
select pg_temp.eq('save as new template: only performed exercises, performed sets as targets', (select string_agg(ex.name || ':' || (select string_agg(s.weight_kg::text || 'x' || s.reps_min, '/' order by s.set_index) from session_template_sets s where s.template_exercise_id = te.id), ' | ' order by te.order_index) from session_template_exercises te join exercises ex on ex.id = te.exercise_id where te.template_id = :'newt'), 'Back Squat:82.50x5/82.50x5 | Deadlift:100.00x5/105.00x3');
select save_session_as_template(p_session_id => :'sid', p_template_id => '40000000-0000-0000-0000-000000000001') as upd \gset
select pg_temp.eq('update source template: squat replaced, lunge untouched, deadlift appended', (select string_agg(ex.name || ':' || (select count(*) from session_template_sets s where s.template_exercise_id = te.id), ',' order by te.order_index) from session_template_exercises te join exercises ex on ex.id = te.exercise_id where te.template_id = '40000000-0000-0000-0000-000000000001'), 'Back Squat:2,Lunge:1,Deadlift:2');
select duplicate_session_template(p_template_id => '40000000-0000-0000-0000-000000000001') as dup \gset
select pg_temp.eq('duplicate template copies exercises + sets', (select count(*)::text || '/' || (select count(*) from session_template_sets s join session_template_exercises te on te.id = s.template_exercise_id where te.template_id = :'dup') from session_template_exercises where template_id = :'dup'), '3/5');
select pg_temp.eq('duplicate gets a distinct title', (select title from session_templates where id = :'dup'), 'כוח רגליים (עותק)');
select pg_temp.eq('a session started from a saved workout keeps pointing at THAT one', (select (template_id = '40000000-0000-0000-0000-000000000001')::text from free_sessions where id = :'sid'), 'true');
-- a session that wasn't started from a saved workout becomes the first use of the one made from it
select start_free_session(p_guest_label => 'guest') as adhoc_sid \gset
insert into free_session_exercises (id, session_id, exercise_id, order_index) values ('51000000-0000-0000-0000-00000000000a', :'adhoc_sid', (select id from exercises where name='Deadlift'), 0);
insert into free_session_sets (session_exercise_id, set_index, weight_kg, reps, logged_at) values ('51000000-0000-0000-0000-00000000000a', 1, 90, 5, now());
select save_session_as_template(p_session_id => :'adhoc_sid', p_title => 'from adhoc') as adhoc_t \gset
select pg_temp.eq('an ad-hoc session is linked to the saved workout made from it', (select (template_id = :'adhoc_t')::text from free_sessions where id = :'adhoc_sid'), 'true');
select start_free_session() as empty_sid \gset
select pg_temp.expect('saving an empty session as a template is refused', format($q$select save_session_as_template(p_session_id => %L, p_title => 'x')$q$, :'empty_sid'), 'DENIED');
select pg_temp.expect('free session cannot be assigned to the trainer', format($q$update free_sessions set trainee_id = %L where id = %L$q$, :'COACH', :'empty_sid'), 'DENIED');
select pg_temp.expect('free session cannot be assigned to the superadmin', format($q$update free_sessions set trainee_id = %L where id = %L$q$, :'SA', :'empty_sid'), 'DENIED');
update session_templates set deleted_at = now() where id = :'dup';
select pg_temp.expect('cannot start from a deleted template', format($q$select start_free_session(p_template_id => %L)$q$, :'dup'), 'DENIED');
select pg_temp.expect('exercise used by a template cannot be deleted', $q$delete from exercises where name = 'Lunge'$q$, 'DENIED');

-- trainee visibility
select pg_temp.as_user(:'T1');
select pg_temp.eq('trainee sees own assigned free session only', (select count(*)::text from free_sessions), '1');
select pg_temp.eq('trainee sees its sets', (select count(*)::text from free_session_sets), '6');
select pg_temp.eq('trainee never sees templates', (select count(*)::text from session_templates) || (select count(*)::text from session_template_exercises) || (select count(*)::text from session_template_sets), '000');
select pg_temp.expect('trainee cannot start a session', $q$select start_free_session()$q$, 'DENIED');
select pg_temp.expect('trainee cannot edit a free session', format($q$update free_sessions set notes = 'x' where id = %L$q$, :'sid'), 'ROWS:0');
select pg_temp.expect('trainee cannot edit its sets', $q$update free_session_sets set reps = 99$q$, 'ROWS:0');
select pg_temp.expect('trainee cannot save a template', format($q$select save_session_as_template(p_session_id => %L, p_title => 'x')$q$, :'sid'), 'DENIED');
select pg_temp.as_user(:'T2');
select pg_temp.eq('other trainee sees no free sessions', (select count(*)::text from free_sessions) || (select count(*)::text from free_session_exercises) || (select count(*)::text from free_session_sets), '000');
-- superadmin
select pg_temp.as_user(:'SA');
select pg_temp.eq('superadmin reads sessions + templates', ((select count(*) from free_sessions) > 0)::text || ((select count(*) from session_templates) > 0)::text || ((select count(*) from free_session_sets) > 0)::text, 'truetruetrue');
select pg_temp.expect('superadmin cannot write a template', $q$insert into session_templates (title) values ('x')$q$, 'DENIED');
select pg_temp.expect('superadmin cannot log sets for a trainee', $q$insert into set_logs (workout_exercise_id, trainee_id, set_index, reps) values ('30000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-0000000000b1',3,5)$q$, 'DENIED');
select pg_temp.expect('superadmin cannot start a session', $q$select start_free_session()$q$, 'DENIED');
reset role;
select pg_temp.as_user('');
-- unassign on trainee delete
delete from auth.users where id = :'T1';
select pg_temp.eq('deleting the trainee keeps the session, unassigned', (select (trainee_id is null)::text from free_sessions where id = :'sid'), 'true');
select pg_temp.eq('all public tables have RLS enabled', (select coalesce(string_agg(c.relname, ','), '') from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity), '');

-- ===== housekeeping inside start_free_session: abandoned empty sessions go, anything with sets stays
reset role;
insert into free_sessions (id, guest_label, started_at) values
  ('71000000-0000-0000-0000-000000000001', 'old empty', now() - interval '3 days'),
  ('71000000-0000-0000-0000-000000000002', 'old with sets', now() - interval '3 days'),
  ('71000000-0000-0000-0000-000000000003', 'fresh empty', now() - interval '1 hour'),
  ('71000000-0000-0000-0000-000000000004', 'old empty but finished', now() - interval '3 days');
update free_sessions set finished_at = now() - interval '3 days' + interval '1 hour' where id = '71000000-0000-0000-0000-000000000004';
insert into free_session_exercises (id, session_id, exercise_id)
  select '72000000-0000-0000-0000-000000000002', '71000000-0000-0000-0000-000000000002', id from exercises order by name limit 1;
insert into free_session_sets (session_exercise_id, set_index, reps, weight_kg, logged_at)
  values ('72000000-0000-0000-0000-000000000002', 1, 5, 50, now() - interval '3 days');
set role authenticated;
select pg_temp.as_user(:'COACH');
select pg_temp.expect('starting a session runs the housekeeping', $q$select public.start_free_session(null, null, 'new one')$q$, 'ROWS:1');
reset role;
select pg_temp.eq('abandoned empty session was removed', (select count(*)::text from free_sessions where id = '71000000-0000-0000-0000-000000000001'), '0');
select pg_temp.eq('old session with sets was kept', (select count(*)::text from free_sessions where id = '71000000-0000-0000-0000-000000000002'), '1');
select pg_temp.eq('fresh empty session was kept', (select count(*)::text from free_sessions where id = '71000000-0000-0000-0000-000000000003'), '1');
select pg_temp.eq('finished session was kept', (select count(*)::text from free_sessions where id = '71000000-0000-0000-0000-000000000004'), '1');
