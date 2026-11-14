"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { addDays, getWeekStart, toDateKey } from "@/lib/week";
import { SET_LOG_COLUMNS, toLoggedSet, type LoggedSet } from "@/lib/sets";

type Supabase = Awaited<ReturnType<typeof createClient>>;

const MAX_SET_INDEX = 30;

function revalidateTraineeAndTrainer() {
  revalidatePath("/trainee");
  revalidatePath("/trainee/workouts");
  revalidatePath("/trainee/history");
  revalidatePath("/trainer/trainees/[id]", "page");
}

// If the trainer removes this exact workout/exercise from a published
// program at the exact moment a trainee logs it, the write fails on the
// foreign key (code 23503), or RLS rejects it once the program is no longer
// published (42501). The trainee's typed values aren't lost either way:
// they're still in localStorage (src/lib/workout-draft.ts).
const STALE_WORKOUT_ERROR =
  "האימון עודכן על ידי המאמן בינתיים — רענן/י את הדף ונסה/י שוב";

/** 23503 = the row it points at is gone; 42501 = RLS says the program is no longer the trainee's published one. */
function isStaleError(code: string | undefined): boolean {
  return code === "23503" || code === "42501";
}

const LOCKED_WEEK_ERROR = "אפשר לעדכן רק אימונים מהשבוע הנוכחי ומהשבוע הקודם";

/**
 * A trainee can change what they logged only in the current week and the
 * one before it (QUESTIONS.md Q1.7) — enough to finish a late workout or
 * fix a typo, without quietly rewriting older history. Future weeks are
 * fine (doing a workout early).
 */
function isEditableWeek(weekStartDate: string): boolean {
  const previousWeekKey = toDateKey(addDays(getWeekStart(new Date()), -7));
  return weekStartDate >= previousWeekKey;
}

/**
 * Loads the program a workout_exercise belongs to, through RLS — so for a
 * trainee this only succeeds for their own published, non-deleted program.
 */
async function programForWorkoutExercise(
  supabase: Supabase,
  workoutExerciseId: string,
): Promise<{ workoutId: string; weekStartDate: string } | null> {
  const { data: we } = await supabase
    .from("workout_exercises")
    .select("workout_id")
    .eq("id", workoutExerciseId)
    .maybeSingle();
  if (!we) return null;
  const { data: workout } = await supabase
    .from("workouts")
    .select("program_id")
    .eq("id", we.workout_id)
    .maybeSingle();
  if (!workout) return null;
  const { data: program } = await supabase
    .from("programs")
    .select("week_start_date")
    .eq("id", workout.program_id)
    .maybeSingle();
  if (!program) return null;
  return { workoutId: we.workout_id, weekStartDate: program.week_start_date };
}

