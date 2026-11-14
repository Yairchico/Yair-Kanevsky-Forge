-- A small fixture for 0014_security.sql and 0016_trainer_sessions.sql: a trainer, two trainees, the
-- read-only viewer, and a published + a draft program. Dates are relative to today.
insert into auth.users (id, email, raw_user_meta_data) values
 ('00000000-0000-0000-0000-0000000000a1','coach@x','{"role":"trainer","full_name":"Coach","username":"coach"}'),
 ('00000000-0000-0000-0000-0000000000b1','t1@x','{"full_name":"Dani","username":"dani"}'),
 ('00000000-0000-0000-0000-0000000000b2','t2@x','{"full_name":"Michal","username":"michal"}'),
 ('00000000-0000-0000-0000-0000000000c1','sa@x','{"full_name":"Watcher","username":"watcher"}');
update profiles set is_superadmin = true where id = '00000000-0000-0000-0000-0000000000c1';
insert into programs (id, trainee_id, title, status, week_start_date) values
 ('10000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-0000000000b1','pub','published',public.week_start_of(public.israel_today())),
 ('10000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-0000000000b1','draft','draft',public.week_start_of(public.israel_today()) + 7),
 ('10000000-0000-0000-0000-000000000003','00000000-0000-0000-0000-0000000000b2','pub2','published',public.week_start_of(public.israel_today()));
insert into workouts (id, program_id, day_of_week, order_index) values
 ('20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001',0,0),
 ('20000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000002',0,0),
 ('20000000-0000-0000-0000-000000000003','10000000-0000-0000-0000-000000000003',0,0);
insert into workout_exercises (id, workout_id, exercise_id, order_index) values
 ('30000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001',(select id from exercises where name='Back Squat'),0),
 ('30000000-0000-0000-0000-000000000002','20000000-0000-0000-0000-000000000002',(select id from exercises where name='Back Squat'),0),
 ('30000000-0000-0000-0000-000000000003','20000000-0000-0000-0000-000000000003',(select id from exercises where name='Back Squat'),0);
insert into workout_exercise_sets (workout_exercise_id, set_index, reps_min, reps_max, weight_kg)
 select id, n, 5, 5, 80 from workout_exercises, generate_series(1,3) n;
