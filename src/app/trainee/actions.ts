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
  revalidatePath("/trainer/trainees/[id]", "page");
}

export interface LoggedPerformance {
  weight: string | null;
  reps: string | null;
  rpe: number | null;
  notes: string | null;
  performedAt: string;
}

/** One exercise's typed-but-unsaved entry, held client-side until the whole workout is submitted. */
export interface PerformanceEntry {
  workoutExerciseId: string;
  weight: string | null;
  reps: string | null;
  rpe: number | null;
  notes: string | null;
}

export interface SubmitWorkoutState {
  error?: string;
}

function hasAnyValue(entry: PerformanceEntry): boolean {
  return Boolean(entry.weight || entry.reps || entry.rpe != null || entry.notes);
}

// If the trainer removes this exact workout/exercise from a published
// program at the exact moment a trainee submits it, the insert/upsert
// below fails on the foreign key (the row it points to is gone) — code
// 23503, same as the FK-restrict case in exercises' deleteExercise. The
// trainee's typed values are never actually lost either way: they're
// already sitting in localStorage (src/lib/workout-draft.ts) regardless
// of whether this submit succeeds, so this only needs an honest message,
// not any data-recovery logic.
const STALE_WORKOUT_ERROR =
  "האימון עודכן על ידי המאמן בינתיים — רענן/י את הדף ונסה/י שוב";

/**
 * Submits the whole workout at once — there's no more per-exercise "save":
 * whatever the trainee typed into each exercise's fields (held client-side
 * as a draft, see src/lib/workout-draft.ts, so it survives a closed tab)
 * becomes one workout_logs row per exercise that has anything in it.
 * Upserted on (workout_exercise_id, trainee_id) — migration 0012 — rather
 * than always inserting: since workout_exercises are already scoped to one
 * specific week's workout, this naturally keeps exactly one log per
 * exercise per week's occurrence (one history entry, not a growing pile —
 * a trainee toggling "הגש אימון" off/on, or resubmitting after fixing a
 * typo, used to insert a fresh duplicate row every time, which is what
 * showed up as repeats on the history page). An exercise that had a
 * logged value before but is empty on this submit (the trainee cleared
 * it) gets its old log explicitly deleted — upsert alone only touches
 * rows present in this submit's payload, so a cleared field would
 * otherwise leave a stale log behind. Un-submitting (to fix a mistake)
 * only removes the workout_completions row; it doesn't touch logs, so
 * re-submitting without changing anything just re-upserts the same values.
 */
export async function submitWorkout(
  workoutId: string,
  submitted: boolean,
  entries: PerformanceEntry[] = [],
): Promise<SubmitWorkoutState> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "שגיאת התחברות" };

  if (submitted) {
    // Real validation, not just the input's min/max hint — a value outside
    // 1-10 must not be allowed to save at all.
    for (const entry of entries) {
      if (entry.rpe != null && (Number.isNaN(entry.rpe) || entry.rpe < 1 || entry.rpe > 10)) {
        return { error: "RPE חייב להיות בין 1 ל-10" };
      }
    }

    const now = new Date().toISOString();
    const rows = entries.filter(hasAnyValue).map((entry) => ({
      workout_exercise_id: entry.workoutExerciseId,
      trainee_id: user.id,
      performed_at: now,
      actual_sets: { weight: entry.weight, reps: entry.reps },
      rpe_actual: entry.rpe,
      notes: entry.notes,
    }));
    const clearedWorkoutExerciseIds = entries
      .filter((entry) => !hasAnyValue(entry))
      .map((entry) => entry.workoutExerciseId);

    if (clearedWorkoutExerciseIds.length > 0) {
      await supabase
        .from("workout_logs")
        .delete()
        .eq("trainee_id", user.id)
        .in("workout_exercise_id", clearedWorkoutExerciseIds);
    }

    if (rows.length > 0) {
      const { error } = await supabase
        .from("workout_logs")
        .upsert(rows, { onConflict: "workout_exercise_id,trainee_id" });
      if (error) {
        return { error: error.code === "23503" ? STALE_WORKOUT_ERROR : "שגיאה בשמירת הביצוע" };
      }
    }

    const { error: completionError } = await supabase
      .from("workout_completions")
      .upsert(
        { workout_id: workoutId, trainee_id: user.id },
        { onConflict: "workout_id,trainee_id" },
      );
    if (completionError) {
      return {
        error: completionError.code === "23503" ? STALE_WORKOUT_ERROR : "שגיאה בהגשת האימון",
      };
    }
  } else {
    await supabase
      .from("workout_completions")
      .delete()
      .eq("workout_id", workoutId)
      .eq("trainee_id", user.id);
  }

  revalidatePath("/trainee");
  revalidatePath("/trainer/trainees/[id]", "page");
  return {};
}