async function programForWorkout(
  supabase: Supabase,
  workoutId: string,
): Promise<{ weekStartDate: string } | null> {
  const { data: workout } = await supabase
    .from("workouts")
    .select("program_id")
    .eq("id", workoutId)
    .maybeSingle();
  if (!workout) return null;
  const { data: program } = await supabase
    .from("programs")
    .select("week_start_date")
    .eq("id", workout.program_id)
    .maybeSingle();
  return program ? { weekStartDate: program.week_start_date } : null;
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

/** One performed set, as typed. Numbers are already parsed client-side (src/lib/sets.ts) and re-checked here. */
export interface SetLogInput {
  weightKg: number | null;
  reps: number | null;
  rpe: number | null;
}

export interface LogSetResult {
  error?: string;
  log?: LoggedSet;
  /** True when this set completed every working set of the exercise, so it was marked done. */
  exerciseDone?: boolean;
}

function validateSetLogInput(input: SetLogInput): string | null {
  if (input.reps == null) return "יש למלא מספר חזרות";
  if (!Number.isInteger(input.reps) || input.reps < 0 || input.reps > 999) return "מספר חזרות לא תקין";
  if (input.weightKg != null && (!Number.isFinite(input.weightKg) || input.weightKg < 0 || input.weightKg >= 10000)) {
    return "משקל לא תקין";
  }
  if (input.rpe != null && (!Number.isFinite(input.rpe) || input.rpe < 1 || input.rpe > 10)) {
    return "RPE חייב להיות בין 1 ל-10";
  }
  return null;
}

/**
 * Saves one performed set the moment the trainee confirms it (✓) —
 * PLAN.md feature 1: each set is submitted on its own, rather than the
 * whole workout's numbers waiting for "הגש אימון". Upserted on
 * (workout_exercise_id, trainee_id, set_index), so re-confirming a set
 * after fixing a typo updates it in place. When this completes every
 * working (non-warm-up) set of the exercise, the exercise is marked done
 * too (Q1.3) — the manual "סמן כבוצע" toggle still exists for a trainee
 * who doesn't want to type numbers.
 */
export async function logSet(
  workoutExerciseId: string,
  setIndex: number,
  input: SetLogInput,
): Promise<LogSetResult> {
  if (!Number.isInteger(setIndex) || setIndex < 1 || setIndex > MAX_SET_INDEX) {
    return { error: "סט לא תקין" };
  }
  const validationError = validateSetLogInput(input);
  if (validationError) return { error: validationError };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "שגיאת התחברות" };

  const program = await programForWorkoutExercise(supabase, workoutExerciseId);
  if (!program) return { error: STALE_WORKOUT_ERROR };
  if (!isEditableWeek(program.weekStartDate)) return { error: LOCKED_WEEK_ERROR };

  const { data: plannedSets } = await supabase
    .from("workout_exercise_sets")
    .select("id, set_index, set_type")
    .eq("workout_exercise_id", workoutExerciseId);
  const planned = (plannedSets ?? []).find((s) => s.set_index === setIndex);

  const { data: row, error } = await supabase
    .from("set_logs")
    .upsert(
      {
        workout_exercise_id: workoutExerciseId,
        workout_exercise_set_id: planned?.id ?? null,
        trainee_id: user.id,
        set_index: setIndex,
        weight_kg: input.weightKg,
        reps: input.reps,
        rpe: input.rpe,
        status: "done",
        source: "trainee",
        logged_by: user.id,
        logged_at: new Date().toISOString(),
      },
      { onConflict: "workout_exercise_id,trainee_id,set_index" },
    )
    .select(SET_LOG_COLUMNS)
    .single();

  if (error || !row) {
    return {
      error: isStaleError(error?.code) ? STALE_WORKOUT_ERROR : "שגיאה בשמירת הסט",
    };
  }

  // Auto-done: every working set of the plan now has a log.
  let exerciseDone = false;
  const workingIndexes = (plannedSets ?? [])
    .filter((s) => s.set_type !== "warmup")
    .map((s) => s.set_index);
  if (workingIndexes.length > 0) {
    const { data: logged } = await supabase
      .from("set_logs")
      .select("set_index")
      .eq("workout_exercise_id", workoutExerciseId)
      .eq("trainee_id", user.id)
      .eq("status", "done");
    const loggedIndexes = new Set((logged ?? []).map((l) => l.set_index));
    if (workingIndexes.every((i) => loggedIndexes.has(i))) {
      await supabase
        .from("workout_exercise_completions")
        .upsert(
          { workout_exercise_id: workoutExerciseId, trainee_id: user.id },
          { onConflict: "workout_exercise_id,trainee_id" },
        );
      exerciseDone = true;
    }
  }

  revalidateTraineeAndTrainer();
  return { log: toLoggedSet(row), exerciseDone };
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
  if (!program) return { error: STALE_WORKOUT_ERROR };
  if (!isEditableWeek(program.weekStartDate)) return { error: LOCKED_WEEK_ERROR };

  const { error } = await supabase
    .from("set_logs")
    .delete()
    .eq("workout_exercise_id", workoutExerciseId)
    .eq("trainee_id", user.id)
    .eq("set_index", setIndex);
  if (error) return { error: "שגיאה בביטול הסט" };

  revalidateTraineeAndTrainer();
  return {};
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
 * logSet. What's left is the exercise-level note, still in workout_logs
 * (upserted on (workout_exercise_id, trainee_id), migration 0012), and the
 * workout_completions row that marks the submission itself.
 *
 * A cleared note is set to null rather than deleting the row, so an old
 * row's legacy actual_sets (from before migration 0013) is never lost.
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
  if (!program) return { error: STALE_WORKOUT_ERROR };
  if (!isEditableWeek(program.weekStartDate)) return { error: LOCKED_WEEK_ERROR };

  if (submitted) {
    for (const entry of notes) {
      if (entry.notes && entry.notes.length > 1000) {
        return { error: "ההערה ארוכה מדי" };
      }
    }

    const now = new Date().toISOString();
    const withNotes = notes.filter((n) => n.notes?.trim());
    const cleared = notes.filter((n) => !n.notes?.trim()).map((n) => n.workoutExerciseId);

    if (withNotes.length > 0) {
      const { error } = await supabase.from("workout_logs").upsert(
        withNotes.map((n) => ({
          workout_exercise_id: n.workoutExerciseId,
          trainee_id: user.id,
          performed_at: now,
          notes: n.notes!.trim(),
        })),
        { onConflict: "workout_exercise_id,trainee_id" },
      );
      if (error) {
        return { error: isStaleError(error.code) ? STALE_WORKOUT_ERROR : "שגיאה בשמירת ההערות" };
      }
    }

    if (cleared.length > 0) {
      await supabase
        .from("workout_logs")
        .update({ notes: null })
        .eq("trainee_id", user.id)
        .in("workout_exercise_id", cleared);
    }

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

  revalidateTraineeAndTrainer();
  return {};
}
