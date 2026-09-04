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
5. חשבונות מתאמנים ייווצרו בהמשך דרך מסך "יצירת מתאמן" באזור המאמן (שלב 1 בתוכנית) — כרגע אפשר גם ליצור ידנית באותה מסך Add user, בלי `role` במטה-דאטה (ברירת המחדל `trainee`).

## Deploy ל-Cloudflare (חד פעמי)

1. `npx wrangler login` (מתחבר לחשבון Cloudflare).
2. עדכנו את `wrangler.jsonc` אם רוצים שם worker אחר מ-`trainer-app`.
3. **חשוב:** משתני הסביבה (Supabase) חייבים להיות מוגדרים גם כ-secrets בקלאודפלייר, לא רק ב-`.env.local`:
   ```bash
   npx wrangler secret put NEXT_PUBLIC_SUPABASE_URL
   npx wrangler secret put NEXT_PUBLIC_SUPABASE_ANON_KEY
   npx wrangler secret put SUPABASE_SERVICE_ROLE_KEY
   ```
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
src/app/                 מסכים (App Router): /login, /trainer, /trainee
src/lib/supabase/        Supabase clients (browser/server/middleware) + types
src/proxy.ts               רענון session + ניתוב לפי role (Next.js "Proxy" — לשעבר middleware)
supabase/migrations/      סכימת DB + RLS
PLAN.md                   תוכנית הפיתוח המלאה
```
