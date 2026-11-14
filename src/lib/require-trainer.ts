import { createClient } from "@/lib/supabase/server";

/**
 * The signed-in user if — and only if — they are the trainer; otherwise
 * null. For Server Actions and pages that only make sense for the trainer
 * (the session screens, saved workouts): RLS is still what actually
 * protects the data, this just turns "RLS quietly returned nothing" into a
 * clear early answer. Note the read-only superadmin is NOT the trainer
 * (their role stays 'trainee', see migration 0011).
 */
export async function getTrainerContext() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .maybeSingle();
  if (profile?.role !== "trainer") return null;

  return { supabase, user };
}

export const NOT_TRAINER_ERROR = "אין הרשאה לבצע פעולה זו";
