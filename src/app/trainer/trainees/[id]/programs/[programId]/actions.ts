"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

export interface WorkoutExerciseFields {
  sets: number | null;
  reps: string | null;
  weight: string | null;
  rpe: number | null;
  rest_seconds: number | null;
  instructions: string | null;
}

export interface WorkoutExerciseRow extends WorkoutExerciseFields {
  id: string;
  workout_id: string;
  exercise_id: string;
  order_index: number;
}

export interface ActionResult {
  error?: string;
  row?: WorkoutExerciseRow;
  /** True when this edit just reverted a published program back to draft. */
  revertedToDraft?: boolean;
}

export interface WorkoutResult {
  error?: string;
  workout?: { id: string; order_index: number; day_of_week: number };
}

const MAX_WORKOUTS_PER_DAY = 2;

/**
 * Real validation, not just the inputs' HTML min/max hints: sets and reps
 * are required (a row with neither is meaningless), and RPE — when given —
 * must be within 1-10. Mirrored by DB check constraints (migration 0007)
 * as a backstop, but rejecting here first means a friendly Hebrew message
 * instead of a raw Postgres error.
 */
function validateWorkoutExerciseFields(fields: WorkoutExerciseFields): string | null {
  if (fields.sets == null || fields.sets <= 0) {
    return "יש למלא מספר סטים";
  }
  if (!fields.reps || !fields.reps.trim()) {
    return "יש למלא מספר חזרות";
  }
  if (fields.rpe != null && (fields.rpe < 1 || fields.rpe > 10)) {
    return "RPE חייב להיות בין 1 ל-10";
  }
  return null;
}

function revalidateBuilder(traineeId: string, programId: string) {
  revalidatePath(`/trainer/trainees/${traineeId}/programs/${programId}`);
  revalidatePath(`/trainer/trainees/${traineeId}`);
}

/**
 * A published program stays visible to the trainee exactly as last
 * published — any edit here reverts it to draft so the change doesn't
 * reach the trainee until the trainer explicitly republishes. Returns
 * whether that happened, so the client can flip its own "פורסם" badge
 * without waiting for a full page refresh.
 */
async function revertToDraftIfPublished(
  supabase: Awaited<ReturnType<typeof createClient>>,
  programId: string,
): Promise<boolean> {
  const { data: program } = await supabase
    .from("programs")
    .select("status")
    .eq("id", programId)
    .single();

  if (program?.status !== "published") return false;

  await supabase.from("programs").update({ status: "draft" }).eq("id", programId);
  return true;
}

/**
 * Creates a workout on the given day (0=Sunday..6=Saturday) — the trainer
 * picks the day first (see the builder's day-picker). Global "אימון N"
 * numbering isn't stored; it's derived by sorting (day_of_week,
 * order_index) at display time, so deleting a workout never needs to
 * renumber anything.
 */
export async function createWorkout(
  traineeId: string,
  programId: string,
  dayOfWeek: number,
): Promise<WorkoutResult> {
  const supabase = await createClient();

  const { count } = await supabase
    .from("workouts")
    .select("id", { count: "exact", head: true })
    .eq("program_id", programId)
    .eq("day_of_week", dayOfWeek);

  if ((count ?? 0) >= MAX_WORKOUTS_PER_DAY) {
    return { error: `ניתן ליצור עד ${MAX_WORKOUTS_PER_DAY} אימונים ביום` };
  }

  const { data: workout, error } = await supabase
    .from("workouts")
    .insert({ program_id: programId, day_of_week: dayOfWeek, order_index: count ?? 0 })
    .select("id, order_index, day_of_week")
    .single();

  if (error || !workout) {
    return { error: "שגיאה ביצירת האימון" };
  }

  revalidateBuilder(traineeId, programId);
  return { workout };
}

