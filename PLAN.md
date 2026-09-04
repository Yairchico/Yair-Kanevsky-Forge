# תוכנית פיתוח – אפליקציית אימונים למאמני כוח (MVP)

> מסמך זה הוא תוכנית עבודה חיה. נעדכן אותו ככל שנתקדם (סימון שלבים שהושלמו, שינוי החלטות).
> החזון: לבנות עכשיו אפליקציה פרטית עבור מאמן אחד, אבל **לעצב מהיום הראשון כך שיהיה קל למתג (white-label) ולמכור למאמנים נוספים** בלי לשכתב את הליבה.

---

## 0. עקרון מנחה: "Single-tenant UX, Multi-tenant DB"

כדי לא לשלם היום את המחיר של multi-tenant מלא (ניהול לקוחות, billing, custom domains) אבל גם לא להיתקע בעתיד:

- **הסכימה בדאטהבייס תיבנה כבר עכשיו סביב `organizations` (= "מותג/סטודיו של מאמן")**, גם אם כרגע יש רק ארגון אחד.
- כל מאמן שייך לארגון אחד. כל מתאמן שייך לארגון (דרך המאמן שלו).
- הרשאות (RLS ב-Supabase) ייכתבו לפי `org_id` מהיום הראשון — כך שהוספת ארגון שני (=מאמן נוסף עם חשבון נפרד) בעתיד היא **feature flag / רשומה חדשה**, לא refactor.
- הגדרות מיתוג (`branding`: לוגו, צבע ראשי, שם אפליקציה) יישבו בטבלת `organizations` מההתחלה, גם אם כרגע נשתמש רק בברירת מחדל אחת. זה מה שהופך את "המיתוג מחדש" למאוחר יותר לעניין של שינוי שורה בטבלה + בניית תהליך onboarding, לא build מחדש.
- פיצ'רים ספציפיים-למאמן (למשל: האם מוצג RPE, האם יש שדה "הנחיות וידאו" וכו') ייכתבו כ-**feature flags בטבלת organizations/settings**, לא כ-if מקודד בקוד.

זו ההשקעה היחידה ש"עולה" לנו כסף היום למען העתיד — כל השאר הוא MVP רזה לגמרי.

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
organizations            -- "המותג" של המאמן (לעתיד: מאמן נוסף = ארגון נוסף)
  id, name, branding_json, settings_json, created_at

profiles                 -- מרחיב את auth.users של Supabase
  id (=auth.users.id), org_id, role ('trainer' | 'trainee'), full_name, phone, avatar_url

trainer_trainee_links     -- קישור מאמן-מתאמן (מאפשר בעתיד כמה מאמנים לארגון)
  id, trainer_id, trainee_id, org_id, status ('active'|'archived'), created_at

exercises                -- ספריית תרגילים
  id, org_id (NULL = תרגיל גלובלי משותף לכולם, ערך = תרגיל custom של מאמן),
  name, muscle_group, equipment, instructions, media_url, is_custom, created_by

programs                 -- תוכנית שבועית של מתאמן
  id, org_id, trainee_id, created_by (trainer_id), title,
  status ('draft'|'published'), version, published_at, created_at, updated_at

program_days             -- ימים בתוכנית (יום א', יום ב'...)
  id, program_id, day_index, label (למשל "פלג גוף עליון")

workouts                 -- אימון בתוך יום (בד"כ 1, אבל תומך בכמה)
  id, program_day_id, order_index, title, notes

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
  - מאמן רואה/עורך רק נתונים של `org_id` שלו ושל מתאמנים המקושרים אליו.
  - מתאמן רואה רק את הנתונים שלו, ורק תוכניות עם `status='published'`.
  - טבלת `exercises`: תרגילים גלובליים (`org_id IS NULL`) נגישים לקריאה לכולם; תרגילי custom נגישים רק לארגון שיצר אותם.
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
- [ ] שלב 0 – תשתית
- [ ] שלב 1 – ליבת נתונים
- [ ] שלב 2 – Builder
- [ ] שלב 3 – חוויית מתאמן
- [ ] שלב 4 – ליטוש ו-QA
