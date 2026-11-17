/**
 * Server-side glue for training blocks (migration 0017). Not a "use
 * server" module: helpers that take an already authenticated Supabase
 * client. The computation itself is in the database; these only decide
 * WHEN it's asked to run.
 */

import type { createClient } from "@/lib/supabase/server";
import { getWeekStart, israelNow, toDateKey } from "@/lib/week";

type Supabase = Awaited<ReturnType<typeof createClient>>;

/**
 * After something was logged on a workout: let the database re-derive the
 * later weeks of its block (a no-op when the workout isn't in one).
 * Callable as the workout's trainee or as the trainer. Never throws and
 * never fails the caller: the set itself is already saved, and anything
 * missed here is picked up by the next recompute (the weekly maintenance,
 * or the trainer's "חשב מחדש").
 */
export async function applyBlockProgression(supabase: Supabase, workoutId: string): Promise<void> {
  try {
    await supabase.rpc("apply_block_progression", { p_workout_id: workoutId });
  } catch {
    // see above
  }
}

/** The trainee's active blocks that haven't had this calendar week's maintenance yet. */
async function blocksDue(supabase: Supabase, traineeId: string): Promise<string[]> {
  try {
    const currentWeekKey = toDateKey(getWeekStart(israelNow()));
    const { data: blocks } = await supabase
      .from("blocks")
      .select("id, rolled_through")
      .eq("trainee_id", traineeId)
      .eq("status", "active")
      .is("deleted_at", null);
    return (blocks ?? []).filter((b) => !b.rolled_through || b.rolled_through < currentWeekKey).map((b) => b.id);
  } catch {
    return [];
  }
}

/**
 * Loads a page's data with the once-a-week maintenance of the trainee's
 * active blocks applied (see block_roll_forward in migration 0017: time
 * passing alone turns "projected" into "skipped", and it's where
 * auto-publish and auto-complete happen).
 *
 * The maintenance is due once a week per block, so waiting for its check
 * before every read would cost every page view a round trip for nothing.
 * Instead the check runs TOGETHER with `load`; only when something was
 * actually due is the maintenance run and `load` repeated, so what the
 * page shows is still always the up-to-date state. `load` must therefore
 * be a pure read, safe to run twice.
 *
 * `canRoll` = false for the read-only viewer, who may not run it (and gets
 * whatever the last run left). Maintenance never fails the page.
 */
export async function loadWithBlocksRolled<T>(
  supabase: Supabase,
  traineeId: string,
  canRoll: boolean | Promise<boolean>,
  load: () => Promise<T>,
): Promise<T> {
  const [due, data, allowed] = await Promise.all([blocksDue(supabase, traineeId), load(), canRoll]);
  if (!allowed || due.length === 0) return data;
  try {
    const results = await Promise.all(due.map((id) => supabase.rpc("block_roll_forward", { p_block_id: id })));
    if (results.every((r) => r.error)) return data;
  } catch {
    return data;
  }
  return load();
}
