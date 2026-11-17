import { getRequestAuth } from "@/lib/viewer";

/**
 * The signed-in user if — and only if — they are the trainer; otherwise
 * null. For Server Actions and pages that only make sense for the trainer
 * (the session screens, saved workouts): RLS is still what actually
 * protects the data, this just turns "RLS quietly returned nothing" into a
 * clear early answer. Note the read-only superadmin is NOT the trainer
 * (their role stays 'trainee', see migration 0011).
 *
 * One wait (token verification and the profile row together, see
 * getRequestAuth) — it used to be two in a row.
 */
export async function getTrainerContext() {
  const { supabase, viewer } = await getRequestAuth();
  const me = await viewer;
  if (!me || me.role !== "trainer") return null;
  return { supabase, user: { id: me.id, email: me.email } };
}

export const NOT_TRAINER_ERROR = "אין הרשאה לבצע פעולה זו";
