import type { createClient } from "@/lib/supabase/server";

type Supabase = Awaited<ReturnType<typeof createClient>>;

/**
 * True for the read-only "superadmin" oversight account (profiles.is_
 * superadmin, migration 0011) — someone who shares the trainer's screens
 * but must never actually change anything. The real enforcement is RLS
 * (no INSERT/UPDATE/DELETE policy exists for is_superadmin() anywhere,
 * see the migration); every trainer page/component checks this purely so
 * it doesn't show a mutation control that would just fail.
 *
 * Safe to call with any signed-in user's own id — RLS already lets
 * everyone read their own profiles row regardless of role.
 */
export async function isReadOnlyViewer(supabase: Supabase, userId: string): Promise<boolean> {
  const { data } = await supabase
    .from("profiles")
    .select("is_superadmin")
    .eq("id", userId)
    .single();
  return data?.is_superadmin === true;
}
