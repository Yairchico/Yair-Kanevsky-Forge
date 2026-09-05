# תוכנית פיתוח – אפליקציית אימונים למאמני כוח (MVP)

> מסמך זה הוא תוכנית עבודה חיה. נעדכן אותו ככל שנתקדם (סימון שלבים שהושלמו, שינוי החלטות).
> החזון: לבנות עכשיו אפליקציה פרטית עבור מאמן אחד, אבל **לעצב מהיום הראשון כך שיהיה קל למתג (white-label) ולמכור למאמנים נוספים** בלי לשכתב את הליבה.

---

## 0. עקרון מנחה: MVP רזה, מאמן יחיד (superadmin)

**עדכון:** בשלב הזה יש **מאמן אחד בלבד**, שהוא בפועל superadmin של המערכת. **אין** בונים היום טבלת `organizations` / multi-tenant — זה over-engineering מיותר לשלב הנוכחי.

- טבלת `profiles` מכילה `role` (`'trainer' | 'trainee'`). המאמן היחיד הוא הרשומה היחידה עם `role='trainer'`.
- כל מתאמן משויך ישירות למאמן דרך `trainee_id`/RLS לפי role — **אין** טבלת קישור `trainer_trainee_links` ואין `org_id` בשום טבלה.
- הרשאות (RLS): `role='trainer'` → גישה מלאה לכל המתאמנים/תוכניות/תרגילים. `role='trainee'` → גישה רק לנתונים שבהם `trainee_id = auth.uid()`, ורק לתוכניות עם `status='published'`.
- מיתוג (לוגו/צבעים/שם) — כרגע **הארד-קוד** בקונפיג של האפליקציה (לא בדאטהבייס). כשיגיע הצורך למכור למאמן נוסף, זה יהיה פרויקט נפרד (deploy נפרד + Supabase project נפרד) ולא multi-tenant בתוך אותה מערכת — גישה פשוטה בהרבה ל"מיתוג מחדש" מ-white-label אמיתי, ומתאימה בדיוק לאופי המכירה שתיארת (אפליקציה אישית לכל מאמן).
- המשמעות: קוד פשוט יותר, סכימה קטנה יותר, RLS פשוט יותר, ופיתוח מהיר יותר עכשיו. אם בעתיד יוחלט על multi-tenant אמיתי בתוך מערכת אחת — זה יהיה מיגרציה מודעת, לא deviation מתוכנית קיימת.

---

## 1. Stack טכנולוגי

| שכבה | בחירה | נימוק |
|---|---|---|
| Frontend/Backend | **Next.js 15 (App Router) + TypeScript** | Full-stack אחד (UI + API routes/Server Actions), קהילה גדולה, מתאים ל-mobile-first |
| עיצוב | **Tailwind CSS + shadcn/ui** | בנייה מהירה, קל להחליף ערכת צבעים/מיתוג (טוקנים ב-CSS variables → white-label קל) |
| DB + Auth + Storage | **Supabase (Postgres)** | Auth מובנה, Row Level Security לבידוד נתונים בין ארגונים/מאמנים/מתאמנים, Storage לתמונות/וידאו תרגילים |
| Hosting | **Cloudflare Pages/Workers דרך OpenNext (`@opennextjs/cloudflare`)** | Full-stack Next.js אמיתי (כולל Server Actions, API routes) בריצה על Cloudflare, מהיר וזול |
| ולידציה | **Zod** | סכימות משותפות ל-forms + API |
| State/Forms | **React Hook Form + Zod** | בילדר תרגילים דורש forms דינמיים |
| Drag & Drop | **dnd-kit** | קל משקל, נגיש, מתאים ל-mobile גם |
| ניהול תאריכים | **date-fns** | תוכניות שבועיות, היסטוריה של חודש אחורה |

**החלטה פתוחה שאשמח לאישור שלך:** האם Next.js + Cloudflare (OpenNext) מתאים, או שאתה מעדיף Remix/SvelteKit? ברירת המחדל שאני ממליץ עליה וממשיך איתה אלא אם תגיד אחרת: **Next.js**.

---

## 2. מודל נתונים (סכימת DB עיקרית)

