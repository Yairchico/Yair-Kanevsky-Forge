-- Migration 0020: set_log_context — what the app reads before writing a set, in one call.
-- It runs with the caller's rights, so these checks are about RLS still deciding what comes back.
-- Uses fixture.sql (trainer, two trainees, the read-only viewer; T1: a published program this week
-- and a draft next week; T2: a published program this week; three planned sets per exercise).
\set ON_ERROR_STOP 0
\ir lib.sql
\set T1 '00000000-0000-0000-0000-0000000000b1'
\set T2 '00000000-0000-0000-0000-0000000000b2'
\set COACH '00000000-0000-0000-0000-0000000000a1'
\set SA '00000000-0000-0000-0000-0000000000c1'
\set WE_PUB '30000000-0000-0000-0000-000000000001'
\set WE_DRAFT '30000000-0000-0000-0000-000000000002'
\set WE_T2 '30000000-0000-0000-0000-000000000003'

-- set 1 is a warm-up; T1 has already performed sets 1 and 3 (and has a skipped row that must not count)
update workout_exercise_sets set set_type = 'warmup' where workout_exercise_id = :'WE_PUB' and set_index = 1;
insert into set_logs (workout_exercise_id, trainee_id, set_index, weight_kg, reps, status) values
 (:'WE_PUB', :'T1', 1, 40, 5, 'done'), (:'WE_PUB', :'T1', 3, 80, 5, 'done'), (:'WE_PUB', :'T1', 2, null, null, 'skipped');

set role authenticated;

-- ===== the trainee it belongs to
select pg_temp.as_user(:'T1');
select set_log_context(:'WE_PUB') as ctx \gset
select pg_temp.eq('trainee: own published exercise resolves', (:'ctx'::jsonb ->> 'trainee_id'), :'T1');
select pg_temp.eq('program id', (:'ctx'::jsonb ->> 'program_id'), '10000000-0000-0000-0000-000000000001');
select pg_temp.eq('workout id', (:'ctx'::jsonb ->> 'workout_id'), '20000000-0000-0000-0000-000000000001');
select pg_temp.eq('status', (:'ctx'::jsonb ->> 'status'), 'published');
select pg_temp.eq('week is this week (a Sunday date)', (:'ctx'::jsonb ->> 'week_start_date'), public.week_start_of(public.israel_today())::text);
select pg_temp.eq('not deleted', (:'ctx'::jsonb -> 'deleted_at')::text, 'null');
select pg_temp.eq('not in a block', (:'ctx'::jsonb -> 'block_id')::text, 'null');
select pg_temp.eq('three planned sets, in order', (select string_agg((s ->> 'set_index') || ':' || (s ->> 'set_type'), ',' order by ord) from jsonb_array_elements(:'ctx'::jsonb -> 'planned') with ordinality as a(s, ord)), '1:warmup,2:working,3:working');
select pg_temp.eq('planned sets carry their ids', (select count(*)::text from jsonb_array_elements(:'ctx'::jsonb -> 'planned') s join workout_exercise_sets w on w.id = (s ->> 'id')::uuid), '3');
select pg_temp.eq('performed sets: only the done ones', (:'ctx'::jsonb -> 'logged')::text, '[1, 3]');
select pg_temp.eq('trainee: own DRAFT program does not resolve', (select set_log_context(:'WE_DRAFT'))::text, null);
select pg_temp.eq('trainee: another trainee''s exercise does not resolve', (select set_log_context(:'WE_T2'))::text, null);
select pg_temp.eq('an id that does not exist', (select set_log_context('30000000-0000-0000-0000-00000000dead'))::text, null);

-- ===== another trainee
select pg_temp.as_user(:'T2');
select pg_temp.eq('other trainee: T1''s exercise does not resolve', (select set_log_context(:'WE_PUB'))::text, null);
select pg_temp.eq('other trainee: their own does, with nothing performed', (select set_log_context(:'WE_T2') -> 'logged')::text, '[]');

-- ===== the trainer: everything, drafts included, and the performed sets are the TRAINEE's
select pg_temp.as_user(:'COACH');
select pg_temp.eq('trainer: T1''s exercise, with T1''s performed sets', (select set_log_context(:'WE_PUB') -> 'logged')::text, '[1, 3]');
select pg_temp.eq('trainer: a draft program resolves', (select set_log_context(:'WE_DRAFT') ->> 'status'), 'draft');
select pg_temp.eq('trainer: whose it is', (select set_log_context(:'WE_T2') ->> 'trainee_id'), :'T2');

-- ===== the read-only viewer may read (and the function can't write anything)
select pg_temp.as_user(:'SA');
select pg_temp.eq('viewer: reads', (select set_log_context(:'WE_PUB') ->> 'trainee_id'), :'T1');
reset role;

-- ===== soft-deleted program: hidden from the trainee, visible (as deleted) to the trainer
update programs set deleted_at = now() where id = '10000000-0000-0000-0000-000000000001';
set role authenticated;
select pg_temp.as_user(:'T1');
select pg_temp.eq('trainee: a deleted program does not resolve', (select set_log_context(:'WE_PUB'))::text, null);
select pg_temp.as_user(:'COACH');
select pg_temp.eq('trainer: sees that it is deleted', (select (set_log_context(:'WE_PUB') ->> 'deleted_at') is not null)::text, 'true');
reset role;
update programs set deleted_at = null where id = '10000000-0000-0000-0000-000000000001';

-- ===== a block week reports its block
insert into blocks (id, trainee_id, title, weeks_count) values ('50000000-0000-0000-0000-000000000001', :'T2', 'b', 2);
update programs set block_id = '50000000-0000-0000-0000-000000000001', block_week_index = 1 where id = '10000000-0000-0000-0000-000000000003';
set role authenticated;
select pg_temp.as_user(:'T2');
select pg_temp.eq('a block week carries the block id', (select set_log_context(:'WE_T2') ->> 'block_id'), '50000000-0000-0000-0000-000000000001');
reset role;

-- ===== not callable without signing in
set role anon;
select pg_temp.expect('anon cannot call it', format($q$select set_log_context(%L)$q$, :'WE_PUB'), 'DENIED');
reset role;
select pg_temp.eq('runs with the caller''s rights (not SECURITY DEFINER)', (select prosecdef::text from pg_proc where proname = 'set_log_context'), 'false');
