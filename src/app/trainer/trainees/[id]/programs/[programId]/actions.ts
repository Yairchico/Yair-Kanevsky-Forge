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
  workout?: { id: string; order_index: number };
}

const MAX_WORKOUTS_PER_PROGRAM = 10;

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

/** Creates the next numbered workout ("אימון N") directly under the program. */
export async function createWorkout(
  traineeId: string,
  programId: string,
): Promise<WorkoutResult> {
  const supabase = await createClient();

  const { count } = await supabase
    .from("workouts")
    .select("id", { count: "exact", head: true })
    .eq("program_id", programId);

  if ((count ?? 0) >= MAX_WORKOUTS_PER_PROGRAM) {
    return { error: `ניתן ליצור עד ${MAX_WORKOUTS_PER_PROGRAM} אימונים בתוכנית` };
  }

  const { data: workout, error } = await supabase
    .from("workouts")
    .insert({ program_id: programId, order_index: count ?? 0 })
    .select("id, order_index")
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

  // Renumber remaining workouts so there's no gap in "אימון N".
  const { data: remaining } = await supabase
    .from("workouts")
    .select("id, order_index")
    .eq("program_id", programId)
    .order("order_index");

  if (remaining) {
    await Promise.all(
      remaining.map((w, index) =>
        w.order_index === index
          ? Promise.resolve()
          : supabase.from("workouts").update({ order_index: index }).eq("id", w.id),
      ),
    );
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
      sets: 3,
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
  fields: Partial<WorkoutExerciseFields>,
): Promise<ActionResult> {
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
