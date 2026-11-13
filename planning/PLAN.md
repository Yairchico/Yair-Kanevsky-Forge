# תכנון: חמישה פיצ'רים חדשים

> מסמך תכנון בלבד. שום קוד או קובץ קיים לא שונה. כל ה-SQL כאן הוא **סקיצה** לצורך דיון, לא migration סופי.
> שאלות שצריך להכריע לפני הביצוע נמצאות ב-[`QUESTIONS.md`](./QUESTIONS.md), והסקיצות ב-[`sketches/`](./sketches/index.html).

---

## חלק א: מה קיים היום (סיכום ההיכרות עם הקוד)

### סטאק ו-hosting
- **Next.js 16** (App Router, React 19, Turbopack) + TypeScript + Tailwind v4. עברית ו-RTL, פונט Rubik, רכיבי UI שנבנו ידנית (`src/components/ui/`).
- **Supabase**: Postgres, Auth (התחברות עם שם משתמש) ו-RLS. כל הכתיבה עוברת דרך Server Actions (`actions.ts`), ואין API routes. עדכונים אופטימיים בצד הלקוח ו-`revalidatePath` אחרי כל שינוי.
- **Cloudflare Workers** דרך OpenNext: Worker לפרודקשן ו-Worker לסטייג'ינג. אין R2, Images או Cron מוגדרים (`wrangler.jsonc`).
- **קבצים**: נשמרים רק ב-**Supabase Storage**, ב-bucket ציבורי אחד בשם `exercise-images` (migration 0008). המאמן כותב, כולם קוראים. התמונה מועלית דרך Server Action (`resolveMediaUrl`, עד 5MB), כלומר הקובץ עובר דרך ה-Worker בדרך ל-Supabase. ל-58 תרגילי הבסיס יש תמונות סטטיות ב-`public/exercises/`.

### מבנה ה-DB (הישויות הרלוונטיות)
```
profiles (role: trainer|trainee, is_superadmin)
exercises            ← ספריית התרגילים (משותפת)
  name, muscle_group, equipment, instructions (טקסט "הנחיות"), media_url (תמונה), is_custom
programs             ← תוכנית לשבוע קלנדרי אחד של מתאמן אחד
  trainee_id, title, status draft|published, week_start_date (יום ראשון), deleted_at (soft delete)
  ייחודיות: (trainee_id, week_start_date) where deleted_at is null
workouts             ← אימון בתוך תוכנית
  program_id, day_of_week 0..6, order_index (0/1, עד 2 אימונים ליום)
workout_exercises    ← "שורה" בבילדר: תרגיל בתוך אימון
  exercise_id, order_index, sets INT, reps TEXT ("8-10"), weight TEXT, rpe, rest_seconds, instructions (הערה לשורה)
workout_logs         ← מה שהמתאמן ביצע: שורה אחת לכל תרגיל
  workout_exercise_id, trainee_id, actual_sets JSONB {weight, reps}, rpe_actual, notes
  ייחודיות: (workout_exercise_id, trainee_id) (migration 0012)
workout_exercise_completions ← צ'קבוקס "בוצע" לכל תרגיל (מיידי)
workout_completions          ← "הגש אימון" (חותמת זמן להגשה)
```
**הנקודה החשובה לפיצ'ר 1:** היום אין ישות "סט". סט הוא שלושה שדות על `workout_exercises`: `sets=4, reps="8-10", weight="80"`. גם הביצוע הוא **ערך יחיד לכל התרגיל** (`actual_sets = {weight:"80", reps:"8"}`), למרות שהשדה נקרא בלשון רבים. `reps` ו-`weight` הם טקסט חופשי.

### איך מתאמן מגיש אימון היום
1. `/trainee/workouts` מציג טאבים של אימוני השבוע. לחיצה על תרגיל פותחת את `TraineeExerciseModal`.
2. במודאל יש **שדה משקל אחד, שדה חזרות אחד, RPE והערה לכל התרגיל**. הערכים נשמרים כטיוטה ב-`localStorage` (`src/lib/workout-draft.ts`) ולא בשרת.
3. "סמן כבוצע" נשמר מיד בשרת (`toggleExerciseCompletion`).
4. "הגש אימון" (`submitWorkout`) מבצע upsert של שורת `workout_logs` לכל תרגיל ומוסיף `workout_completions`. אפשר לבטל הגשה ולהגיש שוב.

### המסכים
- **מאמן**: דף בית (סטטיסטיקות ופעילות אחרונה) → מתאמנים → דף מתאמן (עריכה, רשימת תוכניות ותצוגת שבועות עם סטטוס "בוצע/באיחור/לא בוצע" ומודאל של מתוכנן מול בפועל) → **בילדר** (אימונים לפי ימים, ובכל אימון שורות תרגיל עם שדות קומפקטיים שנשמרים ב-blur, גרירה, שכפול ומחיקה) → ספריית תרגילים (חיפוש, ומודאל לכל תרגיל עם עריכת שם/שריר/ציוד ותמונה).
- **מתאמן**: דף בית (ברכה, דפדוף בין שבועות, רצף והתקדמות) → אימונים (טאבים, כרטיסי תרגיל, מודאל והגשה) → היסטוריה של 30 יום.
- **צופה בלבד (superadmin)**: רואה את מסכי המאמן עם `readOnly`, ו-RLS חוסם כל כתיבה.

---

## חלק ב: הפיצ'רים

### פיצ'ר 1: פיצול סטים (גודל L, הבסיס לכל השאר)

#### מטרה
כל סט הוא רשומה נפרדת עם יעד משלו (חזרות, משקל ו-RPE), וגם הביצוע נשמר לכל סט בנפרד. המתאמן מגיש סט אחרי סט, וכל סט נשמר בשרת ברגע שהוא מאשר אותו.

#### שינויים ב-DB (סקיצה)
```sql
-- היעד: סט מתוכנן
create table public.workout_exercise_sets (
  id uuid primary key default gen_random_uuid(),
  workout_exercise_id uuid not null references public.workout_exercises(id) on delete cascade,
  set_index smallint not null check (set_index >= 1),          -- 1,2,3...
  set_type text not null default 'working'
    check (set_type in ('warmup','working','backoff')),        -- חימום לא נספר בקפיצות (פיצ'ר 2)
  reps_min smallint check (reps_min > 0),                      -- "8-10" → 8
  reps_max smallint check (reps_max >= reps_min),              -- "8-10" → 10, ובמספר בודד min=max
  reps_note text,                                              -- גיבוי לערך לא מספרי: "AMRAP", "30 שנ׳"
  weight_kg numeric(6,2) check (weight_kg >= 0),
  weight_note text,                                            -- "משקל גוף", "גומייה אדומה"
  rpe numeric(3,1) check (rpe is null or rpe between 1 and 10),
  -- בשימוש פיצ'ר 2 (נוסף כבר עכשיו כדי לחסוך migration):
  is_manual_override boolean not null default false,
  progression_note text,                                       -- "‎+2.5 ק״ג (השלים 4/4)"
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workout_exercise_id, set_index),
  check (reps_min is not null or reps_note is not null)        -- תחליף ל-NOT NULL של reps היום
);

-- הביצוע: סט שבוצע
create table public.set_logs (
  id uuid primary key default gen_random_uuid(),
  workout_exercise_id uuid not null references public.workout_exercises(id) on delete cascade,
  workout_exercise_set_id uuid references public.workout_exercise_sets(id) on delete set null, -- null = סט נוסף שלא תוכנן
  trainee_id uuid not null references public.profiles(id) on delete cascade,
  set_index smallint not null check (set_index >= 1),
  weight_kg numeric(6,2) check (weight_kg >= 0),
  reps smallint check (reps >= 0),
  rpe numeric(3,1) check (rpe is null or rpe between 1 and 10),
  status text not null default 'done' check (status in ('done','skipped')),
  source text not null default 'trainee' check (source in ('trainee','trainer_session','legacy')),
  logged_by uuid references public.profiles(id) on delete set null,   -- מי הקליד: המתאמן או המאמן (פיצ'ר 5)
  logged_at timestamptz not null default now(),
  unique (workout_exercise_id, trainee_id, set_index)
);
create index set_logs_trainee_logged_at_idx on public.set_logs (trainee_id, logged_at desc);
```
- `workout_exercises`: העמודות `sets`/`reps`/`weight`/`rpe` הופכות ל-**legacy**. ב-migration הזה מסירים את ה-NOT NULL/CHECK של migration 0007, והקוד מפסיק לקרוא ולכתוב אותן. `rest_seconds` ו-`instructions` נשארים ברמת התרגיל.
- `workout_logs` נשאר, אבל רק לנתונים ברמת התרגיל: הערת המתאמן לתרגיל ו-`rpe_actual` כללי. מפסיקים לכתוב ל-`actual_sets`, והעמודה נשמרת כארכיון.
- **RLS**: אותו דפוס כמו היום. למאמן `for all` על `workout_exercise_sets`, ולמתאמן `select` דרך program שפורסם ו-`deleted_at is null` (כמו ב-0010). על `set_logs` המאמן קורא, הצופה (superadmin) קורא, והמתאמן מנהל רק את השורות שלו. **בנוסף** בודקים ב-`with check` ש-`workout_exercise_id` שייך לתוכנית שפורסמה של אותו מתאמן. זה סוגר את הפרצה הקטנה שתועדה ב-PLAN.md הקיים.
- **טריגר `updated_at`** על `workout_exercise_sets`.

