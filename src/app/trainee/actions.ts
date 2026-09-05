"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

/** Marks (or unmarks) a single exercise as done — independent of submitting the workout. */
export async function toggleExerciseCompletion(
  workoutExerciseId: string,
  completed: boolean,
) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return;

  if (completed) {
    await supabase
      .from("workout_exercise_completions")
      .upsert(
        { workout_exercise_id: workoutExerciseId, trainee_id: user.id },
        { onConflict: "workout_exercise_id,trainee_id" },
      );
  } else {
    await supabase
      .from("workout_exercise_completions")
      .delete()
      .eq("workout_exercise_id", workoutExerciseId)
      .eq("trainee_id", user.id);
  }

  revalidatePath("/trainee");
}

export interface LogPerformanceState {
  error?: string;
  success?: boolean;
}

/**
 * Basic performance entry: what the trainee actually did, vs. what the
 * exercise called for. Always inserts a new row (not an upsert) — unlike
 * the completion checkbox, this is meant to build up history over time as
 * the same exercise recurs week to week.
 */
export async function logExercisePerformance(
  workoutExerciseId: string,
  _prevState: LogPerformanceState,
  formData: FormData,
): Promise<LogPerformanceState> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "שגיאת התחברות" };

  const actualWeight = String(formData.get("actual_weight") ?? "").trim();
  const actualReps = String(formData.get("actual_reps") ?? "").trim();
  const rpeRaw = String(formData.get("rpe_actual") ?? "").trim();
  const notes = String(formData.get("notes") ?? "").trim();

  const { error } = await supabase.from("workout_logs").insert({
    workout_exercise_id: workoutExerciseId,
    trainee_id: user.id,
    actual_sets: { weight: actualWeight || null, reps: actualReps || null },
    rpe_actual: rpeRaw ? Number(rpeRaw) : null,
    notes: notes || null,
  });

  if (error) {
    return { error: "שגיאה בשמירת הביצוע" };
  }

  revalidatePath("/trainee");
  return { success: true };
}

/** Submits the whole workout — the trainer sees this as "הוגש". */
export async function submitWorkout(workoutId: string, submitted: boolean) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return;

  if (submitted) {
    await supabase
      .from("workout_completions")
      .upsert(
        { workout_id: workoutId, trainee_id: user.id },
        { onConflict: "workout_id,trainee_id" },
      );
  } else {
    await supabase
      .from("workout_completions")
      .delete()
      .eq("workout_id", workoutId)
      .eq("trainee_id", user.id);
  }

  revalidatePath("/trainee");
}
