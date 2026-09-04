-- Base exercise library. Exercise names in English, muscle_group in Hebrew
-- (matches the app's Hebrew UI — see the exercise library filter chips).
-- Safe to re-run: ON CONFLICT on the unique name from migration 0002.
--
-- NOTE: if you already ran an earlier version of this file with Hebrew
-- exercise names, delete those rows first so they don't sit alongside the
-- English ones as duplicates:
--   delete from public.exercises where is_custom = false and name ~ '[א-ת]';

insert into public.exercises (name, muscle_group, equipment, is_custom) values
  -- חזה
  ('Bench Press', 'חזה', 'מוט', false),
  ('Incline Bench Press', 'חזה', 'מוט', false),
  ('Decline Bench Press', 'חזה', 'מוט', false),
  ('Dumbbell Bench Press', 'חזה', 'משקולות יד', false),
  ('Dumbbell Fly', 'חזה', 'משקולות יד', false),
  ('Cable Fly', 'חזה', 'כבלים', false),
  ('Dips', 'חזה', 'מקבילים', false),
  ('Push-Up', 'חזה', 'משקל גוף', false),

  -- גב
  ('Barbell Row', 'גב', 'מוט', false),
  ('Dumbbell Row', 'גב', 'משקולת יד', false),
  ('Pull-Up', 'גב', 'מתח', false),
  ('Chin-Up', 'גב', 'מתח', false),
  ('Lat Pulldown', 'גב', 'מכונת כבלים', false),
  ('Seated Cable Row', 'גב', 'כבלים', false),
  ('Machine Row', 'גב', 'מכונה', false),
  ('Back Extension', 'גב', 'ספסל היפראקסטנשן', false),

  -- רגליים
  ('Back Squat', 'רגליים', 'מוט', false),
  ('Front Squat', 'רגליים', 'מוט', false),
  ('Deadlift', 'רגליים', 'מוט', false),
  ('Romanian Deadlift', 'רגליים', 'מוט', false),
  ('Leg Press', 'רגליים', 'מכונה', false),
  ('Leg Extension', 'רגליים', 'מכונה', false),
  ('Lying Leg Curl', 'רגליים', 'מכונה', false),
  ('Lunge', 'רגליים', 'משקולות יד', false),
  ('Bulgarian Split Squat', 'רגליים', 'משקולות יד', false),
  ('Calf Raise', 'רגליים', 'מכונה / משקולות', false),

  -- כתפיים
  ('Overhead Press', 'כתפיים', 'מוט', false),
  ('Dumbbell Shoulder Press', 'כתפיים', 'משקולות יד', false),
  ('Lateral Raise', 'כתפיים', 'משקולות יד', false),
  ('Front Raise', 'כתפיים', 'משקולות יד', false),
  ('Reverse Fly', 'כתפיים', 'משקולות יד', false),
  ('Face Pull', 'כתפיים', 'כבלים', false),
  ('Shrug', 'כתפיים', 'מוט / משקולות יד', false),

  -- יד קדמית (ביצפס)
  ('Barbell Curl', 'יד קדמית', 'מוט', false),
  ('Dumbbell Curl', 'יד קדמית', 'משקולות יד', false),
  ('Hammer Curl', 'יד קדמית', 'משקולות יד', false),
  ('Incline Dumbbell Curl', 'יד קדמית', 'משקולות יד', false),
  ('Cable Curl', 'יד קדמית', 'כבלים', false),

  -- יד אחורית (טריצפס)
  ('Triceps Pushdown', 'יד אחורית', 'כבלים', false),
  ('Overhead Triceps Extension', 'יד אחורית', 'משקולת יד', false),
  ('Skull Crusher', 'יד אחורית', 'מוט', false),
  ('Bench Dips', 'יד אחורית', 'ספסל', false),
  ('Rope Pushdown', 'יד אחורית', 'כבלים', false),

  -- בטן / core
  ('Crunch', 'בטן / core', 'משקל גוף', false),
  ('Plank', 'בטן / core', 'משקל גוף', false),
  ('Hanging Leg Raise', 'בטן / core', 'מתח', false),
  ('Ab Wheel Rollout', 'בטן / core', 'גלגלת בטן', false),
  ('Russian Twist', 'בטן / core', 'משקל / משקולת', false),
  ('Cable Crunch', 'בטן / core', 'כבלים', false),

  -- גוף מלא / פונקציונלי
  ('Kettlebell Swing', 'גוף מלא', 'קטלבל', false),
  ('Clean and Press', 'גוף מלא', 'מוט', false),
  ('Burpee', 'גוף מלא', 'משקל גוף', false),
  ('Battle Ropes', 'גוף מלא', 'חבלי אימון', false),
  ('Box Jump', 'גוף מלא', 'קופסת קפיצה', false),

  -- אירובי
  ('Treadmill', 'אירובי', 'הליכון', false),
  ('Stationary Bike', 'אירובי', 'אופניים', false),
  ('Rowing Machine', 'אירובי', 'מכונת חתירה', false),
  ('Stair Climber', 'אירובי', 'מכונת מדרגות', false)
on conflict (name) do nothing;
