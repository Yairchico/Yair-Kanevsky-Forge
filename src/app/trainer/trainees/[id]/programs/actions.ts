"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export interface ActionState {
  error?: string;
}

type Supabase = Awaited<ReturnType<typeof createClient>>;

/**
 * Deep-copies one program's entire structure (every workout, and every
 * workout_exercise on it — sets/reps/weight/RPE/rest/instructions) into
 * another, freshly-created program. Used by "שכפול שבוע": the new program
 * is always created as a draft, so the trainer reviews the copy before
 * publishing it.
 */
async function duplicateProgramContents(
  supabase: Supabase,
  fromProgramId: string,
  toProgramId: string,
): Promise<string | null> {
  const { data: sourceWorkouts } = await supabase
    .from("workouts")
    .select("id, order_index")
    .eq("program_id", fromProgramId)
    .order("order_index");

  if (!sourceWorkouts?.length) return null;

  const { data: newWorkouts, error: workoutsError } = await supabase
    .from("workouts")
    .insert(
      sourceWorkouts.map((w) => ({ program_id: toProgramId, order_index: w.order_index })),
    )
    .select("id, order_index");

  if (workoutsError || !newWorkouts) {
    return "שגיאה בשכפול האימונים";
  }

  // order_index is unique per program, so it's a safe key to map old -> new
  // workout ids by, regardless of the order rows come back in.
  const newWorkoutIdByOrderIndex = new Map(newWorkouts.map((w) => [w.order_index, w.id]));
  const oldToNewWorkoutId = new Map(
    sourceWorkouts.map((w) => [w.id, newWorkoutIdByOrderIndex.get(w.order_index)]),
  );

  const { data: sourceExercises } = await supabase
    .from("workout_exercises")
    .select(
      "workout_id, exercise_id, order_index, sets, reps, weight, rpe, rest_seconds, instructions",
    )
    .in(
      "workout_id",
      sourceWorkouts.map((w) => w.id),
    )
    .order("order_index");

  if (!sourceExercises?.length) return null;

  const { error: exercisesError } = await supabase.from("workout_exercises").insert(
    sourceExercises.map((we) => ({
      workout_id: oldToNewWorkoutId.get(we.workout_id)!,
      exercise_id: we.exercise_id,
      order_index: we.order_index,
      sets: we.sets,
      reps: we.reps,
      weight: we.weight,
      rpe: we.rpe,
      rest_seconds: we.rest_seconds,
      instructions: we.instructions,
    })),
  );

  return exercisesError ? "שגיאה בשכפול התרגילים" : null;
}

export async function createProgram(
  traineeId: string,
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const title = String(formData.get("title") ?? "").trim();
  const weekStartDate = String(formData.get("week_start_date") ?? "").trim();
  const duplicateFromProgramId =
    String(formData.get("duplicate_from_program_id") ?? "").trim() || null;

  if (!title) {
    return { error: "נא להזין שם לתוכנית" };
  }
  if (!weekStartDate) {
    return { error: "נא לבחור שבוע" };
  }

  const supabase = await createClient();

  // One program per (trainee, week) — see migration 0006. If one already
  // exists for the chosen week, just go there instead of erroring.
  const { data: existing } = await supabase
    .from("programs")
    .select("id")
    .eq("trainee_id", traineeId)
    .eq("week_start_date", weekStartDate)
    .maybeSingle();

  if (existing) {
    redirect(`/trainer/trainees/${traineeId}/programs/${existing.id}`);
  }

  const { data: program, error } = await supabase
    .from("programs")
    .insert({ trainee_id: traineeId, title, week_start_date: weekStartDate })
    .select("id")
    .single();

  if (error || !program) {
    return { error: "שגיאה ביצירת התוכנית" };
  }

  if (duplicateFromProgramId) {
    const duplicateError = await duplicateProgramContents(
      supabase,
      duplicateFromProgramId,
      program.id,
    );
    if (duplicateError) {
      // The (empty) program itself was created fine — let the trainer land
      // on it and build manually rather than losing that, but surface what
      // happened server-side for diagnosis.
      console.error("createProgram: duplicateProgramContents failed", duplicateError);
    }
  }

  revalidatePath(`/trainer/trainees/${traineeId}`);
  redirect(`/trainer/trainees/${traineeId}/programs/${program.id}`);
}

export async function deleteProgram(
  traineeId: string,
  programId: string,
): Promise<ActionState> {
  const supabase = await createClient();
  const { error } = await supabase.from("programs").delete().eq("id", programId);
  if (error) {
    return { error: "שגיאה במחיקת התוכנית" };
  }

  revalidatePath(`/trainer/trainees/${traineeId}`);
  redirect(`/trainer/trainees/${traineeId}`);
}

export async function setProgramStatus(
  traineeId: string,
  programId: string,
  status: "draft" | "published",
) {
  const supabase = await createClient();
  await supabase
    .from("programs")
    .update({
      status,
      published_at: status === "published" ? new Date().toISOString() : null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", programId);

  revalidatePath(`/trainer/trainees/${traineeId}`);
  revalidatePath(`/trainer/trainees/${traineeId}/programs/${programId}`);
}
