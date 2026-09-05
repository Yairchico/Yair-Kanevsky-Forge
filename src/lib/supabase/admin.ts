import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/types";

/**
 * Service-role Supabase client — bypasses RLS entirely. Server-only:
 * never import this from a Client Component, and never let
 * SUPABASE_SERVICE_ROLE_KEY reach the browser.
 *
 * Used for privileged operations the trainer's own (RLS-scoped) session
 * can't do on its own, like creating a trainee's auth user. Callers are
 * responsible for checking the caller is actually the trainer first.
 */
export function createAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  // supabase-js throws synchronously (an uncaught exception, not a normal
  // {error} result) if either is missing/invalid — which previously meant
  // a raw Cloudflare "server error" crash page instead of a message a
  // trainer could act on. A clear, named error at least turns that into
  // something callers can catch and explain (see trainees/actions.ts).
  if (!url || !key) {
    const missing = [!url && "NEXT_PUBLIC_SUPABASE_URL", !key && "SUPABASE_SERVICE_ROLE_KEY"]
      .filter(Boolean)
      .join(", ");
    // Diagnostic only — names, never values. If this keeps happening despite
    // the Cloudflare dashboard showing the variable configured, this shows
    // exactly what name(s) process.env actually received at runtime (a typo,
    // a stray space, or wrong casing in the dashboard's "Variable name"
    // field all look "configured" there but produce a different key here) —
    // and whether OpenNext's own env-population step (populateProcessEnv,
    // which always sets OPEN_NEXT_ORIGIN once it runs) ran here at all.
    const allKeys = Object.keys(process.env);
    const foundSupabaseKeys = allKeys.filter((k) => /supabase/i.test(k));
    throw new Error(
      `חסר משתנה סביבה בשרת: ${missing}. יש להגדיר אותו כ-secret בקלאודפלייר ולפרוס מחדש. ` +
        `(משתני סביבה שכן נמצאו בזמן ריצה: ${foundSupabaseKeys.length ? foundSupabaseKeys.join(", ") : "אף אחד"}; ` +
        `סה"כ ${allKeys.length} משתנים; OPEN_NEXT_ORIGIN קיים: ${allKeys.includes("OPEN_NEXT_ORIGIN") ? "כן" : "לא"})`,
    );
  }

  return createSupabaseClient<Database>(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