#### תוכנית ה-migration (`0013_split_sets.sql`), הרצה חוזרת בטוחה
1. `create table if not exists` לשתי הטבלאות, אינדקסים ו-policies (`drop policy if exists` ואחריו `create`).
2. **Backfill של יעדים**: לכל `workout_exercises` שעדיין אין לו סטים, יוצרים `generate_series(1, sets)` שורות:
   - פענוח `reps`: `^\s*(\d+)\s*$` נותן min=max. `^\s*(\d+)\s*[-–]\s*(\d+)\s*$` נותן min/max. כל ערך אחר נכנס ל-`reps_note`, כמו שהוא.
   - פענוח `weight`: `^\s*(\d+(?:\.\d+)?)\s*(ק"ג|קג|kg)?\s*$` נותן `weight_kg`. כל ערך אחר נכנס ל-`weight_note`.
   - `rpe` מועתק לכל הסטים.
   - התנאי `where not exists (select 1 from workout_exercise_sets where workout_exercise_id = we.id)` הוא מה שהופך את השלב לבטוח להרצה חוזרת.
3. **Backfill של ביצוע**: לכל `workout_logs` שיש בו `actual_sets` יוצרים **שורה אחת** ב-`set_logs` עם `set_index=1`, `source='legacy'` והערכים המפוענחים. ערכים שאי אפשר לפענח נשארים רק ב-`workout_logs`. כך **לא ממציאים נתונים**: לא ידוע אם המתאמן עשה את כל הסטים באותו משקל. (חלופה: לשכפל לכל הסטים. ראו שאלה Q1.2.)
4. הסרת constraints ישנים: `alter column sets drop not null` וכן `drop constraint if exists workout_exercises_sets_positive`.
5. **לא מוחקים** שום עמודה בשלב הזה. ב-migration נפרד ומאוחר יותר (`0017_drop_legacy_set_columns.sql`) מוחקים את `sets/reps/weight/rpe` מ-`workout_exercises`, רק אחרי שמשתמשים בקוד החדש כמה שבועות.
6. **ספירות לבדיקה** בסוף ה-migration (`raise notice`): כמה שורות נוצרו, וכמה ערכים לא פוענחו ונכנסו ל-`*_note`.

#### שינויים בלוגיקה וב-Server Actions
- **בילדר** (`programs/[programId]/actions.ts`):
  - `addSet`, `updateSet`, `deleteSet` ו-`applyToAllSets` מחליפים את עדכון השדות `sets/reps/weight` ב-`updateWorkoutExercise`.
  - `validateWorkoutExerciseFields` הופך לולידציה לכל סט (חזרות חיוביות, min≤max, RPE בין 1 ל-10, ומשקל אי-שלילי).
  - `addExerciseToWorkout` יוצר ברירת מחדל של 3 סטים × 8-10.
  - `duplicateWorkoutExercise` ו-`duplicateProgramContents` (שכפול שבוע) מעתיקים גם את הסטים. ההעתקה של `workout_exercises` צריכה להחזיר ids כדי למפות ישן לחדש, וזו אותה בעיה שתוקנה ב-e482ac2 ברמת ה-workout.
  - כל שינוי בסט ממשיך לקרוא ל-`revertToDraftIfPublished`.
- **מתאמן** (`src/app/trainee/actions.ts`):
  - **חדש: `logSet(workoutExerciseId, setIndex, {weightKg, reps, rpe})`** מבצע upsert של `set_logs`, ו-`unlogSet` מוחק. הוא נקרא מיד כשהמתאמן לוחץ ✓ על סט. זה **שינוי מכוון מהקונבנציה של batch-on-submit**, כי הבקשה היא במפורש להגיש כל סט בנפרד.
  - הטיוטה ב-localStorage נשארת לערכים שהוקלדו ועוד לא אושרו, ומתווסף **תור כתיבות שנכשלו** (קליטה גרועה בחדר כושר): אם `logSet` נכשל, הסט מסומן "ממתין לשמירה" ונשלח שוב באירוע `online`, בלחיצה הבאה ובהגשה.
  - `submitWorkout` מצטמצם: הוא שולח מחדש סטים שממתינים בתור, שומר הערות ברמת התרגיל ומוסיף `workout_completions`. הוא כבר לא כותב משקל וחזרות.
  - ✓ על "סמן כבוצע" ברמת התרגיל נגזר אוטומטית כשכל סטי ה-working נרשמו, והכפתור הידני נשאר (ראו Q1.3).
- **שאילתות שצריך לעדכן** (כל מקום שקורא `sets, reps, weight` או `actual_sets`):
  `trainer/trainees/[id]/page.tsx`, `workout-detail-modal.tsx`, `programs/[programId]/page.tsx`, `programs/new/page.tsx` (תצוגה מקדימה לשכפול), `trainee/workouts/page.tsx`, `trainee-exercise-modal.tsx`, `trainee/history/page.tsx`.
- **`src/lib/sets.ts`** (חדש): פונקציות תצוגה ופענוח משותפות, למשל `formatSetTarget`, `summarizeSets` ("4 × 8-10 · 80 ק״ג" כשכל הסטים זהים, ו"4 סטים · 80→90" כשהם שונים), ו-`parseLegacyReps`.
- **`types.ts`**: שתי הטבלאות החדשות, עם `Relationships: []`.