```
profiles                 -- מרחיב את auth.users של Supabase
  id (=auth.users.id), role ('trainer' | 'trainee'), full_name, phone, avatar_url,
  status ('active'|'archived'), created_at

exercises                -- ספריית תרגילים (משותפת, נוצרת ע"י המאמן)
  id, name, muscle_group, equipment, instructions, media_url,
  is_custom, created_by, created_at

programs                 -- תוכנית של מתאמן, משויכת לשבוע קלנדרי אמיתי
  id, trainee_id, title, week_start_date (יום ראשון של השבוע),
  status ('draft'|'published'), version, published_at, created_at, updated_at
  -- unique(trainee_id, week_start_date): תוכנית אחת בלבד לכל מתאמן לכל שבוע

workouts                 -- "אימון 1", "אימון 2" וכו' — ממוספרים, לא לפי יום.
  id, program_id, order_index, title, notes  -- עד 10 אימונים לתוכנית

workout_exercises        -- שורות ה-flow builder בפועל
  id, workout_id, exercise_id, order_index,
  sets, reps, weight, rpe, rest_seconds, instructions,
  superset_group (אופציונלי לעתיד)

workout_logs              -- ביצוע בפועל ע"י המתאמן
  id, workout_exercise_id, trainee_id, performed_at,
  actual_sets_json (סטים/חזרות/משקל שבוצעו בפועל), rpe_actual, notes

workout_completions       -- סימון "בוצע" ברמת האימון השלם
  id, workout_id, trainee_id, completed_at
```

**הערות עיצוב חשובות:**
- `programs.status` = draft/published + `published_at` — זה בדיוק מה שממש את הדרישה "המתאמן רואה רק אחרי Publish". ה-UI של המתאמן שולף רק `status='published'`.
- שמירת גרסה (`version`) מאפשרת בעתיד "פרסום גרסה חדשה" בלי לאבד היסטוריה — לא MVP קריטי אבל שדה זול לשים כבר עכשיו.
- `workout_logs` שומר עד חודש אחורה — ניישם כ-query עם חלון זמן, לא מחיקה בפועל (Postgres storage זול, ואפשר להראות בעתיד "לוח שנה" ארוך יותר בלי migration).

---

## 3. אבטחה והרשאות

- **Supabase Auth**: אימייל+סיסמה ל-MVP (מספיק לשלב פרטי). Magic link אפשרי כשלב הבא.
- **Row Level Security (RLS)** על כל טבלה:
  - `role='trainer'` → גישה מלאה לקרוא/לערוך את כל המתאמנים, התוכניות והתרגילים (המאמן היחיד = superadmin).
  - `role='trainee'` → גישה רק לשורות שבהן `trainee_id = auth.uid()`, ורק לתוכניות עם `status='published'`.
  - טבלת `exercises`: קריאה פתוחה לכל משתמש מחובר (גם מתאמנים, כדי לראות פרטי תרגיל באימון שלהם); כתיבה רק ל-`role='trainer'`.
- אין הרשאות אדמין/סופר-יוזר בשלב הזה מעבר לתפקיד trainer בארגון שלו.

---

## 4. פיצ'רים – פירוט מימוש

### 4.1 התחברות
- מסך login אחד, לפי role מנתב ל-`/trainer` או `/trainee`.
- הרשמת מתאמן: המאמן יוצר אותו ידנית (invite by email / סיסמה זמנית) — אין הרשמה עצמאית פתוחה ב-MVP.

### 4.2 ניהול מתאמנים (מאמן)
- רשימת מתאמנים (`GET /trainees`) עם חיפוש/סטטוס.
- יצירת מתאמן: שם, אימייל, טלפון → יוצר `auth.users` + `profiles` + `trainer_trainee_links`.

