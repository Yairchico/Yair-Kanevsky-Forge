"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { applyBlockProgression } from "@/lib/block-server";
import { NOT_TRAINER_ERROR, getTrainerContext } from "@/lib/require-trainer";
import { getRequestAuth } from "@/lib/viewer";
import {
  STALE_WORKOUT_ERROR,
  deleteSetLog,
  isStaleError,
  programForWorkout,
  setLogContext,
  saveExerciseNotes,
  saveSetLog,
  validateSetIndex,
  validateSetLogInput,
  type LogSetResult,
  type SetLogInput,
} from "@/lib/set-log-server";

/**
 * The trainer-led session with a trainee (planning/PLAN.md feature 5): the
 * trainer, standing next to the trainee, enters each set of a workout from
 * the trainee's weekly plan. Everything is stored exactly as if the trainee
 * had logged it — set_logs / workout_logs / workout_completions under the
 * TRAINEE's id — so history, "last time" and block progression treat it
 * like any other workout. A DB trigger (migration 0016) records that the
 * trainer was the one who entered it.
 *
 * Authorization: RLS only lets the trainer write another person's
 * performance rows, and a trigger rejects a row whose trainee isn't the
 * program's. getTrainerContext() is the early, readable version of that.
 */

function revalidateSession(traineeId: string) {
  revalidatePath(`/trainer/trainees/${traineeId}`);
  revalidatePath("/trainer");
  revalidatePath("/trainer/session");
  revalidatePath("/trainer/session/[workoutId]", "page");
  // The trainee's own screens show the same workout.
  revalidatePath("/trainee");
  revalidatePath("/trainee/workouts");
  revalidatePath("/trainee/history");
}

const DELETED_PROGRAM_ERROR = "התוכנית הזו הוסרה — אי אפשר לתעד בה אימון";

/**
 * Opens a session on one of the trainee's planned workouts. If the program
 * is still a draft it is published first (QUESTIONS.md Q5.2): a session the
 * trainee can't see in their own history would be a strange thing to leave
 * behind. The picker warns about this before the button is pressed.
 */
