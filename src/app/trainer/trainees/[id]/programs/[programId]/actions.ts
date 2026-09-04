"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

export interface ActionResult {
  error?: string;
}

function revalidateBuilder(traineeId: string, programId: string) {
  revalidatePath(`/trainer/trainees/${traineeId}/programs/${programId}`);
}

/** Adds an exercise to a day, lazily creating that day's workout row. */
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

  const { error } = await supabase.from("workout_exercises").insert({
    workout_id: workout.id,
    exercise_id: exerciseId,
    order_index: count ?? 0,
    sets: 3,
  });

  if (error) {
    return { error: "שגיאה בהוספת התרגיל" };
  }

  revalidateBuilder(traineeId, programId);
  return {};
}

export interface WorkoutExerciseFields {
  sets: number | null;
  reps: string | null;
  weight: string | null;
  rpe: number | null;
  rest_seconds: number | null;
  instructions: string | null;
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

  revalidateBuilder(traineeId, programId);
  return {};
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

  revalidateBuilder(traineeId, programId);
  return {};
}

export async function duplicateWorkoutExercise(
  traineeId: string,
  programId: string,
  id: string,
): Promise<ActionResult> {
  const supabase = await createClient();
  const { data: row } = await supabase
    .from("workout_exercises")
    .select("*")
    .eq("id", id)
    .single();
  if (!row) return { error: "התרגיל לא נמצא" };

  const { count } = await supabase
    .from("workout_exercises")
    .select("id", { count: "exact", head: true })
    .eq("workout_id", row.workout_id);

  const { id: _id, ...rest } = row;
  void _id;
  const { error } = await supabase
    .from("workout_exercises")
    .insert({ ...rest, order_index: count ?? 0 });

  if (error) {
    return { error: "שגיאה בשכפול" };
  }

  revalidateBuilder(traineeId, programId);
  return {};
}

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

  revalidateBuilder(traineeId, programId);
  return {};
}
