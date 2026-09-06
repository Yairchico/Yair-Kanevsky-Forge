# אפליקציית אימונים – Trainer App

אפליקציית אימונים למאמן כוח יחיד (superadmin) ולמתאמנים שלו. ראו [`PLAN.md`](./PLAN.md) לתוכנית המלאה, מודל הנתונים והשלבים.

**Stack:** Next.js 16 (App Router) + TypeScript + Tailwind · Supabase (Postgres + Auth + RLS) · Cloudflare Workers (דרך [OpenNext](https://opennext.js.org/cloudflare)).

## הרצה מקומית

```bash
npm install
cp .env.example .env.local   # ולמלא את הערכים (ראו "הקמת Supabase" למטה)
npm run dev
```

האפליקציה עולה על http://localhost:3000. גולש לא מחובר מנותב אוטומטית ל-`/login`; לאחר התחברות מנותב ל-`/trainer` או `/trainee` לפי תפקיד (`profiles.role`).

## הקמת Supabase (חד פעמי)

1. צרו פרויקט חדש ב-[supabase.com](https://supabase.com) (או השתמשו ב-Supabase CLI מקומית).
2. הריצו את המיגרציה שבתיקייה `supabase/migrations/0001_init.sql` על הפרויקט:
   - דרך ה-CLI: `supabase link --project-ref <ref>` ואז `supabase db push`, **או**
   - להדביק את תוכן הקובץ ידנית ב-SQL Editor בדשבורד של Supabase.
3. מ-Project Settings → API, מלאו ב-`.env.local` (ראו `.env.example`):
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - `SUPABASE_SERVICE_ROLE_KEY` (לשימוש עתידי ביצירת מתאמנים מצד שרת בלבד — **לא** לחשוף לדפדפן)
4. **יצירת חשבון המאמן (היחיד)**: ב-Authentication → Users → Add user, וב-"User Metadata" הוסיפו:
   ```json
   { "role": "trainer", "full_name": "השם של המאמן" }
   ```
   הטריגר `handle_new_user` (במיגרציה) ייצור אוטומטית שורת `profiles` עם `role='trainer'`. משתמשים חדשים בלי `role` במטה-דאטה ייחשבו כברירת מחדל ל-`trainee`.
5. חשבונות מתאמנים נוצרים דרך מסך "מתאמן חדש" באזור המאמן (`/trainer/trainees/new`) — זה משתמש ב-`SUPABASE_SERVICE_ROLE_KEY` (שלב 3) כדי ליצור את חשבון ה-auth של המתאמן, לכן חשוב שהמפתח הזה יהיה מוגדר גם ב-Cloudflare (ראו "Deploy" למטה), לא רק מקומית.
6. **עדכון סכימה + ספריית תרגילים** (חד פעמי, אחרי המיגרציה הראשונית): ב-SQL Editor, הריצו בסדר הזה:
   1. `supabase/migrations/0002_profiles_email_and_exercise_uniqueness.sql` — מוסיף `email` לפרופילים ומכין את `exercises` לזריעה בטוחה (idempotent).
   2. `supabase/migrations/0003_prevent_role_self_escalation.sql` — תיקון אבטחה (חוסם מתאמן מלשנות role של עצמו).
   3. `supabase/migrations/0004_username_login.sql` — **חשוב**: מוסיף `username` ומעביר את ההתחברות מאימייל לשם משתמש (ראו קופסת האזהרה למטה).
   4. `supabase/migrations/0005_exercise_completions.sql` — מוסיף טבלת `workout_exercise_completions` (סימון "בוצע" לכל תרגיל בנפרד, בנוסף להגשת האימון השלם).
   5. `supabase/migrations/0006_calendar_weeks_and_numbered_workouts.sql` — **שינוי מבנה**: תוכניות משויכות עכשיו לשבוע קלנדרי אמיתי (`week_start_date`), ואימונים הם "אימון 1/2/..." ממוספרים ישירות תחת התוכנית (לא יותר לפי יום) — עד 10 לתוכנית. מוחקת את טבלת `program_days` (המידע עובר אוטומטית ל-`workouts.program_id`).
   6. `supabase/migrations/0007_required_fields_and_ranges.sql` — סטים וחזרות הופכים לשדות חובה בכל תרגיל בתוכנית (עם השלמה אוטומטית לשורות ישנות שהיו חסרות), ו-RPE (מתוכנן ובפועל) מוגבל ל-1–10 ברמת ה-DB בנוסף לאימות בשרת.
   7. `supabase/migrations/0008_exercise_images_storage.sql` — יוצרת bucket ציבורי בשם `exercise-images` (Storage) להעלאת תמונות תרגיל מצד המאמן, עם מדיניות RLS: קריאה לכולם, כתיבה רק למאמן.
   8. `supabase/migrations/0009_workout_days.sql` — אימונים משויכים עכשיו ליום בשבוע (`day_of_week`, ראשון-שבת), עד 2 אימונים ביום (במקום המגבלה הישנה של עד 10 בתוכנית).
   9. `supabase/seed.sql` — מכניס ~58 תרגילי בסיס לספרייה (שמות באנגלית, קבוצת שריר בעברית). אפשר להריץ שוב בעתיד בלי סיכון לכפילויות (`ON CONFLICT DO NOTHING`). אם כבר הרצתם גרסה ישנה עם שמות עבריים — יש הערת ניקוי בראש הקובץ.

   > ⚠️ **אחרי migration 0004 ההתחברות היא לפי שם משתמש, לא אימייל.** המיגרציה מייצרת `username` אוטומטית לכל המשתמשים הקיימים (כולל המאמן) מהחלק הראשון של כתובת האימייל שלהם. כדי לדעת מה שם המשתמש שלך: ב-SQL Editor הריצו `select username from public.profiles where role = 'trainer';`.

## Deploy ל-Cloudflare

### דרך GitHub Actions (מומלץ — לא דורש טרמינל אחרי ההגדרה החד-פעמית)

**שני Workers נפרדים, בכוונה:** `yair-kanevsky-forge` (production — האתר
האמיתי שבשימוש) ו-`yair-kanevsky-forge-staging` (עותק זהה, לבדיקה/תצוגה
מקדימה). מאז שהאתר ה-production בשימוש בפועל, כל push **לא** נוגע בו יותר
— רק ב-staging:

- `.github/workflows/deploy.yml` — רץ **אוטומטית בכל push**, בונה ופורס
  ל-**staging בלבד** (`--env staging`). זה המקום לבדוק שינוי חדש.
- `.github/workflows/deploy-production.yml` — **ידני בלבד** (אף פעם לא
  רץ לבד על push). מריצים אותו במכוון כדי "לקדם" גרסה שנבדקה ל-production
  — מטאב Actions בגיטהאב ("Run workflow"), או שמבקשים ממני.

שני ה-workflows מגדירים מחדש את כל ה-secrets ב-Worker המתאים
(`wrangler secret put`) **בכל פריסה** — נוצר בגלל ש-Cloudflare's own
"Variables and Secrets" בדשבורד לא תמיד מגיע בפועל ל-`env` של ה-Worker
בזמן ריצה (`SUPABASE_SERVICE_ROLE_KEY` המשיך להיראות "חסר" למרות שהיה
מוגדר שם). כשה-workflow הוא מקור האמת, אין תלות בניווט בדשבורד.

**הגדרה חד-פעמית** — ב-GitHub, בריפו הזה: Settings → Secrets and
variables → Actions → New repository secret, עבור כל אחד מאלה (משותפים
לשני ה-workflows, אותם ערכים בדיוק — staging ו-production חולקים את אותו
פרויקט Supabase, רק קוד שונה):
- `CLOUDFLARE_API_TOKEN` — מ-dash.cloudflare.com → האייקון של הפרופיל →
  My Profile → API Tokens → Create Token → תבנית "Edit Cloudflare Workers".
- `CLOUDFLARE_ACCOUNT_ID` — מופיע בדף הבית של Workers & Pages בדשבורד.
- `SUPABASE_SERVICE_ROLE_KEY`, `NEXT_PUBLIC_SUPABASE_URL`,
  `NEXT_PUBLIC_SUPABASE_ANON_KEY` — מ-Supabase Project Settings → API.

אם ה-Worker מחובר גם ל-Git דרך "Workers Builds" של Cloudflare עצמה (rebuild
אוטומטי מהדשבורד) — כדאי לכבות את זה (הדשבורד → ה-Worker → Settings →
Build) כדי שלא יתחרו שני פריסות אוטומטיות זו בזו.

כתובת ה-staging: `yair-kanevsky-forge-staging.<אותו subdomain של ה-production>.workers.dev`.

### דרך CLI מקומי (אם יש גישה לטרמינל)

1. `npx wrangler login` (מתחבר לחשבון Cloudflare).
2. עדכנו את `wrangler.jsonc` אם רוצים שם worker אחר מ-`yair-kanevsky-forge`.
3. **חשוב:** משתני הסביבה (Supabase) חייבים להיות מוגדרים גם כ-secrets בקלאודפלייר, לא רק ב-`.env.local`:
   ```bash
   npx wrangler secret put NEXT_PUBLIC_SUPABASE_URL
   npx wrangler secret put NEXT_PUBLIC_SUPABASE_ANON_KEY
   npx wrangler secret put SUPABASE_SERVICE_ROLE_KEY
   ```
   (`wrangler secret put` הוא הדרך האמינה — היא מחברת את הערך ישירות ל-Worker בלי תלות בניווט בדשבורד. `NEXT_PUBLIC_*` צריכים להיות זמינים כבר בזמן ה-**build**, לא רק ב-runtime — Next.js צורב אותם לקוד ה-JS.)
4. בנייה + פריסה:
   ```bash
   npm run cf:deploy
   ```
5. לתצוגה מקדימה מקומית של ה-build שרץ על Cloudflare runtime (עם bindings אמיתיים):
   ```bash
   cp .dev.vars.example .dev.vars   # ולמלא ערכים
   npm run cf:preview
   ```

## מבנה הפרויקט

```
src/app/                        מסכים (App Router): /login, /trainer (+trainees, +exercises), /trainee
src/components/ui/              קומפוננטות UI בסיסיות (Button, Card, Input, Label, Select, Textarea)
src/components/                 Brand, AppShell, SignOutButton
src/lib/supabase/               Supabase clients (browser/server/admin) + types
src/lib/constants.ts            שם האפליקציה (APP_NAME)
src/proxy.ts                    רענון session + ניתוב לפי role (Next.js "Proxy" — לשעבר middleware)
supabase/migrations/            סכימת DB + RLS
supabase/seed.sql               ספריית תרגילי הבסיס
PLAN.md                         תוכנית הפיתוח המלאה
```
