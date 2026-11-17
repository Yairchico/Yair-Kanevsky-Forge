select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000a1',false), set_config('request.jwt.claim.role','authenticated',false);
-- a fuller current week for Dani (b1): 3 workouts x 5 exercises x 3 sets
insert into workouts (id, program_id, day_of_week, order_index) values
 ('20000000-0000-0000-0000-000000000011','10000000-0000-0000-0000-000000000001',2,0),
 ('20000000-0000-0000-0000-000000000012','10000000-0000-0000-0000-000000000001',4,0);
insert into workout_exercises (workout_id, exercise_id, order_index)
 select w.id, e.id, e.rn from (select id from workouts where program_id='10000000-0000-0000-0000-000000000001') w,
  (select id, row_number() over (order by name) rn from exercises order by name limit 5) e
 where not (w.id='20000000-0000-0000-0000-000000000001' and e.rn=0);
insert into workout_exercise_sets (workout_exercise_id, set_index, reps_min, reps_max, weight_kg)
 select we.id, n, 8, 10, 40 from workout_exercises we, generate_series(1,3) n
 where not exists (select 1 from workout_exercise_sets s where s.workout_exercise_id = we.id);
-- last week's program for Dani, published, with logs
insert into programs (id, trainee_id, title, status, week_start_date) values
 ('10000000-0000-0000-0000-000000000009','00000000-0000-0000-0000-0000000000b1','prev','published',public.week_start_of(public.israel_today()) - 7);
insert into workouts (id, program_id, day_of_week, order_index) values ('20000000-0000-0000-0000-000000000091','10000000-0000-0000-0000-000000000009',1,0);
insert into workout_exercises (id, workout_id, exercise_id, order_index) values
 ('30000000-0000-0000-0000-000000000091','20000000-0000-0000-0000-000000000091',(select id from exercises where name='Back Squat'),0);
insert into workout_exercise_sets (workout_exercise_id, set_index, reps_min, reps_max, weight_kg) select '30000000-0000-0000-0000-000000000091', n, 5,5,75 from generate_series(1,3) n;
insert into set_logs (workout_exercise_id, trainee_id, set_index, weight_kg, reps, status, logged_at)
 select '30000000-0000-0000-0000-000000000091','00000000-0000-0000-0000-0000000000b1', n, 75, 5, 'done', now() - interval '6 days' from generate_series(1,3) n;
insert into workout_completions (workout_id, trainee_id) values ('20000000-0000-0000-0000-000000000091','00000000-0000-0000-0000-0000000000b1');
-- a 4-week block for Michal (b2), starting next week, from this week's program
select create_block('00000000-0000-0000-0000-0000000000b2','בלוק כוח', (public.week_start_of(public.israel_today()) + 7)::date, 4, array[4], 60, '10000000-0000-0000-0000-000000000003') as block_id \gset
update workout_exercises set progression_type='weight', weight_step_unit='kg', weight_step_kg=2.5
 where workout_id in (select w.id from workouts w join programs p on p.id=w.program_id where p.block_id = :'block_id');
select recompute_block(:'block_id');
-- a block that includes THIS week for Dani would collide; instead publish Michal's block week 1
update programs set status='published' where block_id = :'block_id' and block_week_index = 1;
-- Dani's current + next week become a block (so logging there runs the engine)
select convert_programs_to_block('00000000-0000-0000-0000-0000000000b1','בלוק של דני', array['10000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000002']::uuid[], 2, '{}', 60, false) as dani_block \gset
update workout_exercises set progression_type='weight', weight_step_unit='kg', weight_step_kg=2.5
 where workout_id in (select id from workouts where program_id='10000000-0000-0000-0000-000000000001');
select recompute_block(:'dani_block');
-- saved workout + free session
insert into session_templates (id, title) values ('40000000-0000-0000-0000-000000000001','אימון שמור');
insert into session_template_exercises (id, template_id, exercise_id, order_index) values ('41000000-0000-0000-0000-000000000001','40000000-0000-0000-0000-000000000001',(select id from exercises where name='Back Squat'),0);
insert into session_template_sets (template_exercise_id, set_index, reps_min, reps_max, weight_kg) select '41000000-0000-0000-0000-000000000001', n, 5,5,60 from generate_series(1,3) n;
select start_free_session('40000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-0000000000b1', null) as fs \gset
\echo block=:block_id free_session=:fs dani_block=:dani_block
