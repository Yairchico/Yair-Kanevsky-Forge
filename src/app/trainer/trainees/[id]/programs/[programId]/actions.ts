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
 * Adds an exercise to a day, lazily creating that day's workout row, and
 * returns the created row so the client can append it to local state
 * directly instead of refetching the whole page.
 */
export async function addExerciseToDay(
  traineeId: string,
  programId: string,
  programDayId: string,
  exerciseId: string,
): Promise<ActionResult> {
  const supabase = await createClient();

  let { data: workout } = await supabase
    .from("workouts")
    .select("id")
    .eq("program_day_id", programDayId)
    .limit(1)
    .maybeSingle();

  if (!workout) {
    const { data: created, error } = await supabase
      .from("workouts")
      .insert({ program_day_id: programDayId, order_index: 0 })
      .select("id")
      .single();
    if (error || !created) {
      return { error: "שגיאה ביצירת האימון" };
    }
    workout = created;
  }

  const { count } = await supabase
    .from("workout_exercises")
    .select("id", { count: "exact", head: true })
    .eq("workout_id", workout.id);

  const { data: row, error } = await supabase
    .from("workout_exercises")
    .insert({
      workout_id: workout.id,
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

/** @deprecated kept for the up/down fallback buttons — use reorderWorkoutExercises for drag. */
export async function moveWorkoutExercise(
  traineeId: string,
  programId: string,
  workoutId: string,
  id: string,
  direction: "up" | "down",
): Promise<ActionResult> {
  const supabase = await createClient();
  const { data: rows } = await supabase
    .from("workout_exercises")
    .select("id, order_index")
    .eq("workout_id", workoutId)
    .order("order_index");

  if (!rows) return { error: "שגיאה" };

  const index = rows.findIndex((r) => r.id === id);
  const swapWith = direction === "up" ? index - 1 : index + 1;
  if (index === -1 || swapWith < 0 || swapWith >= rows.length) {
    return {};
  }

  const a = rows[index];
  const b = rows[swapWith];

  await Promise.all([
    supabase
      .from("workout_exercises")
      .update({ order_index: b.order_index })
      .eq("id", a.id),
    supabase
      .from("workout_exercises")
      .update({ order_index: a.order_index })
      .eq("id", b.id),
  ]);

  const revertedToDraft = await revertToDraftIfPublished(supabase, programId);
  revalidateBuilder(traineeId, programId);
  return { revertedToDraft };
}
