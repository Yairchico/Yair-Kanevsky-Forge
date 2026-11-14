"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export interface ActionState {
  error?: string;
}

type Supabase = Awaited<ReturnType<typeof createClient>>;

/**
 * Deep-copies one program's entire structure (every workout, every
 * workout_exercise on it, and every planned set under those — migration
 * 0013 — with reps/weight/RPE targets, rest and instructions) into
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

  // Inserted one at a time (not a single batch insert) so each source
  // workout's new id is captured directly from its own insert response.
  // This used to be a batch insert with old->new ids reconstructed
  // afterwards via a (day_of_week, order_index) composite key — but that
  // key isn't actually guaranteed unique per program: createWorkout could
  // (before its own fix) assign a new workout the same order_index as an
  // existing one on the same day, and a Map can't hold two entries under
  // one key, so one side of that collision silently mapped to the wrong
  // new workout (or to undefined) and its exercises came out wrong or
  // failed to copy at all.
  const oldToNewWorkoutId = new Map<string, string>();
  for (const w of sourceWorkouts) {
    const { data: newWorkout, error: workoutError } = await supabase
      .from("workouts")
      .insert({ program_id: toProgramId, day_of_week: w.day_of_week, order_index: w.order_index })
      .select("id")
      .single();

    if (workoutError || !newWorkout) {
      return "שגיאה בשכפול האימונים";
    }
    oldToNewWorkoutId.set(w.id, newWorkout.id);
  }

  const { data: sourceExercises } = await supabase
    .from("workout_exercises")
    .select("id, workout_id, exercise_id, order_index, rest_seconds, instructions, hide_library_note")
    .in(
      "workout_id",
      sourceWorkouts.map((w) => w.id),
    )
    .order("order_index");

  if (!sourceExercises?.length) return null;

  const { data: sourceSets } = await supabase
    .from("workout_exercise_sets")
    .select(
      "workout_exercise_id, set_index, set_type, reps_min, reps_max, reps_note, weight_kg, weight_note, rpe",
    )
    .in(
      "workout_exercise_id",
      sourceExercises.map((we) => we.id),
    );

  // One insert per exercise, same reasoning as the workouts above: each
  // exercise's new id comes straight from its own insert, so its sets
  // (migration 0013) can be attached without reconstructing a mapping.
  for (const we of sourceExercises) {
    const { data: newExercise, error: exerciseError } = await supabase
      .from("workout_exercises")
      .insert({
        workout_id: oldToNewWorkoutId.get(we.workout_id)!,
        exercise_id: we.exercise_id,
        order_index: we.order_index,
        rest_seconds: we.rest_seconds,
        instructions: we.instructions,
        hide_library_note: we.hide_library_note,
      })
      .select("id")
      .single();

    if (exerciseError || !newExercise) {
      return "שגיאה בשכפול התרגילים";
    }

    const sets = (sourceSets ?? []).filter((s) => s.workout_exercise_id === we.id);
    // A legacy exercise with no sets yet (shouldn't happen after migration
    // 0013's backfill) gets the same default a newly-added exercise does.
    const rows = sets.length
      ? sets.map(({ workout_exercise_id: _from, ...set }) => {
          void _from;
          return { ...set, workout_exercise_id: newExercise.id };
        })
      : [1, 2, 3].map((n) => ({
          workout_exercise_id: newExercise.id,
          set_index: n,
          set_type: "working" as const,
          reps_min: 8,
          reps_max: 10,
          reps_note: null,
          weight_kg: null,
          weight_note: null,
          rpe: null,
        }));

    const { error: setsError } = await supabase.from("workout_exercise_sets").insert(rows);
    if (setsError) {
      return "שגיאה בשכפול הסטים";
    }
  }

  return null;
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
  // Set only after the trainer confirms the "כבר קיימת תוכנית לשבוע זה"
  // popup (new-program-form.tsx) — without it, an existing program for the
  // chosen week is never touched.
  const replaceExisting = formData.get("replace_existing") === "1";

  if (!title) {
    return { error: "נא להזין שם לתוכנית" };
  }
  if (!weekStartDate) {
    return { error: "נא לבחור שבוע" };
  }

  const supabase = await createClient();

  // One program per (trainee, week) — see migration 0006. A soft-deleted
  // program (migration 0010) doesn't count — that week is free again.
  const { data: existing } = await supabase
    .from("programs")
    .select("id")
    .eq("trainee_id", traineeId)
    .eq("week_start_date", weekStartDate)
    .is("deleted_at", null)
    .maybeSingle();

  if (existing && !replaceExisting) {
    // No confirmation on file (a stale form, or JS-disabled client bypassing
    // the popup entirely) — same safe fallback as before this flow existed:
    // just go to the existing program instead of silently doing anything
    // destructive.
    redirect(`/trainer/trainees/${traineeId}/programs/${existing.id}`);
  }

  if (existing && replaceExisting) {
    // Soft-delete (same as deleteProgram) BEFORE inserting the new program:
    // the partial-unique index on (trainee_id, week_start_date) where
    // deleted_at is null would otherwise reject the insert while the old
    // row still occupies that week. This only flips deleted_at/status —
    // its workouts/workout_exercises rows (and any real submitted history
    // under them) are untouched, so duplicating from this exact program
    // below (if the trainer chose it as its own source) still works.
    const { error: replaceError } = await supabase
      .from("programs")
      .update({ deleted_at: new Date().toISOString(), status: "draft" })
      .eq("id", existing.id);
    if (replaceError) {
      return { error: "שגיאה בהחלפת התוכנית הקיימת" };
    }
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
  if (existing && replaceExisting) {
    // The replaced program could have been showing on the trainee's side
    // (e.g. this week's own, still-ongoing program) — same revalidation as
    // deleteProgram.
    revalidatePath("/trainee");
    revalidatePath("/trainee/workouts");
  }
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
  revalidatePath("/trainee/workouts");
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