### 4.3 ספריית תרגילים
- Seed script: 50–100 תרגילים בסיסיים (Squat, Bench, Deadlift, Row, וכו') עם `muscle_group`, `equipment`.
- הוספת תרגיל custom (מאמן) — נשמר עם `org_id` שלו.
- חיפוש: לפי שם + סינון לפי קבוצת שריר/ציוד (full-text search של Postgres, `ilike` מספיק ל-MVP).

### 4.4 Builder בסגנון Flow
- מסך אימון: רשימת `workout_exercises` הניתנת ל:
  - הוספה: לחיצה על תרגיל מהספרייה (מודל/פאנל צד) → נוסף לסוף הרשימה.
  - Drag & drop לשינוי סדר (`dnd-kit`, מעדכן `order_index`).
  - עריכת שורה inline: sets/reps/weight/RPE/rest/הנחיות (form קטן per-row, autosave).
  - שכפול שורה / מחיקה.
- מבנה: תוכנית → ימים → אימונים → תרגילים (עץ). ה-builder עובד ברמת "אימון בודד" בתוך context של התוכנית השבועית.

### 4.5 תוכנית שבועית + Draft/Publish
- מסך "בניית תוכנית" למתאמן ספציפי: 7 ימים (או פחות), לכל יום 0/1 אימונים ב-MVP (אפשר להרחיב בעתיד ל-multi-workout/day).
- כפתור "שמור טיוטה" (autosave + שמירה מפורשת) וכפתור "פרסם" שמעדכן `status='published'`, `published_at=now()`.
- עד לפרסום — המתאמן לא רואה כלום חדש, גרסה קודמת שפורסמה (אם יש) ממשיכה להיות מוצגת לו.

### 4.6 מסך מתאמן (mobile-first)
- מסך "השבוע שלי": 7 כרטיסי יום, האימון של היום מודגש.
- מסך אימון בודד: רשימת תרגילים עם sets/reps/weight/RPE/rest/הנחיות, ולכל תרגיל אפשרות "סמן כבוצע" + טופס קצר לביצוע בפועל (משקל/חזרות בפועל, RPE בפועל, הערה).
- מסך היסטוריה: רשימת אימונים שבוצעו ב-30 הימים האחרונים.

---

## 5. שלבי עבודה (Milestones)

**שלב 0 – תשתית (יום 1-2)**
- Setup Next.js + TS + Tailwind + shadcn.
- חיבור Supabase (env vars, client), הגדרת סכימת DB + migrations + RLS.
- חיבור ל-Cloudflare (OpenNext adapter) + פייפליין deploy בסיסי.
- Auth בסיסי (login/logout, ניתוב לפי role).

**שלב 1 – ליבת נתונים (יום 2-4)**
- CRUD מתאמנים (רשימה + יצירה).
- Seed לספריית תרגילים (50-100) + הוספת custom + חיפוש.

**שלב 2 – Builder (יום 4-7)**
- מסך בניית תוכנית שבועית + ימים + אימונים.
- Flow builder: הוספה/גרירה/עריכה/מחיקה/שכפול של תרגילים בתוך אימון.
- Draft/Publish logic.

**שלב 3 – חוויית מתאמן (יום 7-9)**
- מסך שבועי + מסך אימון mobile-first.
- סימון "בוצע" + טופס ביצוע בסיסי.
- מסך היסטוריה (חודש אחורה).

**שלב 4 – ליטוש ו-QA (יום 9-10)**
- בדיקות RLS (שמתאמן לא רואה נתונים של מתאמן אחר).
- Responsive/mobile QA.
- הרצה מול המאמן (חבר שלך) לפידבק אמיתי.

> לוח הזמנים לעיל הוא הערכה גסה לעבודה ממוקדת — נעדכן בפועל לפי קצב.

---

## 6. מה **לא** בתוך ה-MVP (נשמר לעתיד, אבל התשתית לא תחסום אותו)

- Multi-tenant SaaS מלא (הרשמה עצמאית של מאמנים חדשים, billing, custom domain per מאמן).
- ריבוי אימונים ביום אחד / periodization מתקדם.
- וידאו/תמונות מצורפים לכל ביצוע (רק לתרגיל בספרייה).
- התראות push/תזכורות.
- אנליטיקס/גרפים להתקדמות.
- אפליקציית מובייל native (PWA אפשרי בהמשך קל, כי הכל mobile-first מהיום).

---

## 7. החלטות פתוחות שאשמח לתשובה עליהן לפני שמתחילים בקוד

1. **Stack**: Next.js על Cloudflare (OpenNext) — מאשר? או מעדיף חלופה?
2. **Auth**: אימייל+סיסמה מספיק ל-MVP, או שחשוב לך magic link/SMS כבר עכשיו?
3. **דומיין**: יש כבר דומיין לפרויקט, או שנעבוד על subdomain של Cloudflare Pages בינתיים?
4. **מיתוג ראשוני**: יש שם/לוגו/צבעים למאמן החבר שלך שכדאי להטמיע כבר ב-MVP, או ברירת מחדל ניטרלית מספיקה כרגע?

---

## סטטוס נוכחי
- [x] שלב 0 – תשתית
- [x] שלב 1 – ליבת נתונים
- [x] שלב 2 – Builder (הוספה/עריכה/מחיקה/שכפול/**גרירה אמיתית** (dnd-kit) + Draft/Publish; "אימון 1/2/..." ממוספרים במקום ימים, עד 10 לתוכנית)
- [x] שלב 3 – חוויית מתאמן (תוכנית שבועית מקושרת ללוח שנה אמיתי, סימון כל תרגיל בנפרד + הגשת אימון שלם עם תאריך/שעה, טופס ביצוע בסיסי (משקל/חזרות/RPE בפועל), מסך היסטוריה ל-30 יום, המאמן רואה שבוע נוכחי + שבועות עבר דרך "התוכנית השבועית")
  - עדכון (migration 0006): מאז שתוכניות משויכות לשבוע קלנדרי ספציפי, לכל שבוע יש `workouts` משלו — כך ש"הוגש/לא הוגש" כבר לא נדרס משבוע לשבוע כמו קודם. `workout_logs` עדיין המקום היחיד שצובר רצף זמן בתוך אותו שבוע (למשל, ביצוע חוזר של אותו תרגיל).
- [ ] שלב 4 – ליטוש ו-QA
