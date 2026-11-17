"use server";

import { revalidatePath } from "next/cache";
import { applyBlockProgression } from "@/lib/block-server";
import { createClient } from "@/lib/supabase/server";
import { addDays, getWeekStart, toDateKey, israelNow } from "@/lib/week";
import {
  STALE_WORKOUT_ERROR,
  deleteSetLog,
  isStaleError,
  programForWorkout,
  programForWorkoutExercise,
  saveExerciseNotes,
  saveSetLog,
  validateSetIndex,
  validateSetLogInput,
  type LogSetResult,
  type SetLogInput,
} from "@/lib/set-log-server";

function revalidateTraineeAndTrainer() {
  revalidatePath("/trainee");
  revalidatePath("/trainee/workouts");
  revalidatePath("/trainee/history");
  revalidatePath("/trainer/trainees/[id]", "page");
}

const LOCKED_WEEK_ERROR = "אפשר לעדכן רק אימונים מהשבוע הנוכחי ומהשבוע הקודם";

/**
 * A trainee can change what they logged only in the current week and the
 * one before it (QUESTIONS.md Q1.7) — enough to finish a late workout or
 * fix a typo, without quietly rewriting older history. Future weeks are
 * fine (doing a workout early).
 */
function isEditableWeek(weekStartDate: string): boolean {
  const previousWeekKey = toDateKey(addDays(getWeekStart(israelNow()), -7));
  return weekStartDate >= previousWeekKey;
}

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

  const program = await programForWorkoutExercise(supabase, workoutExerciseId);
  if (!program || !isEditableWeek(program.weekStartDate)) return;

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

  revalidateTraineeAndTrainer();
}

/**
 * Saves one performed set the moment the trainee confirms it (✓) —
 * PLAN.md feature 1: each set is submitted on its own, rather than the
 * whole workout's numbers waiting for "הגש אימון". When this completes
 * every working (non-warm-up) set of the exercise, the exercise is marked
 * done too (Q1.3) — the manual "סמן כבוצע" toggle still exists for a trainee
 * who doesn't want to type numbers.
 */
export async function logSet(
  workoutExerciseId: string,
  setIndex: number,
  input: SetLogInput,
): Promise<LogSetResult> {
  const validationError = validateSetIndex(setIndex) ?? validateSetLogInput(input);
  if (validationError) return { error: validationError };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "שגיאת התחברות" };

  // Through RLS: resolves only for the trainee's own published program.
  const program = await programForWorkoutExercise(supabase, workoutExerciseId);
  if (!program || program.traineeId !== user.id) return { error: STALE_WORKOUT_ERROR };
  if (!isEditableWeek(program.weekStartDate)) return { error: LOCKED_WEEK_ERROR };

  const result = await saveSetLog(supabase, { workoutExerciseId, setIndex, input, traineeId: user.id });
  if (!result.error) {
    // In a training block, what was just logged can change next week's targets.
    if (program.blockId) await applyBlockProgression(supabase, program.workoutId);
    revalidateTraineeAndTrainer();
  }
  return result;
}

/** Un-confirms a set (the trainee tapped ✓ again). Doesn't touch the exercise's "done" mark. */
export async function unlogSet(
  workoutExerciseId: string,
  setIndex: number,
): Promise<{ error?: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "שגיאת התחברות" };

  const program = await programForWorkoutExercise(supabase, workoutExerciseId);
  if (!program || program.traineeId !== user.id) return { error: STALE_WORKOUT_ERROR };
  if (!isEditableWeek(program.weekStartDate)) return { error: LOCKED_WEEK_ERROR };

  const result = await deleteSetLog(supabase, { workoutExerciseId, setIndex, traineeId: user.id });
  if (!result.error) {
    if (program.blockId) await applyBlockProgression(supabase, program.workoutId);
    revalidateTraineeAndTrainer();
  }
  return result;
}

/** A per-exercise note, sent with the workout submission. */
export interface ExerciseNoteEntry {
  workoutExerciseId: string;
  notes: string | null;
}

export interface SubmitWorkoutState {
  error?: string;
}

/**
 * Marks the whole workout as submitted (or un-submits it). The numbers are
 * no longer part of this: every set was already saved on its own by
 * logSet. What's left is the exercise-level note (workout_logs) and the
 * workout_completions row that marks the submission itself.
 *
 * Un-submitting only removes workout_completions — logged sets stay.
 */
export async function submitWorkout(
  workoutId: string,
  submitted: boolean,
  notes: ExerciseNoteEntry[] = [],
): Promise<SubmitWorkoutState> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "שגיאת התחברות" };

  const program = await programForWorkout(supabase, workoutId);
  if (!program || program.traineeId !== user.id) return { error: STALE_WORKOUT_ERROR };
  if (!isEditableWeek(program.weekStartDate)) return { error: LOCKED_WEEK_ERROR };

  if (submitted) {
    const notesResult = await saveExerciseNotes(supabase, user.id, notes);
    if (notesResult.error) return { error: notesResult.error };

    const { error: completionError } = await supabase
      .from("workout_completions")
      .upsert(
        { workout_id: workoutId, trainee_id: user.id },
        { onConflict: "workout_id,trainee_id" },
      );
    if (completionError) {
      return {
        error: isStaleError(completionError.code) ? STALE_WORKOUT_ERROR : "שגיאה בהגשת האימון",
      };
    }
  } else {
    await supabase
      .from("workout_completions")
      .delete()
      .eq("workout_id", workoutId)
      .eq("trainee_id", user.id);
  }

  // Submitting settles what was (and wasn't) done; un-submitting reopens it.
  if (program.blockId) await applyBlockProgression(supabase, workoutId);
  revalidateTraineeAndTrainer();
  return {};
}
