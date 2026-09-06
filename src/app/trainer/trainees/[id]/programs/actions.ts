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
    .select("id, day_of_week, order_index")
    .eq("program_id", fromProgramId)
    .order("day_of_week")
    .order("order_index");

  if (!sourceWorkouts?.length) return null;

  const { data: newWorkouts, error: workoutsError } = await supabase
    .from("workouts")
    .insert(
      sourceWorkouts.map((w) => ({
        program_id: toProgramId,
        day_of_week: w.day_of_week,
        order_index: w.order_index,
      })),
    )
    .select("id, day_of_week, order_index");

  if (workoutsError || !newWorkouts) {
    return "שגיאה בשכפול האימונים";
  }

  // (day_of_week, order_index) is unique per program (at most 2/day), so
  // it's a safe composite key to map old -> new workout ids by, regardless
  // of the order rows come back in. order_index alone is NOT unique per
  // program anymore — up to 2 workouts share it (one per day).
  const key = (dayOfWeek: number, orderIndex: number) => `${dayOfWeek}:${orderIndex}`;
  const newWorkoutIdByKey = new Map(
    newWorkouts.map((w) => [key(w.day_of_week, w.order_index), w.id]),
  );
  const oldToNewWorkoutId = new Map(
    sourceWorkouts.map((w) => [w.id, newWorkoutIdByKey.get(key(w.day_of_week, w.order_index))]),
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
  // exists for the chosen week, just go there instead of erroring. A
  // soft-deleted program (migration 0010) doesn't count — that week is
  // free again.
  const { data: existing } = await supabase
    .from("programs")
    .select("id")
    .eq("trainee_id", traineeId)
    .eq("week_start_date", weekStartDate)
    .is("deleted_at", null)
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

/**
 * Soft-delete (migration 0010): a hard DELETE here would cascade all the
 * way down (workouts -> workout_exercises -> workout_logs /
 * workout_completions, "on delete cascade" per migration 0001) and
 * destroy the trainee's actual training history along with whatever the
 * trainer meant to clean up. Setting deleted_at instead just hides the
 * program — from every listing query and, via RLS, from the trainee too —
 * while the row and everything under it (including real submitted
 * history) stays intact. Also reverts status to draft as a defense-in-depth
 * belt-and-suspenders: any code path that forgot the deleted_at filter
 * would still see it as unpublished, not live.
 */
export async function deleteProgram(
  traineeId: string,
  programId: string,
): Promise<ActionState> {
  const supabase = await createClient();
  const { error } = await supabase
    .from("programs")
    .update({ deleted_at: new Date().toISOString(), status: "draft" })
    .eq("id", programId);
  if (error) {
    return { error: "שגיאה בהסרת התוכנית" };
  }

  // A trainee could have this exact program open right now (see the
  // concurrency discussion this fixes part of) — invalidate their side too.
  revalidatePath(`/trainer/trainees/${traineeId}`);
  revalidatePath("/trainer");
  revalidatePath("/trainee");
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