export async function deleteWorkout(
  traineeId: string,
  programId: string,
  workoutId: string,
): Promise<ActionResult> {
  const supabase = await createClient();
  const { error } = await supabase.from("workouts").delete().eq("id", workoutId);
  if (error) {
    return { error: "שגיאה במחיקת האימון" };
  }

  const revertedToDraft = await revertToDraftIfPublished(supabase, programId);
  revalidateBuilder(traineeId, programId);
  return { revertedToDraft };
}

/** Adds an exercise to an existing workout, returning the created row. */
export async function addExerciseToWorkout(
  traineeId: string,
  programId: string,
  workoutId: string,
  exerciseId: string,
): Promise<ActionResult> {
  const supabase = await createClient();

  const { count } = await supabase
    .from("workout_exercises")
    .select("id", { count: "exact", head: true })
    .eq("workout_id", workoutId);

  const { data: row, error } = await supabase
    .from("workout_exercises")
    .insert({
      workout_id: workoutId,
      exercise_id: exerciseId,
      order_index: count ?? 0,
      // Sets/reps are required (see validateWorkoutExerciseFields) — a new
      // row starts with sane, immediately-valid defaults the trainer can
      // adjust rather than an invalid blank state.
      sets: 3,
      reps: "8-10",
    })
    .select("*")
    .single();

  if (error || !row) {
    return { error: "שגיאה בהוספת התרגיל" };
  }

  const revertedToDraft = await revertToDraftIfPublished(supabase, programId);
  revalidateBuilder(traineeId, programId);
  return { row, revertedToDraft };
}

export async function updateWorkoutExercise(
  traineeId: string,
  programId: string,
  id: string,
  fields: WorkoutExerciseFields,
): Promise<ActionResult> {
  const validationError = validateWorkoutExerciseFields(fields);
  if (validationError) {
    return { error: validationError };
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("workout_exercises")
    .update(fields)
    .eq("id", id);

  if (error) {
    return { error: "שגיאה בשמירה" };
  }

  const revertedToDraft = await revertToDraftIfPublished(supabase, programId);
  revalidateBuilder(traineeId, programId);
  return { revertedToDraft };
}

export async function deleteWorkoutExercise(
  traineeId: string,
  programId: string,
  id: string,
): Promise<ActionResult> {
  const supabase = await createClient();
  const { error } = await supabase.from("workout_exercises").delete().eq("id", id);
  if (error) {
    return { error: "שגיאה במחיקה" };
  }

  const revertedToDraft = await revertToDraftIfPublished(supabase, programId);
  revalidateBuilder(traineeId, programId);
  return { revertedToDraft };
}

export async function duplicateWorkoutExercise(
  traineeId: string,
  programId: string,
  id: string,
): Promise<ActionResult> {
  const supabase = await createClient();
  const { data: original } = await supabase
    .from("workout_exercises")
    .select("*")
    .eq("id", id)
    .single();
  if (!original) return { error: "התרגיל לא נמצא" };

  const { count } = await supabase
    .from("workout_exercises")
    .select("id", { count: "exact", head: true })
    .eq("workout_id", original.workout_id);

  const { id: _id, ...rest } = original;
  void _id;
  const { data: row, error } = await supabase
    .from("workout_exercises")
    .insert({ ...rest, order_index: count ?? 0 })
    .select("*")
    .single();

  if (error || !row) {
    return { error: "שגיאה בשכפול" };
  }

  const revertedToDraft = await revertToDraftIfPublished(supabase, programId);
  revalidateBuilder(traineeId, programId);
  return { row, revertedToDraft };
}

/** Persists a reorder the client already applied optimistically (drag or up/down). */
export async function reorderWorkoutExercises(
  traineeId: string,
  programId: string,
  orderedIds: string[],
): Promise<ActionResult> {
  const supabase = await createClient();

  await Promise.all(
    orderedIds.map((id, index) =>
      supabase.from("workout_exercises").update({ order_index: index }).eq("id", id),
    ),
  );

  const revertedToDraft = await revertToDraftIfPublished(supabase, programId);
  revalidateBuilder(traineeId, programId);
  return { revertedToDraft };
}