#### מסכים
| מסך | שינוי | סקיצה |
|---|---|---|
| בילדר, שורת תרגיל | שורה סגורה מציגה סיכום ("4 × 8-10 · 80 ק״ג"). פתיחה מציגה טבלת סטים: חזרות, משקל ו-RPE לכל סט, כפתורי "+ סט" ו"החל על כל הסטים", ומחיקת סט | `trainer-builder.html` |
| מודאל תרגיל של המתאמן | במקום שדה יחיד: שורה לכל סט עם יעד, "שבוע שעבר" (פיצ'ר 2), שדות משקל וחזרות שמולאו מראש ביעד, וכפתור ✓ גדול. סטטוס שמירה לכל סט | `trainee-exercise.html` |
| מודאל אימון אצל המאמן (מתוכנן מול בפועל) | טבלה לכל תרגיל: סט, יעד ובפועל, עם הדגשה של סט שלא הושלם | `trainer-workout-detail.html` |
| היסטוריית המתאמן | לכל תרגיל רשימת סטים במקום ערך יחיד ("80×8 · 80×8 · 80×7") | `trainee-history.html` |

#### מקרי קצה וסיכונים
- **ערכים חופשיים ישנים** ("12 לכל צד", "20-25"): נשמרים ב-`*_note` ומוצגים כמו שהם. הם לא משתתפים בקפיצות של פיצ'ר 2, והבילדר מסמן אותם ב"⚠ ערך לא מספרי".
- **המתאמן עושה יותר או פחות סטים מהתכנון**: "+ סט נוסף" יוצר `set_logs` עם `workout_exercise_set_id = null`. סטים שלא נרשמו נחשבים "לא בוצעו".
- **המאמן מוחק סט או תרגיל מתוכנית שכבר יש בה ביצוע**: `on delete cascade` על `set_logs` (וגם על `workout_logs` כבר היום) **מוחק היסטוריה**. מוצע לחסום ב-Server Action מחיקה של תרגיל או סט שיש להם ביצוע ("לתרגיל יש ביצוע מתועד, אי אפשר למחוק"), או לעבור למחיקה רכה. ראו Q1.4.
- **מתאמן שפותח את המסך בשני מכשירים**: upsert לכל סט, והשמירה האחרונה גוברת. זה סביר.
- **ביטול הגשה**: כבר לא "מוחק" את הביצוע, כי הסטים כבר בשרת. ביטול הגשה מסיר רק את `workout_completions`, כמו היום.
- **ביצועים**: יותר שורות, אבל בסדר גודל קטן (מאמן אחד). חשוב להוסיף אינדקס `set_logs (workout_exercise_id)`.
- **פריסה**: ה-migration חייב לרוץ **לפני** שהקוד החדש עולה, וחשוב לזכור שכל push עלול לעלות ישר לפרודקשן (ראו ⚠ ב-CLAUDE.md). לכן מומלץ ש-migration 0013 יהיה **תואם לאחור**: הקוד הישן ממשיך לעבוד מולו, כי העמודות הישנות לא נמחקו. סדר הפריסה: (1) להריץ את ה-migration, (2) לבצע push.

---

### פיצ'ר 2: בלוקים, קפיצות ושמירת משקלים (גודל L, הגדול והמסוכן ביותר)

#### מטרה
"בלוק" הוא רצף של N שבועות של אותו מתאמן. המאמן בונה את שבוע 1 ומגדיר לכל תרגיל **חוק קפיצה**. כל שבוע הבא מחושב אוטומטית מהשבוע הקודם: מהיעדים, **ומהביצוע בפועל**. המתאמן רואה בכל סט מה עשה בפעם הקודמת.

#### שינויים ב-DB (סקיצה)
```sql
create table public.blocks (
  id uuid primary key default gen_random_uuid(),
  trainee_id uuid not null references public.profiles(id) on delete cascade,
  title text not null,                                  -- "בלוק כוח 1"
  start_week_date date not null,                        -- יום ראשון
  weeks_count smallint not null check (weeks_count between 1 and 16),
  status text not null default 'active' check (status in ('active','completed','archived')),
  default_deload_pct smallint not null default 60 check (default_deload_pct between 30 and 100),
  auto_publish_next_week boolean not null default false, -- ראו Q2.3
  notes text,
  created_at timestamptz not null default now(),
  deleted_at timestamptz
);

alter table public.programs
  add column if not exists block_id uuid references public.blocks(id) on delete set null,
  add column if not exists block_week_index smallint,          -- 1..weeks_count
  add column if not exists is_deload boolean not null default false,
  add column if not exists deload_pct smallint;                -- null = ברירת המחדל של הבלוק
-- ייחודיות: (block_id, block_week_index) where deleted_at is null

alter table public.workout_exercises
  add column if not exists slot_key uuid,                      -- "אותו תרגיל" לאורך שבועות הבלוק
  add column if not exists progression_type text not null default 'none'
    check (progression_type in ('none','weight','reps','double')),
  add column if not exists weight_step_kg numeric(5,2),        -- ‎+2.5 / +5
  add column if not exists reps_step smallint,                 -- ‎+1 / +2
  add column if not exists reps_cap smallint,                  -- בקפיצה כפולה (double): עד כמה חזרות לפני שמעלים משקל
  add column if not exists progression_basis text not null default 'actual'
    check (progression_basis in ('actual','planned')),         -- לפי ביצוע בפועל, או קפיצה לינארית בכל מקרה
  add column if not exists rounding_kg numeric(4,2) not null default 2.5;
create index if not exists workout_exercises_slot_key_idx on public.workout_exercises (slot_key);
```
(`is_manual_override` ו-`progression_note` על `workout_exercise_sets` נוספים כבר בפיצ'ר 1.)

**למה החוק נשמר על `workout_exercises` של כל שבוע ולא בטבלה נפרדת?** כך המאמן יכול לשנות את הקפיצה משבוע 3 והלאה, למשל להעביר מ-+5 ל-+2.5, בלי לגעת בשבועות שכבר עברו. החוק מועתק קדימה יחד עם השורה. `slot_key` הוא מה שמקשר בין "סקוואט, אימון א'" בשבוע 2 לבין אותו סקוואט בשבוע 3.

#### אלגוריתם הקפיצה (לכל slot ולכל סט working)
```
base     = השבוע הקודם בבלוק שאינו דילואד (prev)
targets  = היעדים של prev (כולל דריסות ידניות, כי הם הכוונה של המאמן)
actuals  = set_logs של prev לאותו slot

אם progression_basis = 'planned'  → תמיד קופצים
אחרת:
  success = כל סטי ה-working נרשמו, וכל סט reps ≥ reps_min במשקל ≥ weight_kg של היעד
  אם אין ביצוע בכלל (דילוג)        → חזרה על היעד, progression_note = "לא בוצע, הקפיצה נדחתה"
  אם success = false                → חזרה על היעד, progression_note = "השלים 3/4, חוזרים על המשקל"
  אם success = true:
    weight: weight_kg += weight_step_kg
    reps:   reps_min/max += reps_step
    double: אם reps_max + reps_step ≤ reps_cap → מוסיפים חזרות
            אחרת → weight_kg += step ו-reps חוזרים לערך ההתחלתי של הבלוק
  עיגול: round(weight_kg / rounding_kg) * rounding_kg

דילואד: sets_target = targets(prev) עם weight_kg × deload_pct/100 (מעוגל). אותו מספר סטים, או פחות (Q2.5).
         השבוע שאחרי הדילואד מחושב מה-prev שלפני הדילואד, כך שהדילואד "שקוף" לשרשרת.
סט עם is_manual_override = true לא משתנה לעולם.
שבוע שכבר יש בו set_logs לאותו slot "קפוא", ולא מחשבים אותו מחדש.
```

#### מתי החישוב רץ (המלצה)
- **פונקציית SQL `public.apply_block_progression(p_workout_id uuid)`**, `SECURITY DEFINER`: מקבלת אימון שהוגש, מוצאת את השבוע הבא באותו בלוק, ומחשבת מחדש את ה-slots של **האימון התואם בלבד**. היא נקראת:
  1. מ-`submitWorkout` (אצל המתאמן) ומסיום אימון אישי (פיצ'ר 5).
  2. מכפתור "חשב מחדש" בדף הבלוק אצל המאמן.
- **למה SQL ולא TypeScript עם admin client?** המתאמן לא אמור לקבל הרשאת כתיבה לתוכניות. ה-admin client תלוי ב-`SUPABASE_SERVICE_ROLE_KEY` בזמן ריצה, ובדיוק המשתנה הזה היה חסר שוב ושוב ב-Worker (ראו Known gotchas). פונקציה עם `SECURITY DEFINER` שבודקת בתוכה שהקורא הוא המתאמן של האימון או המאמן לא תלויה ב-env בכלל.
- **חיסרון**: הלוגיקה ב-plpgsql קשה יותר לבדיקה. כדי להתמודד עם זה: (1) לכתוב את האלגוריתם קודם כפונקציה טהורה ב-TS (`src/lib/progression.ts`) עם בדיקות יחידה, ולהשתמש בה **לתצוגה המקדימה** בדף הבלוק. (2) לתרגם ל-SQL. (3) להריץ בסביבת הפיתוח Postgres מקומי עם fixtures ולוודא שהשתיים מחזירות תוצאות זהות.
- **אין Cron.** הכל קורה כתגובה לאירוע (הגשה או לחיצה). Cron Trigger ב-Cloudflare אפשרי אבל דורש עטיפה מותאמת של ה-Worker ב-OpenNext, ואין בו צורך.

#### יצירת בלוק (flow)
1. בדף המתאמן: "בלוק חדש". המאמן בוחר שם, שבוע התחלה, מספר שבועות, אילו שבועות הם דילואד ואחוז הדילואד.
2. המאמן בונה את שבוע 1 (אפשר גם כשכפול של שבוע קיים) בבילדר הרגיל, שמציג עכשיו בכל שורה גם "קפיצה".
3. "צור את שבועות 2 עד N": נוצרות תוכניות **טיוטה** לכל שבוע, עם יעדים לפי תכנון לינארי (בהנחה שהכל יצליח). ביצוע אמיתי מעדכן אותן בהדרגה.
4. אם בשבוע כלשהו כבר יש תוכנית קיימת: popup "החלף / דלג על השבוע / בטל" (אותו דפוס כמו `replace_existing` היום).

#### Server Actions ולוגיקה
- `blocks/actions.ts` (חדש): `createBlock`, `generateBlockWeeks`, `recomputeBlock`, `setDeloadWeek`, `shiftBlockByWeek` (המתאמן פספס שבוע שלם), `endBlock` ו-`startNextBlockFromLast` (שבוע 1 של בלוק חדש עם המשקלים האחרונים).
- בילדר: `updateProgression(workoutExerciseId, rule)`. עריכה של סט בשבוע עתידי בתוך בלוק מסמנת `is_manual_override = true` ומחזירה את זה ללקוח כדי להציג תג "ידני", ונוסף כפתור `clearOverride`.
- **"מה עשית בפעם הקודמת"**: פונקציה משותפת `getPreviousPerformance(traineeId, slotKey | exerciseId)`. בתוך בלוק היא משתמשת ב-slot של השבוע הקודם, ומחוץ לבלוק ב-`set_logs` האחרון של אותו `exercise_id`. החלק הזה **שימושי גם בלי בלוקים בכלל**, ואפשר להעלות אותו כבר עם פיצ'ר 1.
- RLS: על `blocks` המאמן מקבל `for all`, הצופה קורא, והמתאמן קורא את הבלוקים שלו (רק כותרת ומספר השבוע, לתצוגת "שבוע 3/6"). זה תלוי בשאלה Q2.6.

#### מסכים
| מסך | שינוי | סקיצה |
|---|---|---|
| דף מתאמן (מאמן) | כרטיס "בלוק פעיל" (שם, שבוע 3/6, פס התקדמות וכפתור לפתיחה) וכפתור "בלוק חדש" | `trainer-block-overview.html` (למעלה) |
| **חדש**: יצירת בלוק | טופס: שם, שבוע התחלה, מספר שבועות ובחירת שבועות דילואד | `trainer-block-new.html` |
| **חדש**: דף בלוק | מטריצה של תרגיל × שבוע עם היעד בכל תא (`80×8 → 82.5×8`), ובה מסומנים דריסה ידנית, "חזרה על משקל", דילואד וביצוע בפועל. פעולות: חישוב מחדש, דחייה בשבוע, פרסום שבוע וסיום בלוק | `trainer-block-overview.html` |
| בילדר | בכל שורה: "קפיצה: +2.5 ק״ג / +1 חזרה / ללא", ותג של שבוע הבלוק בכותרת. סט שנדרס מקבל אייקון מנעול | `trainer-builder.html` |
| מודאל תרגיל של המתאמן | "שבוע שעבר: 80×8" ליד כל סט, וחץ ↑ כשיש קפיצה | `trainee-exercise.html` |
| דף הבית של המתאמן | "בלוק כוח · שבוע 3 מתוך 6" (אופציונלי) | – |

#### מקרי קצה (מפורט)
| מקרה | התנהגות מוצעת |
|---|---|
| **לא השלים חזרות** (בסט אחד או יותר: reps < reps_min) | אין קפיצה. השבוע הבא חוזר על אותו יעד, עם הערה "השלים 3/4 סטים". **אין הורדה אוטומטית**. אם זה קורה פעמיים ברצף לאותו slot, דף הבלוק מציג למאמן תג "תקוע" כדי שיחליט בעצמו |
| **השלים יותר מהנדרש** (12 חזרות כשהיעד 8-10) | קפיצה רגילה אחת. לא קופצים פעמיים, כדי שהחישוב יישאר צפוי |
| **עשה במשקל גבוה מהיעד** | הבסיס לחישוב נשאר היעד ולא המשקל בפועל, והמאמן רואה את הפער בדף הבלוק. (חלופה ב-Q2.4) |
| **דילוג על אימון** (אין ביצוע) | השבוע הבא חוזר על היעד עם "לא בוצע, הקפיצה נדחתה". אימון שהושלם באיחור, למשל אימון של ראשון שהוגש ברביעי, עדיין נספר: ההגשה מפעילה חישוב מחדש של השבוע הבא, כל עוד הוא לא התחיל |
| **דילוג על שבוע שלם** | פעולה "דחה את הבלוק בשבוע" מזיזה את כל התוכניות העתידיות שבוע קדימה (`week_start_date + 7`, לפי הסדר מהסוף להתחלה בגלל הייחודיות) |
| **ביצוע חלקי** (2 מתוך 4 סטים) | נחשב כ"לא השלים", ולכן חזרה על היעד |
| **המאמן דורס ידנית שבוע מסוים** | עריכה של סט בשבוע עתידי מסמנת `is_manual_override`. החישוב האוטומטי לא נוגע בסט הזה, והשבוע שאחריו **מחושב מהערך הידני**. "שחזר לאוטומטי" מבטל את הדריסה. בבילדר: מנעול ליד הסט, ובדף הבלוק: תא מסומן "ידני" |
| **המאמן משנה תרגיל בשבוע אחד** (למשל סקוואט במקום לחיצת רגליים) | התרגיל החדש מקבל `slot_key` חדש, בלי שרשרת. השאלה אם להחזיר את התרגיל המקורי בשבוע הבא היא Q2.7 |
| **המאמן עורך את שבוע 1 אחרי שהשבועות נוצרו** | כפתור "חשב מחדש שבועות עתידיים": מחשב מחדש כל מה שלא נדרס ולא קפוא |
| **שבוע דילואד** | `is_deload = true`. המשקלים הם `deload_pct` (ברירת מחדל 60%) מהשבוע הקודם, מעוגלים. הביצוע בדילואד **לא** משפיע על השבוע שאחריו, שמחושב מהשבוע שלפני הדילואד. שבוע דילואד שנוסף באמצע מזיז את המשך הבלוק (Q2.5) |
| **תרגיל בלי משקל מספרי** (משקל גוף, גומייה) | אפשר רק קפיצת חזרות. בבילדר, אפשרות "משקל" מושבתת עם הסבר |
| **עיגול** | `rounding_kg` לכל תרגיל: 2.5 לבר, ‏1 או 2 למשקולות יד. 82.3 מעוגל ל-82.5 |
| **השבוע הבא כבר פורסם** | החישוב מעדכן אותו (המתאמן עוד לא ביצע אותו), אבל **לא** מחזיר אותו לטיוטה, כי זה עדכון מערכת ולא עריכה של המאמן. שבוע שכבר התחיל קפוא |
| **בלוק נגמר** | הסטטוס הופך ל-completed. בדף הבלוק: "התחל בלוק חדש", ששבוע 1 שלו נבנה מהיעדים או מהביצוע של השבוע האחרון |
| **מחיקת תוכנית אחת מתוך בלוק** | מחיקה רכה, כמו היום. השרשרת מדלגת עליה, והשבוע הבא מחושב מהשבוע הקיים הקודם |
| **שני אימונים ביום עם אותו תרגיל** | אין בעיה: לכל שורה יש `slot_key` משלה |
| **מתאמן שמבצע אימון של שבוע שעבר** | מותר. החישוב רץ על השבוע הבא, אלא אם הוא כבר קפוא |

#### סיכונים
- **מורכבות**: זה הפיצ'ר עם הכי הרבה לוגיקה עסקית שקשה לבדוק בלי DB אמיתי. אין לנו גישה לפרויקט Supabase החי, ולכן הבדיקות יהיו מול Postgres מקומי בסביבת הפיתוח (צריך לוודא שאפשר להתקין אותו).
- **אמון של המאמן**: מספר שמשתנה "מעצמו" מבלבל. כל תא מחושב חייב להראות **למה** (`progression_note`), והמאמן צריך לראות תצוגה מקדימה לפני פרסום.
- **שבירת ההנחה "תוכנית אחת לשבוע"**: הבלוק יושב *מעל* התוכניות ולא מחליף אותן, כך שכל המסכים הקיימים ממשיכים לעבוד.

---

### פיצ'ר 3: הערות קבועות לתרגילים (גודל S)

#### מה כבר קיים
- `exercises.instructions` כבר קיים ("הנחיות"). הוא נקבע **רק ביצירת התרגיל**, **אי אפשר לערוך אותו אחר כך** (`updateExerciseDetails` מעדכן רק שם, שריר וציוד), והוא מוצג למתאמן במודאל כ"תיאור".
- `workout_exercises.instructions` ("הערות" בשורה בבילדר) הוא כבר בפועל **הערה ברמת תוכנית ספציפית**.

#### ההצעה
- **DB**: אין צורך בעמודה חדשה להערה עצמה. משתמשים ב-`exercises.instructions` ומשנים את התווית בממשק ל"הערה קבועה". נוספת רק עמודה אחת:
  ```sql
  alter table public.workout_exercises
    add column if not exists hide_library_note boolean not null default false;
  ```
  (נכנס ל-migration ‏0014 יחד עם הווידאו.)
- **לוגיקה**: `updateExerciseDetails` מקבל גם `instructions`. אחרי עריכה צריך `revalidatePath` לבילדר ולמסכי המתאמן, כי ההערה משותפת.
- **מסכים** (`trainer-exercise-library.html`):
  - מודאל התרגיל בספרייה: שדה "הערה קבועה" שאפשר לערוך.
  - בילדר: מתחת לשם התרגיל, ההערה הקבועה באפור (📌), ומתחתיה שדה "הערה לתוכנית הזו", שהוא השדה הקיים.
  - מתאמן ומצב אימון אישי: 📌 ההערה הקבועה, ומתחתיה "הערת המאמן לשבוע הזה" (אם קיימת).

#### האם צריך דריסה ברמת תוכנית? ההמלצה: **הוספה, לא החלפה**
- שתי ההערות מוצגות יחד: הקבועה (טכניקה, "גב ישר, ברכיים החוצה") והספציפית ("השבוע עצירה של 2 שנ׳ למטה"). כך המאמן לא צריך להעתיק את ההערה הקבועה ולערוך אותה, וכשהוא משפר את ההערה הקבועה זה מתעדכן בכל מקום.
- למקרה הנדיר שההערה הקבועה לא מתאימה לתוכנית מסוימת (למשל מתאמן עם פציעה): תיבת סימון "הסתר את ההערה הקבועה בתוכנית זו" (`hide_library_note`). זה זול ופשוט.
- **החלפה מלאה לא מומלצת**: היא יוצרת עותקים שלא מתעדכנים, ואת הבלבול של "למה התיקון שלי לא מופיע אצל המתאמן?".

#### מקרי קצה
- אורך: הגבלה ל-1000 תווים ושמירת שורות חדשות (`whitespace-pre-line`).
- תרגילי בסיס (seed) מתחילים בלי הערה.
- שכפול שבוע מעתיק את `hide_library_note`.

---

### פיצ'ר 4: סרטונים לתרגילים (גודל M: קישור S, העלאה M)

#### השוואה
| | **קישור (YouTube "לא רשום", Vimeo, Drive)** | **העלאה ל-Supabase Storage** (המקום שבו נשמרות היום התמונות) | **Cloudflare Stream** | **Cloudflare R2** |
|---|---|---|---|---|
| איפה נשמר | אצל YouTube | bucket ‏`exercise-videos` | שירות הווידאו של Cloudflare | bucket ‏R2 |
| עלות | חינם | Free: ‏1GB אחסון ו-~5GB תעבורה בחודש. Pro ($25 לחודש): ‏100GB אחסון, ותעבורה מעבר למכסה ~$0.09/GB | ‏$5 לכל 1,000 דקות אחסון ו-$1 לכל 1,000 דקות צפייה, בלי עלות תעבורה | ~$0.015/GB לחודש, ‏10GB חינם, ‏**ללא עלות תעבורה** (לפי הידיעה שלי, לאמת) |
| מגבלת גודל | אין בפועל | **‏50MB לקובץ** ב-Free | גדולה | גדולה |
| דחיסה | אוטומטית, עם איכות אדפטיבית | **אין**. הקובץ מוגש כמו שהוא, אז צריך לדחוס בטלפון או להגביל אורך ורזולוציה | אוטומטית (HLS אדפטיבי) | אין |
| נגן | iframe של YouTube (מיתוג, "סרטונים מומלצים" בסוף, ובמצב "לא רשום" זה בסדר) | `<video>` של הדפדפן. פשוט, בלי מיתוג, אבל בלי איכות אדפטיבית | נגן Stream או HLS | `<video>` |
| מאמץ פיתוח | קטן: שדה URL ופענוח לכתובת embed | בינוני: העלאה ישירה מהדפדפן עם signed upload URL, כי **אי אפשר להעביר 50MB דרך Server Action ו-Worker** כמו שעושים עם התמונות היום | גבוה: חשבון, טוקן API ו-webhooks | בינוני-גבוה: binding חדש וחתימת URL |
| חוויית מאמן | מעלה ל-YouTube ומדביק קישור (שני צעדים) | מצלם ומעלה ישר מהאפליקציה (צעד אחד) | כמו העלאה | כמו העלאה |
| סיכונים | הסרטון נמחק או הופך לפרטי ביוטיוב. דורש חשבון YouTube | **תעבורה**: כל צפייה של מתאמן מורידה את כל הקובץ. 20 מתאמנים × 3 צפיות בשבוע × 10MB זה ~2.5GB בחודש, כלומר חצי מהמכסה החינמית מסרטונים בלבד | ספק נוסף לנהל | ספק נוסף, חיבור ל-OpenNext |

(מחירים לפי מקורות עדכניים ל-2026. צריך לאמת מול supabase.com/pricing ו-developers.cloudflare.com/stream/pricing לפני החלטה.)

#### המלצה
**שלב א (עכשיו): קישור בלבד.** שדה "קישור לסרטון" שמזהה YouTube (כולל Shorts), Vimeo וקישור ישיר ל-mp4, ומציג נגן מוטמע. העלות אפסית, אין מגבלת גודל, הדחיסה אוטומטית, וזה מתאים לסטאק בלי תשתית חדשה.
**שלב ב (אם המאמן יעדיף לצלם ולהעלות מהטלפון): העלאה ל-Supabase Storage**, באותו דפוס של התמונות אבל בהעלאה ישירה מהדפדפן ל-Supabase (`createSignedUploadUrl`) ולא דרך ה-Worker. מגבלה של 50MB, והמלצה בממשק לסרטון של 15-30 שניות. כל עוד המאמן מעלה סרטונים קצרים, זה נכנס למכסה החינמית. **Stream ו-R2 לא מומלצים** בקנה המידה הזה (מאמן אחד, עשרות סרטונים), כי ספק נוסף לא מצדיק את עצמו.
אותו שדה במודל הנתונים משרת את שתי האפשרויות, כך ששלב ב לא דורש לשנות את שלב א.

#### DB (‏`0014_exercise_notes_and_video.sql`)
```sql
alter table public.exercises
  add column if not exists video_url text,            -- קישור חיצוני, או URL ציבורי של קובץ שהועלה
  add column if not exists video_kind text
    check (video_kind is null or video_kind in ('youtube','vimeo','file','upload')),
  add column if not exists video_storage_path text;   -- רק כש-upload, כדי שאפשר יהיה למחוק את הקובץ
-- שלב ב (migration נפרד, ‏0018):
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('exercise-videos','exercise-videos', true, 52428800, array['video/mp4','video/quicktime','video/webm'])
on conflict (id) do nothing;
-- policies: אותו דפוס כמו exercise-images (‏0008)
```

#### לוגיקה
- `src/lib/video.ts`: `parseVideoUrl(url)` מחזיר `{kind, embedUrl}` או שגיאה בעברית. ולידציה בשרת, ומותר רק https.
- `updateExerciseVideo(exerciseId, formData)` (קישור), ובשלב ב גם `createVideoUploadUrl(exerciseId)` ו-`confirmVideoUpload`.
- מחיקה או החלפה של סרטון שהועלה מוחקת גם את הקובץ מה-bucket.
- רכיב `ExerciseVideo`: iframe ‏`youtube-nocookie.com` עם `loading="lazy"`, או `<video controls playsinline preload="metadata">`. **הסרטון לא נטען לפני לחיצה**: קודם מוצגת תמונה ממוזערת וכפתור ▶, כדי לחסוך תעבורה.

#### מסכים
- מודאל תרגיל בספרייה: אזור "סרטון" עם טאבים "קישור / העלאה", תצוגה מקדימה, החלפה ומחיקה (`trainer-exercise-library.html`).
- כרטיס תרגיל בספרייה: תג ▶ כשיש סרטון.
- מודאל תרגיל של המתאמן ומצב אימון אישי: כפתור "▶ צפה בסרטון" שפותח את הנגן (`trainee-exercise.html`).

#### מקרי קצה וסיכונים
- סרטון YouTube פרטי או שנמחק: הנגן מציג שגיאה של YouTube, ואין לנו דרך לזהות את זה מראש. מוצג קישור "פתח ביוטיוב" כגיבוי.
- וידאו ממכשיר iOS הוא ‎`.mov` ‏(HEVC), שלא כל דפדפן מנגן. זה סיבה נוספת להתחיל מקישורים.
- CSP: אם יוגדר בעתיד, צריך להתיר `youtube-nocookie.com` ו-`player.vimeo.com`.
- `readOnly`: הצופה רואה את הסרטון אבל לא את כפתורי העריכה.

---

### פיצ'ר 5: מצב אימון אישי (גודל M)

#### מטרה
המאמן, עם המתאמן מולו, פותח מסך ייעודי: בוחר מתאמן ואימון, עובר תרגיל אחרי תרגיל **ידנית**, ומקליד משקל וחזרות לכל סט. התוצאה נשמרת **בדיוק כמו אימון שהמתאמן הגיש**: אותן טבלאות, אותה היסטוריה ואותן קפיצות. אין טיימרים ואין מעבר אוטומטי.

#### DB (‏`0015_trainer_session.sql`)
```sql
-- מי ואיך: אותן טבלאות, עם מקור
alter table public.workout_completions
  add column if not exists source text not null default 'trainee'
    check (source in ('trainee','trainer_session')),
  add column if not exists completed_by uuid references public.profiles(id) on delete set null;
-- set_logs.source/logged_by כבר קיימים מפיצ'ר 1

-- RLS: המאמן מקבל הרשאת כתיבה (היום הוא רק קורא):
create policy "trainer manages set_logs" on public.set_logs
  for all using (public.is_trainer()) with check (public.is_trainer());
create policy "trainer manages workout_completions" on public.workout_completions
  for all using (public.is_trainer()) with check (public.is_trainer());
create policy "trainer manages workout_logs" on public.workout_logs ...;            -- הערות לתרגיל
create policy "trainer manages workout_exercise_completions" on ... ;
```
הצופה (superadmin) **לא** מקבל את ההרשאות האלה. `is_trainer()` מחזיר false עבורו, והמסכים מפנים אותו החוצה. **אין טבלת sessions נפרדת**: אימון אישי הוא פשוט אימון שה-`source` שלו `trainer_session`. כך ההיסטוריה, הקפיצות וסטטוס "בוצע" עובדים בלי שום שינוי. (טבלה נפרדת תידרש רק אם ירצו בעתיד תמחור או ספירת אימונים אישיים. ראו Q5.4.)

#### לוגיקה
- `trainer/session/actions.ts`:
  - `logSetForTrainee(traineeId, workoutExerciseId, setIndex, values)`: אותו upsert של `logSet` מפיצ'ר 1, עם `trainee_id = traineeId`, `source='trainer_session'` ו-`logged_by = auth.uid()`. קודם `requireTrainer()`.
  - `finishSession(traineeId, workoutId)`: ‏`workout_completions` עם `source='trainer_session'`, ואחריו `apply_block_progression` (פיצ'ר 2) ו-`revalidatePath` למסכי המאמן **ולמסכי המתאמן**.
- **שמירה לכל סט מיד**, עם אותו תור כשלונות ב-localStorage כמו אצל המתאמן (מפתח `trainer-session:{workoutId}`). נפילת אינטרנט באמצע לא מאבדת כלום, והמסך מציג "3 סטים ממתינים לשמירה".
- **הוספת תרגיל או סט באמצע האימון**: "+ סט" זה רק `set_logs` נוסף. "+ תרגיל" באמצע האימון משנה את התוכנית, ובמצב הזה **לא** מחזירים אותה לטיוטה, כי מדובר בתיעוד ולא בתכנון. זו חריגה מכוונת מ-`revertToDraftIfPublished`, ועדיף להשאיר אותה לגרסה שנייה (Q5.3).

#### מסכים
| מסך | תיאור | סקיצה |
|---|---|---|
| **חדש**: ‏`/trainer/session`, בחירה | שלב 1: בחירת מתאמן (חיפוש). שלב 2: אימוני השבוע שלו, כשהאימון של היום מסומן ראשון, ולכל אימון סטטוס "בוצע/לא בוצע" | `trainer-session-start.html` |
| **חדש**: ‏`/trainer/session/[workoutId]`, אימון חי | כותרת עם שם המתאמן, האימון ו"תרגיל 2 מתוך 6". שורת צ'יפים של כל התרגילים (קפיצה חופשית). כרטיס תרגיל עם הערה קבועה, ▶ סרטון וטבלת סטים בכפתורים גדולים (יעד, שבוע שעבר, שדות משקל וחזרות שמולאו מראש, ‏✓). כפתורי "הקודם / הבא" ו"סיים אימון" | `trainer-session-live.html` |
| **חדש**: סיכום בסיום | מודאל: כמה סטים בוצעו, מה לא בוצע, הערה כללית, "שמור וסיים" | בתוך `trainer-session-live.html` |
| דף בית של המאמן | כפתור בולט "▶ התחל אימון אישי" | `trainer-session-start.html` |
| דף מתאמן | כפתור "התחל אימון אישי" שמדלג על שלב 1 | – |
| היסטוריה (מאמן ומתאמן) | תג "אימון אישי עם המאמן" על אימון שתועד במצב הזה | `trainee-history.html` |

**עיצוב**: מותאם לטלפון או טאבלט ביד אחת. אזורי לחיצה של 44px לפחות, שדות מספריים עם `inputmode="decimal"`, וכפתורי ‎−/+‎ ‏(±2.5 ק״ג, ‏±1 חזרה) ליד כל שדה כדי לא להקליד.

#### מקרי קצה וסיכונים
- **האימון בטיוטה** (לא פורסם): המאמן יכול לתעד אותו, אבל המתאמן לא יראה אותו בהיסטוריה עד שיפורסם. מוצע לפרסם אוטומטית בתחילת אימון אישי, או להציג אזהרה (Q5.2).
- **אימון שלא קיים בתוכנית** (המתאמן הגיע ליום נוסף): אפשר לפתוח אימון חופשי (5ב, למטה) ולשייך אותו למתאמן בסיום.
- **המתאמן פותח באותו זמן את האימון בטלפון**: הסטים בשרת זהים, אבל הטיוטה המקומית שלו מיושנת. מסך המתאמן צריך להעדיף ערכי שרת על פני localStorage לסט שכבר נרשם, ולרענן כשהחלון חוזר לפוקוס.
- **האימון כבר הוגש על ידי המתאמן**: מצב אימון אישי מאפשר לתקן ולהשלים. ההגשה נשארת, וה-`source` לא משתנה.
- **מכשיר המאמן**: מסך משותף (טאבלט בחדר הכושר) מחובר לחשבון המאמן, וזה סיכון אבטחה פיזי. מספיק לציין אותו, אין פעולה טכנית נדרשת.
- **מתאמן שעושה את התרגילים בסדר אחר**: הצ'יפים מאפשרים קפיצה חופשית בלי לאלץ סדר.

---

### פיצ'ר 5ב: אימון אישי ללא מתאמן ("אימון חופשי") (גודל M, נוסף בבקשה)

#### מטרה
המאמן פותח אימון שלא קשור לאף מתאמן ולאף תוכנית. למשל: אורח שבא לאימון ניסיון ואין לו חשבון, אימון של המאמן עצמו, או מתאמן קיים שהגיע בלי שתוכנן לו אימון. התרגילים נבחרים מהספרייה תוך כדי האימון, ונרשמים עם אותו רכיב סטים בדיוק (משקל, חזרות ו-✓) כמו בשאר האימונים. בסיום אפשר **לשייך בדיעבד** את האימון למתאמן קיים, או להשאיר אותו לא משויך.

#### למה צריך טבלאות נפרדות
`set_logs` (פיצ'ר 1) תלויה ב-`workout_exercise_id` (תרגיל בתוך תוכנית) וב-`trainee_id` שחובה למלא, כי ככה ה-RLS וההיסטוריה מקושרים למתאמן. אימון חופשי לא מקיים אף אחד מהשניים. האפשרות לייצר בשבילו "תוכנית רפאים" נפסלת, כי `programs.trainee_id` הוא NOT NULL, ויש רק תוכנית אחת לכל מתאמן בשבוע.

#### DB (סקיצה, נכנס ל-‏`0015_trainer_session.sql`)
```sql
create table public.free_sessions (
  id uuid primary key default gen_random_uuid(),
  trainee_id uuid references public.profiles(id) on delete set null,  -- null = לא משויך
  guest_label text,                                                   -- "אורח", "אימון ניסיון" (אופציונלי)
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  notes text,
  created_by uuid references public.profiles(id) on delete set null
);
create table public.free_session_exercises (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.free_sessions(id) on delete cascade,
  exercise_id uuid not null references public.exercises(id) on delete restrict,
  order_index smallint not null,
  notes text
);
create table public.free_session_sets (
  id uuid primary key default gen_random_uuid(),
  session_exercise_id uuid not null references public.free_session_exercises(id) on delete cascade,
  set_index smallint not null check (set_index >= 1),
  weight_kg numeric(6,2) check (weight_kg >= 0),
  reps smallint check (reps >= 0),
  rpe numeric(3,1) check (rpe is null or rpe between 1 and 10),
  logged_at timestamptz not null default now(),
  unique (session_exercise_id, set_index)
);
```
- **RLS**: למאמן `for all` ולצופה (superadmin) קריאה. **המתאמן** רואה `select` רק כש-`free_sessions.trainee_id = auth.uid()`, כלומר אחרי שיוך.
- אותו פורמט עמודות כמו `set_logs` (‏`weight_kg`, ‏`reps`, ‏`rpe`), כך שהרכיב של שורת הסט משמש את שני המצבים.

#### לוגיקה
- `startFreeSession(guestLabel?)`, ‏`addFreeSessionExercise(sessionId, exerciseId)`, ‏`replaceFreeSessionExercise` (החלפה: המכונה תפוסה), ‏`logFreeSet` (‏upsert, שמירה לכל סט מיד + אותו תור כשלונות) ו-`finishFreeSession(sessionId, {traineeId?, notes})`.
- **שיוך בדיעבד** רק מעדכן את `trainee_id`. האימון מופיע בהיסטוריה של המתאמן עם התג "אימון חופשי עם המאמן", **ולא** משפיע על התוכנית השבועית, על "בוצע/באיחור" ועל הקפיצות בבלוק, כי אין לו slot. "שבוע שעבר" (פיצ'ר 2) **כן** יכול להשתמש בו כמקור לפי `exercise_id` (שאלה Q5.9).
- היסטוריית המתאמן (`trainee/history/page.tsx`) והמודאל אצל המאמן מאחדים שני מקורות: הגשות מתוכנית ו-`free_sessions` המשויכים. הם ממוינים יחד לפי תאריך.
- **אימון שנפתח ולא הסתיים** (סגרו את הדפדפן): הוא מופיע ברשימה עם "המשך", ואחרי 24 שעות נסגר אוטומטית בתצוגה (‏`finished_at` נשאר null עד שהמאמן לוחץ "סיים"). אימון ריק לגמרי (אפס סטים) לא נשמר ברשימה.

#### מסכים
| מסך | תיאור | סקיצה |
|---|---|---|
| `/trainer/session`, בחירה | מתג "עם מתאמן / ללא מתאמן (אימון חופשי)" בראש המסך | `trainer-session-start.html` |
| **חדש**: ‏`/trainer/session/free/[id]` | שם או כינוי אופציונלי, צ'יפים של תרגילים עם "+ תרגיל" (בורר מהספרייה, אותו רכיב חיפוש כמו בבילדר), שורות סט, "החלף" תרגיל, הקודם / הבא / סיים | `trainer-session-freeform.html` |
| **חדש**: מודאל סיום | סיכום, "לשייך למתאמן?" (בחירה אופציונלית) והערה | באותה סקיצה |
| דף הבית של המאמן | כרטיס "אימונים חופשיים" עם רשימה ותג משויך / לא משויך. לחיצה פותחת את האימון לצפייה, לשיוך ולמחיקה | באותה סקיצה |

#### מקרי קצה וסיכונים
- **אורח שהופך למתאמן**: יוצרים לו חשבון כרגיל, ואז משייכים אליו את האימונים החופשיים שלו מהרשימה. שיוך אפשרי בכל רגע, לא רק בסיום.
- **שיוך בטעות למתאמן הלא נכון**: אפשר לבטל שיוך או לשנות אותו. מה שמתאמן כבר ראה הוא רק היסטוריה, ושום דבר לא נמחק.
- **פרטיות**: אימון לא משויך גלוי רק למאמן ולצופה, ואף מתאמן לא רואה אותו.
- **פיצול מקורות בהיסטוריה**: שני מקורות נתונים לאותו מסך מוסיפים מורכבות לשאילתות. מוצע view ‏(`trainee_history_v`) או פונקציית שרת אחת שמאחדת אותם, כדי לא לשכפל את האיחוד בכל מסך.
- **סטטיסטיקות במסך הבית של המאמן** ("פעילות אחרונה"): צריך להחליט אם אימונים חופשיים נספרים בהן (Q5.8).

---

### פיצ'ר 5ג: אימונים אישיים שמורים (תבניות) (גודל M, נוסף בבקשה)

#### מטרה
המאמן שומר אימון אישי **כתבנית לשימוש חוזר**: רשימת תרגילים, ולכל תרגיל סטים עם יעד (חזרות ומשקל). התבנית לא שייכת לאף מתאמן ולאף שבוע. אפשר להפעיל אותה כמה פעמים שרוצים, עם מתאמן או בלי. יש שתי דרכים ליצור תבנית:
1. **לבנות מראש**: "אימון שמור חדש", בעורך שדומה לבילדר.
2. **לשמור אימון חופשי שהסתיים**: תיבת סימון "שמור גם כאימון שמור" במודאל הסיום. מה שבוצע בפועל הופך ליעדים של התבנית.

#### DB (סקיצה, נכנס ל-‏`0015_trainer_session.sql`)
```sql
create table public.session_templates (
  id uuid primary key default gen_random_uuid(),
  title text not null check (length(trim(title)) > 0),
  notes text,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz                                  -- מחיקה רכה, כדי שאימונים שכבר נעשו מהתבנית ימשיכו להצביע עליה
);
create table public.session_template_exercises (
  id uuid primary key default gen_random_uuid(),
  template_id uuid not null references public.session_templates(id) on delete cascade,
  exercise_id uuid not null references public.exercises(id) on delete restrict,
  order_index smallint not null,
  rest_seconds integer,
  notes text
);
create table public.session_template_sets (               -- אותן עמודות יעד כמו workout_exercise_sets (פיצ'ר 1)
  id uuid primary key default gen_random_uuid(),
  template_exercise_id uuid not null references public.session_template_exercises(id) on delete cascade,
  set_index smallint not null check (set_index >= 1),
  set_type text not null default 'working' check (set_type in ('warmup','working','backoff')),
  reps_min smallint, reps_max smallint, reps_note text,
  weight_kg numeric(6,2), weight_note text,
  rpe numeric(3,1) check (rpe is null or rpe between 1 and 10),
  unique (template_exercise_id, set_index)
);

-- אימון שהתחיל מתבנית זוכר מאיפה הוא בא, ושומר את היעדים שהיו באותו רגע:
alter table public.free_sessions add column if not exists template_id uuid
  references public.session_templates(id) on delete set null;
alter table public.free_session_sets
  add column if not exists target_reps_min smallint,
  add column if not exists target_reps_max smallint,
  add column if not exists target_weight_kg numeric(6,2);
```
- **RLS**: למאמן `for all` ולצופה (superadmin) קריאה. המתאמן לא רואה תבניות בכלל.
- **למה מעתיקים את היעדים בהתחלת האימון ולא קוראים אותם מהתבנית בזמן אמת?** כדי שעריכת תבנית מחר לא תשנה בדיעבד מה היה היעד באימון של היום.

#### לוגיקה
- `createTemplate`, ‏`updateTemplate` ו-`deleteTemplate` (מחיקה רכה), ו-`duplicateTemplate`. עריכת סטים ותרגילים עוברת דרך אותן פונקציות ולידציה של פיצ'ר 1 (חזרות, טווח, משקל ו-RPE).
- `startFromTemplate(templateId, traineeId | null)` יוצר `free_sessions` עם `template_id` (ו-`trainee_id` אם נבחר), מעתיק את התרגילים, וממלא מראש את היעדים בכל סט.
- `saveSessionAsTemplate(sessionId, title)` נקרא מתוך `finishFreeSession`, כשהתיבה מסומנת. **הביצוע בפועל** הופך ליעד, ותרגיל שלא בוצע בו אף סט לא נכלל.
- **"בפעם הקודמת"** באימון מתבנית: האימון האחרון מאותה תבנית **עם אותו מתאמן**, ואם אין כזה, ה-`set_logs` האחרון של אותו `exercise_id` (כמו בפיצ'ר 2). כשאין מתאמן, לא מוצג "בפעם הקודמת".
- **"הוסף לתוכנית של מתאמן…"** (אופציונלי, Q5.12): מעתיק את התבנית כאימון חדש לשבוע שנבחר בתוכנית של המתאמן. זה אותו קוד כמו שכפול שבוע, רק ממקור אחר.

#### מסכים
| מסך | תיאור | סקיצה |
|---|---|---|
| **חדש**: ‏`/trainer/session/templates` | כרטיסי תבניות (שם, מספר תרגילים, שימוש אחרון) עם כפתורי התחל, ערוך, שכפל ומחק | `trainer-session-templates.html` |
| **חדש**: מודאל "התחל" | עם מתאמן (בחירה מרשימה) או בלי | באותה סקיצה |
| **חדש**: עורך תבנית | שם, הערה, ושורות תרגיל עם **אותו רכיב טבלת סטים כמו בבילדר**, בלי קפיצות ובלי ימים | באותה סקיצה |
| `/trainer/session`, בחירה | אפשרות "מתוך אימון שמור" | `trainer-session-start.html` |
| מודאל סיום של אימון חופשי | "שמור גם כאימון שמור" עם שם | `trainer-session-freeform.html` |
| דף הבית של המאמן | קישור "אימונים שמורים" ליד "התחל אימון אישי" | – |

#### מקרי קצה וסיכונים
- **מחיקת תרגיל מהספרייה שמשמש בתבנית**: `on delete restrict`, כמו בתוכניות. מוצגת הודעה ידידותית שהתרגיל בשימוש בתבנית.
- **שתי תבניות עם אותו שם**: מותר. מוצג גם תאריך יצירה כדי להבדיל ביניהן.
- **עריכת תבנית בזמן שאימון ממנה פתוח**: לא משפיע על האימון הפתוח, כי היעדים הועתקו בהתחלה.
- **שימוש חוזר במבנה של פיצ'ר 1**: עורך התבנית ורכיב הסטים חייבים להיות אותם רכיבים בדיוק כמו בבילדר. אחרת יהיו שני עורכי סטים שונים לתחזק. לכן 5ג נבנה **אחרי** פיצ'ר 1 ו-5ב.

---

## חלק ג: סדר ביצוע מומלץ ותלויות

```
             ┌──────────────────────┐
             │ 1. פיצול סטים (L)    │  ← בסיס: workout_exercise_sets + set_logs
             └─────────┬────────────┘
         ┌─────────────┼──────────────────────┐
         ▼             ▼                      ▼
 ┌───────────────┐ ┌──────────────────┐ ┌──────────────────────┐
 │ 3. הערות (S)  │ │ 5. אימון אישי (M)│ │ 2. בלוקים וקפיצות (L)│
 │  (עצמאי)      │ │  צריך את 1       │ │  צריך את 1, ומשתמש    │
 └───────────────┘ └────────┬─────────┘ │  בנתונים של 5         │
 ┌───────────────┐          └──────────►└──────────────────────┘
 │ 4. וידאו (M)  │  (עצמאי. קישור קודם, העלאה אחר כך)
 └───────────────┘
```

| שלב | מה | migration | למה בסדר הזה |
|---|---|---|---|
| **1** | פיצול סטים, כולל "שבוע שעבר" לפי exercise_id | ‏`0013` | הבסיס. כולל כבר את עמודות פיצ'ר 2 על הסטים כדי לחסוך migration נוסף |
| **2** | הערות קבועות ווידאו בקישור | ‏`0014` | זול, עצמאי, ונותן ערך מיד. אפשר לעשות במקביל לשלב 1, וגם **לפני** אם רוצים "ניצחון מהיר" |
| **3** | מצב אימון אישי, כולל אימון חופשי ללא מתאמן (5ב) ואימונים שמורים (5ג) | ‏`0015` | פשוט יותר מבלוקים, משתמש בדיוק ברכיבי הסטים של שלב 1, ומייצר את נתוני הביצוע שהבלוקים יצרכו. הסדר בתוך השלב: 5, אחריו 5ב, אחריו 5ג, כל אחד ב-commit נפרד |
| **4** | בלוקים וקפיצות | ‏`0016_blocks_and_progression.sql` | הכי גדול ומסוכן. נבנה כשמודל הסטים כבר יציב ונבדק בשימוש אמיתי. החישוב מתחבר גם ל-`submitWorkout` וגם ל-`finishSession` |
| **5** | וידאו בהעלאה (אם יוחלט) | ‏`0018` (bucket ‏+ policies) | רק אם הקישורים לא מספיקים בפועל |
| **6** | ניקוי | ‏`0017` | מחיקת `sets/reps/weight/rpe` מ-`workout_exercises`, אחרי כמה שבועות של שימוש יציב |

> מספור ה-migrations לפי סדר הביצוע: ‏0013 סטים, ‏0014 הערות ווידאו (קישור), ‏0015 אימון אישי, ‏0016 בלוקים, ‏0017 ניקוי, ‏0018 bucket וידאו (אם יוחלט). אם הסדר ישתנה, המספור ישתנה איתו.

**הערכה כוללת**: L + L + S + M + M, ועוד M לאימון החופשי (5ב) ו-M לאימונים השמורים (5ג). כל שלב הוא commit או סדרת commits נפרדת, עם `tsc`, ‏`eslint`, ‏`build` ו-`cf:build` לפני כל commit. **כל שלב עם migration דורש שהמשתמש יריץ את ה-SQL ב-Supabase לפני ה-push**, בגלל הסיכון הידוע שכל push עולה לפרודקשן.

**בדיקות**: מה שאפשר לבדוק בסביבה הזו הוא ה-build, וגם (מוצע) Postgres מקומי להרצת ה-migrations על נתוני דמה ולבדיקת פונקציית הקפיצות. את ההתנהגות החיה המשתמש צריך לבדוק בעצמו, כמו היום.
