/**
 * Server-side pieces shared by everything that records a performed set of
 * a weekly-plan workout: the trainee's own actions
 * (src/app/trainee/actions.ts) and the trainer-led session
 * (src/app/trainer/session/actions.ts). Same table, same rules — the only
 * difference between the two callers is whose behalf the set is logged on
 * and which checks come first.
 *
 * Not a "use server" module: these are helpers that take an already
 * authenticated Supabase client, not endpoints.
 */

import type { createClient } from "@/lib/supabase/server";
import { SET_LOG_COLUMNS, toLoggedSet, type LoggedSet } from "@/lib/sets";

type Supabase = Awaited<ReturnType<typeof createClient>>;

export const MAX_SET_INDEX = 30;

// If the trainer removes this exact workout/exercise from a published
// program at the exact moment someone logs it, the write fails on the
// foreign key (23503), or RLS rejects it once the program is no longer the
// trainee's published one (42501). Typed values aren't lost either way:
// they're still in localStorage (src/lib/workout-draft.ts).
export const STALE_WORKOUT_ERROR =
  "האימון עודכן על ידי המאמן בינתיים — רענן/י את הדף ונסה/י שוב";

export function isStaleError(code: string | undefined): boolean {
  return code === "23503" || code === "42501";
}

/** One performed set, as typed. Parsed client-side (src/lib/sets.ts) and re-checked here. */
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

export function validateSetIndex(setIndex: number): string | null {
  return Number.isInteger(setIndex) && setIndex >= 1 && setIndex <= MAX_SET_INDEX ? null : "סט לא תקין";
}

export function validateSetLogInput(input: SetLogInput): string | null {
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

export interface ProgramRef {
  workoutId: string;
  programId: string;
  traineeId: string;
  weekStartDate: string;
  status: "draft" | "published";
  deletedAt: string | null;
  /** The training block this week belongs to, if any (migration 0017). */
  blockId: string | null;
}

/**
 * The program a workout belongs to — read through the caller's RLS, so for
 * a trainee this only resolves for their own published, non-deleted program.
 */
export async function programForWorkout(supabase: Supabase, workoutId: string): Promise<ProgramRef | null> {
  const { data: workout } = await supabase
    .from("workouts")
    .select("program_id")
    .eq("id", workoutId)
    .maybeSingle();
  if (!workout) return null;
  const { data: program } = await supabase
    .from("programs")
    .select("id, trainee_id, week_start_date, status, deleted_at, block_id")
    .eq("id", workout.program_id)
    .maybeSingle();
  if (!program) return null;
  return {
    workoutId,
    programId: program.id,
    traineeId: program.trainee_id,
    weekStartDate: program.week_start_date,
    status: program.status,
    deletedAt: program.deleted_at,
    blockId: program.block_id,
  };
}

export async function programForWorkoutExercise(
  supabase: Supabase,
  workoutExerciseId: string,
): Promise<ProgramRef | null> {
  const { data: we } = await supabase
    .from("workout_exercises")
    .select("workout_id")
    .eq("id", workoutExerciseId)
    .maybeSingle();
  if (!we) return null;
  return programForWorkout(supabase, we.workout_id);
}

/**
 * Upserts one performed set on (workout_exercise_id, trainee_id, set_index)
 * — confirming a set again after fixing a typo updates it in place — and,
 * when that completes every working (non-warm-up) set of the exercise's
 * plan, marks the exercise done too. Who logged it (`logged_by`, `source`)
 * is filled in by a DB trigger from the session, not passed in.
 */
export async function saveSetLog(
  supabase: Supabase,
  args: { workoutExerciseId: string; setIndex: number; input: SetLogInput; traineeId: string },
): Promise<LogSetResult> {
  const { workoutExerciseId, setIndex, input, traineeId } = args;

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
        trainee_id: traineeId,
        set_index: setIndex,
        weight_kg: input.weightKg,
        reps: input.reps,
        rpe: input.rpe,
        status: "done",
        logged_at: new Date().toISOString(),
      },
      { onConflict: "workout_exercise_id,trainee_id,set_index" },
    )
    .select(SET_LOG_COLUMNS)
    .single();

  if (error || !row) {
    return { error: isStaleError(error?.code) ? STALE_WORKOUT_ERROR : "שגיאה בשמירת הסט" };
  }

  let exerciseDone = false;
  const workingIndexes = (plannedSets ?? [])
    .filter((s) => s.set_type !== "warmup")
    .map((s) => s.set_index);
  if (workingIndexes.length > 0) {
    const { data: logged } = await supabase
      .from("set_logs")
      .select("set_index")
      .eq("workout_exercise_id", workoutExerciseId)
      .eq("trainee_id", traineeId)
      .eq("status", "done");
    const loggedIndexes = new Set((logged ?? []).map((l) => l.set_index));
    if (workingIndexes.every((i) => loggedIndexes.has(i))) {
      await supabase
        .from("workout_exercise_completions")
        .upsert(
          { workout_exercise_id: workoutExerciseId, trainee_id: traineeId },
          { onConflict: "workout_exercise_id,trainee_id" },
        );
      exerciseDone = true;
    }
  }

  return { log: toLoggedSet(row), exerciseDone };
}

/** Removes one performed set. Doesn't touch the exercise's "done" mark. */
export async function deleteSetLog(
  supabase: Supabase,
  args: { workoutExerciseId: string; setIndex: number; traineeId: string },
): Promise<{ error?: string }> {
  const { error } = await supabase
    .from("set_logs")
    .delete()
    .eq("workout_exercise_id", args.workoutExerciseId)
    .eq("trainee_id", args.traineeId)
    .eq("set_index", args.setIndex);
  return error ? { error: "שגיאה בביטול הסט" } : {};
}

/**
 * Writes the per-exercise notes of a workout (workout_logs, one row per
 * exercise per trainee — migration 0012). A cleared note is set to null
 * rather than deleting the row, so an old row's legacy actual_sets (from
 * before migration 0013) is never lost.
 */
export async function saveExerciseNotes(
  supabase: Supabase,
  traineeId: string,
  notes: { workoutExerciseId: string; notes: string | null }[],
): Promise<{ error?: string }> {
  for (const entry of notes) {
    if (entry.notes && entry.notes.length > 1000) return { error: "ההערה ארוכה מדי" };
  }
  const now = new Date().toISOString();
  const withNotes = notes.filter((n) => n.notes?.trim());
  const cleared = notes.filter((n) => !n.notes?.trim()).map((n) => n.workoutExerciseId);

  if (withNotes.length > 0) {
    const { error } = await supabase.from("workout_logs").upsert(
      withNotes.map((n) => ({
        workout_exercise_id: n.workoutExerciseId,
        trainee_id: traineeId,
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
      .eq("trainee_id", traineeId)
      .in("workout_exercise_id", cleared);
  }
  return {};
}
