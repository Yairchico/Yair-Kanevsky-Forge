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

/**
 * The once-a-week maintenance of a trainee's active blocks (see
 * block_roll_forward in the migration): run it for every block that hasn't
 * had it yet this calendar week. Called before a page reads a trainee's
 * programs — by the trainee's own screens and by the trainer's — so what's
 * read is already up to date. One cheap query when there's nothing to do.
 * The read-only viewer may not run it (and gets whatever the last run left).
 */
export async function rollForwardBlocks(supabase: Supabase, traineeId: string): Promise<void> {
  try {
    const currentWeekKey = toDateKey(getWeekStart(israelNow()));
    const { data: blocks } = await supabase
      .from("blocks")
      .select("id, rolled_through")
      .eq("trainee_id", traineeId)
      .eq("status", "active")
      .is("deleted_at", null);
    const due = (blocks ?? []).filter((b) => !b.rolled_through || b.rolled_through < currentWeekKey);
    await Promise.all(due.map((b) => supabase.rpc("block_roll_forward", { p_block_id: b.id })));
  } catch {
    // Maintenance only — never a reason not to show the page.
  }
}
