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
  return createSupabaseClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );
}