export async function startTraineeSession(workoutId: string): Promise<{ error: string }> {
  const ctx = await getTrainerContext();
  if (!ctx) return { error: NOT_TRAINER_ERROR };

  const program = await programForWorkout(ctx.supabase, workoutId);
  if (!program) return { error: "האימון לא נמצא" };
  if (program.deletedAt) return { error: DELETED_PROGRAM_ERROR };

  const { count } = await ctx.supabase
    .from("workout_exercises")
    .select("id", { count: "exact", head: true })
    .eq("workout_id", workoutId);
  if (!count) return { error: "אין תרגילים באימון הזה" };

  if (program.status === "draft") {
    const { error } = await ctx.supabase
      .from("programs")
      .update({
        status: "published",
        published_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", program.programId);
    if (error) return { error: "שגיאה בפרסום התוכנית" };
    revalidatePath(`/trainer/trainees/${program.traineeId}/programs/${program.programId}`);
    revalidateSession(program.traineeId);
  }

  redirect(`/trainer/session/${workoutId}`);
}

/** One set, entered by the trainer for the trainee. */
export async function logSetForTrainee(
  workoutExerciseId: string,
  setIndex: number,
  input: SetLogInput,
): Promise<LogSetResult> {
  const validationError = validateSetIndex(setIndex) ?? validateSetLogInput(input);
  if (validationError) return { error: validationError };

  // Who is asking, and everything about the exercise that's needed before
  // writing — together, one wait.
  const { supabase, viewer } = await getRequestAuth();
  const [me, context] = await Promise.all([viewer, setLogContext(supabase, workoutExerciseId)]);
  if (me?.role !== "trainer") return { error: NOT_TRAINER_ERROR };
  if (!context) return { error: STALE_WORKOUT_ERROR };
  if (context.program.deletedAt) return { error: DELETED_PROGRAM_ERROR };

  // No revalidatePath here on purpose — see syncAfterEdits (src/app/sync-actions.ts).
  return saveSetLog(supabase, { workoutExerciseId, setIndex, input, context });
}

export async function unlogSetForTrainee(
  workoutExerciseId: string,
  setIndex: number,
): Promise<{ error?: string }> {
  const { supabase, viewer } = await getRequestAuth();
  const [me, context] = await Promise.all([viewer, setLogContext(supabase, workoutExerciseId)]);
  if (me?.role !== "trainer") return { error: NOT_TRAINER_ERROR };
  if (!context) return { error: STALE_WORKOUT_ERROR };
  if (context.program.deletedAt) return { error: DELETED_PROGRAM_ERROR };

  const result = await deleteSetLog(supabase, {
    workoutExerciseId,
    setIndex,
    traineeId: context.program.traineeId,
  });
  // In a training block, what's logged decides next week's targets.
  if (!result.error && context.program.blockId) await applyBlockProgression(supabase, context.program.workoutId);
  // No revalidatePath here on purpose — see syncAfterEdits (src/app/sync-actions.ts).
  return result;
}

export interface FinishSessionInput {
  /** Per-exercise notes typed during the session. */
  notes: { workoutExerciseId: string; notes: string | null }[];
  /** The session's overall note. */
  generalNote: string | null;
}

/**
 * Ends the session: saves the notes and marks the workout as submitted on
 * the trainee's behalf. Finishing with sets missing is allowed — they
 * simply show as not done. If the trainee had already submitted this
 * workout themselves, their submission stays as it is (and stays theirs);
 * only the notes are added.
 */
export async function finishTraineeSession(
  workoutId: string,
  input: FinishSessionInput,
): Promise<{ error?: string; traineeId?: string }> {
  const ctx = await getTrainerContext();
  if (!ctx) return { error: NOT_TRAINER_ERROR };

  const program = await programForWorkout(ctx.supabase, workoutId);
  if (!program) return { error: "האימון לא נמצא" };
  if (program.deletedAt) return { error: DELETED_PROGRAM_ERROR };

  const generalNote = input.generalNote?.trim() || null;
  if (generalNote && generalNote.length > 2000) return { error: "ההערה הכללית ארוכה מדי" };

  // Only this workout's own exercises — never a note for some other row.
  const { data: exercises } = await ctx.supabase
    .from("workout_exercises")
    .select("id")
    .eq("workout_id", workoutId);
  const ownIds = new Set((exercises ?? []).map((e) => e.id));
  const notes = (input.notes ?? []).filter((n) => ownIds.has(n.workoutExerciseId));

  const notesResult = await saveExerciseNotes(ctx.supabase, program.traineeId, notes);
  if (notesResult.error) return { error: notesResult.error };

  const { data: existing } = await ctx.supabase
    .from("workout_completions")
    .select("id")
    .eq("workout_id", workoutId)
    .eq("trainee_id", program.traineeId)
    .maybeSingle();

  if (existing) {
    // `notes` is only ever the trainer's session note (a trainee's own
    // submit never writes it), so what the dialog holds — the previous note
    // pre-filled, edited or cleared — is simply what it should now be.
    const { error } = await ctx.supabase
      .from("workout_completions")
      .update({ notes: generalNote })
      .eq("id", existing.id);
    if (error) return { error: "שגיאה בשמירת ההערה" };
  } else {
    const { error } = await ctx.supabase.from("workout_completions").insert({
      workout_id: workoutId,
      trainee_id: program.traineeId,
      notes: generalNote,
    });
    if (error) {
      return { error: isStaleError(error.code) ? STALE_WORKOUT_ERROR : "שגיאה בסיום האימון" };
    }
  }

  // Finishing settles what was (and wasn't) done in this workout.
  if (program.blockId) await applyBlockProgression(ctx.supabase, workoutId);
  revalidateSession(program.traineeId);
  return { traineeId: program.traineeId };
}
