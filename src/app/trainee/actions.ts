"use server";

import { revalidatePath } from "next/cache";
import { applyBlockProgression } from "@/lib/block-server";
import { getRequestAuth } from "@/lib/viewer";
import { SET_LOG_COLUMNS, toLoggedSet, type LoggedSet } from "@/lib/sets";
import { addDays, getWeekStart, toDateKey, israelNow } from "@/lib/week";
import {
  STALE_WORKOUT_ERROR,
  deleteSetLog,
  isStaleError,
  programForWorkout,
  setLogContext,
  saveExerciseNotes,
  saveSetLog,
  saveSetLogs,
  setLogRow,
  validateSetsToSave,
  type SetToSave,
  validateSetIndex,
  validateSetLogInput,
  type LogSetResult,
  type SetLogInput,
} from "@/lib/set-log-server";

function revalidateTraineeAndTrainer() {
  revalidatePath("/trainee");
  revalidatePath("/trainee/workouts");
  revalidatePath("/trainee/history");
  revalidatePath("/trainer/trainees/[id]", "page");
}

const LOCKED_WEEK_ERROR = "אפשר לעדכן רק אימונים מהשבוע הנוכחי ומהשבוע הקודם";

/**
 * A trainee can change what they logged only in the current week and the
 * one before it (QUESTIONS.md Q1.7) — enough to finish a late workout or
 * fix a typo, without quietly rewriting older history. Future weeks are
 * fine (doing a workout early).
 */
function isEditableWeek(weekStartDate: string): boolean {
  const previousWeekKey = toDateKey(addDays(getWeekStart(israelNow()), -7));
  return weekStartDate >= previousWeekKey;
}

/**
 * "סמן כבוצע" on one exercise: saves every set the screen sends (the rows
 * that weren't saved yet — as typed, or their target where nothing was
 * typed; useSetEntry.fillsFor decides) in ONE request, and marks the
 * exercise done. Rows with nothing to go on (no reps and no numeric
 * target) aren't sent; they simply stay open.
 */
export async function markExerciseDone(
  workoutExerciseId: string,
  sets: SetToSave[],
): Promise<{ error?: string; logs?: LoggedSet[] }> {
  const validationError = validateSetsToSave(sets);
  if (validationError) return { error: validationError };

  const { supabase, viewer } = await getRequestAuth();
  const [user, context] = await Promise.all([viewer, setLogContext(supabase, workoutExerciseId)]);
  if (!user) return { error: "שגיאת התחברות" };
  if (!context || context.program.traineeId !== user.id) return { error: STALE_WORKOUT_ERROR };
  if (!isEditableWeek(context.program.weekStartDate)) return { error: LOCKED_WEEK_ERROR };

  // No revalidatePath here on purpose — see syncAfterEdits (src/app/sync-actions.ts).
  const result = await saveSetLogs(supabase, { workoutExerciseId, sets, context, markDone: true });
  return { error: result.error, logs: result.logs };
}

/**
 * Takes "done" back: removes the exercise's done mark and the sets the
 * screen names — the ones that are exactly the target with no RPE, i.e.
 * what "done" itself filled in (useSetEntry.autoFilledIndexes). Sets the
 * trainee typed differently stay.
 */
export async function unmarkExerciseDone(
  workoutExerciseId: string,
  clearIndexes: number[],
): Promise<{ error?: string }> {
  if (!Array.isArray(clearIndexes) || clearIndexes.length > 30 || clearIndexes.some((i) => validateSetIndex(i))) {
    return { error: "סטים לא תקינים" };
  }

  const { supabase, viewer } = await getRequestAuth();
  const [user, context] = await Promise.all([viewer, setLogContext(supabase, workoutExerciseId)]);
  if (!user) return { error: "שגיאת התחברות" };
  if (!context || context.program.traineeId !== user.id) return { error: STALE_WORKOUT_ERROR };
  if (!isEditableWeek(context.program.weekStartDate)) return { error: LOCKED_WEEK_ERROR };

  const [{ error: setsError }, { error: markError }] = await Promise.all([
    clearIndexes.length > 0
      ? supabase
          .from("set_logs")
          .delete()
          .eq("workout_exercise_id", workoutExerciseId)
          .eq("trainee_id", user.id)
          .in("set_index", clearIndexes)
      : Promise.resolve({ error: null }),
    supabase
      .from("workout_exercise_completions")
      .delete()
      .eq("workout_exercise_id", workoutExerciseId)
      .eq("trainee_id", user.id),
  ]);
  if (setsError || markError) return { error: "שגיאה בביטול הסימון" };

  // In a training block, what's logged decides next week's targets.
  if (clearIndexes.length > 0 && context.program.blockId) {
    await applyBlockProgression(supabase, context.program.workoutId);
  }
  // No revalidatePath here on purpose — see syncAfterEdits (src/app/sync-actions.ts).
  return {};
}

/** One set of "the whole workout as planned", per exercise. */
export interface WorkoutSetToSave extends SetToSave {
  workoutExerciseId: string;
}

/**
 * "הכל בוצע כמתוכנן": the whole workout in one go — every set the screen
 * sends (what wasn't saved yet, as typed or as its target) saved in ONE
 * request, every exercise of the workout marked done, the exercise notes
 * saved, and the workout submitted. Like "הגש אימון", it revalidates.
 */
export async function completeWorkoutAsPlanned(
  workoutId: string,
  sets: WorkoutSetToSave[],
  notes: ExerciseNoteEntry[] = [],
): Promise<{ error?: string; logs?: Record<string, LoggedSet[]> }> {
  if (!Array.isArray(sets) || sets.length > 600) return { error: "סטים לא תקינים" };
  const byExercise = new Map<string, SetToSave[]>();
  for (const set of sets) {
    const list = byExercise.get(set.workoutExerciseId) ?? [];
    list.push({ setIndex: set.setIndex, input: set.input });
    byExercise.set(set.workoutExerciseId, list);
  }
  for (const list of byExercise.values()) {
    const validationError = validateSetsToSave(list);
    if (validationError) return { error: validationError };
  }

  // Who is asking, whose workout this is, its exercises and their planned
  // sets — all at once. (The planned sets are asked for by the ids the
  // screen sent; anything that turns out not to be this workout's is
  // refused right below.)
  const { supabase, viewer } = await getRequestAuth();
  const sentIds = [...byExercise.keys()];
  const [user, program, { data: exercises }, { data: plannedRows }] = await Promise.all([
    viewer,
    programForWorkout(supabase, workoutId),
    supabase.from("workout_exercises").select("id").eq("workout_id", workoutId),
    sentIds.length > 0
      ? supabase.from("workout_exercise_sets").select("id, workout_exercise_id, set_index").in("workout_exercise_id", sentIds)
      : Promise.resolve({ data: [] as { id: string; workout_exercise_id: string; set_index: number }[] }),
  ]);
  if (!user) return { error: "שגיאת התחברות" };
  if (!program || program.traineeId !== user.id) return { error: STALE_WORKOUT_ERROR };
  if (!isEditableWeek(program.weekStartDate)) return { error: LOCKED_WEEK_ERROR };
  const exerciseIds = new Set((exercises ?? []).map((e) => e.id));
  if (sentIds.some((id) => !exerciseIds.has(id))) return { error: STALE_WORKOUT_ERROR };

  // 1. the sets
  const logs: Record<string, LoggedSet[]> = {};
  if (sets.length > 0) {
    const loggedAt = new Date().toISOString();
    const rows = sentIds.flatMap((exerciseId) => {
      const planned = (plannedRows ?? [])
        .filter((p) => p.workout_exercise_id === exerciseId)
        .map((p) => ({ id: p.id, setIndex: p.set_index }));
      return byExercise.get(exerciseId)!.map((set) => setLogRow(exerciseId, user.id, planned, set, loggedAt));
    });
    const { data: saved, error } = await supabase
      .from("set_logs")
      .upsert(rows, { onConflict: "workout_exercise_id,trainee_id,set_index" })
      .select(SET_LOG_COLUMNS);
    if (error || !saved || saved.length !== rows.length) {
      return { error: isStaleError(error?.code) ? STALE_WORKOUT_ERROR : "שגיאה בשמירת הסטים" };
    }
    for (const row of saved) (logs[row.workout_exercise_id] ??= []).push(toLoggedSet(row));
  }

  // 2. every exercise done, the notes, the submission — together
  const notesForThisWorkout = notes.filter((n) => exerciseIds.has(n.workoutExerciseId));
  const [{ error: doneError }, notesResult, { error: completionError }] = await Promise.all([
    exerciseIds.size > 0
      ? supabase.from("workout_exercise_completions").upsert(
          [...exerciseIds].map((id) => ({ workout_exercise_id: id, trainee_id: user.id })),
          { onConflict: "workout_exercise_id,trainee_id" },
        )
      : Promise.resolve({ error: null }),
    saveExerciseNotes(supabase, user.id, notesForThisWorkout),
    supabase
      .from("workout_completions")
      .upsert({ workout_id: workoutId, trainee_id: user.id }, { onConflict: "workout_id,trainee_id" }),
  ]);
  if (notesResult.error) return { error: notesResult.error, logs };
  if (doneError || completionError) {
    return {
      error: isStaleError((completionError ?? doneError)?.code) ? STALE_WORKOUT_ERROR : "שגיאה בהגשת האימון",
      logs,
    };
  }

  // Submitting settles what was (and wasn't) done.
  if (program.blockId) await applyBlockProgression(supabase, workoutId);
  revalidateTraineeAndTrainer();
  return { logs };
}

/**
 * Saves one performed set the moment the trainee confirms it (✓) —
 * PLAN.md feature 1: each set is submitted on its own, rather than the
 * whole workout's numbers waiting for "הגש אימון". When this completes
 * every working (non-warm-up) set of the exercise, the exercise is marked
 * done too (Q1.3) — the manual "סמן כבוצע" toggle still exists for a trainee
 * who doesn't want to type numbers.
 */
export async function logSet(
  workoutExerciseId: string,
  setIndex: number,
  input: SetLogInput,
): Promise<LogSetResult> {
  const validationError = validateSetIndex(setIndex) ?? validateSetLogInput(input);
  if (validationError) return { error: validationError };

  // Who is asking, and everything about the exercise that's needed before
  // writing — together, one wait. (Through RLS: the context resolves only
  // for the trainee's own published program.)
  const { supabase, viewer } = await getRequestAuth();
  const [user, context] = await Promise.all([viewer, setLogContext(supabase, workoutExerciseId)]);
  if (!user) return { error: "שגיאת התחברות" };
  if (!context || context.program.traineeId !== user.id) return { error: STALE_WORKOUT_ERROR };
  if (!isEditableWeek(context.program.weekStartDate)) return { error: LOCKED_WEEK_ERROR };

  // No revalidatePath here on purpose — see syncAfterEdits (src/app/sync-actions.ts).
  return saveSetLog(supabase, { workoutExerciseId, setIndex, input, context });
}

/** Un-confirms a set (the trainee tapped ✓ again). Doesn't touch the exercise's "done" mark. */
export async function unlogSet(
  workoutExerciseId: string,
  setIndex: number,
): Promise<{ error?: string }> {
  const { supabase, viewer } = await getRequestAuth();
  const [user, context] = await Promise.all([viewer, setLogContext(supabase, workoutExerciseId)]);
  if (!user) return { error: "שגיאת התחברות" };
  if (!context || context.program.traineeId !== user.id) return { error: STALE_WORKOUT_ERROR };
  if (!isEditableWeek(context.program.weekStartDate)) return { error: LOCKED_WEEK_ERROR };

  const result = await deleteSetLog(supabase, { workoutExerciseId, setIndex, traineeId: user.id });
  // In a training block, what's logged decides next week's targets.
  if (!result.error && context.program.blockId) await applyBlockProgression(supabase, context.program.workoutId);
  // No revalidatePath here on purpose — see syncAfterEdits (src/app/sync-actions.ts).
  return result;
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
 * logSet. What's left is the exercise-level note (workout_logs) and the
 * workout_completions row that marks the submission itself.
 *
 * Un-submitting only removes workout_completions — logged sets stay.
 */
export async function submitWorkout(
  workoutId: string,
  submitted: boolean,
  notes: ExerciseNoteEntry[] = [],
): Promise<SubmitWorkoutState> {
  const { supabase, viewer } = await getRequestAuth();
  const [user, program] = await Promise.all([viewer, programForWorkout(supabase, workoutId)]);
  if (!user) return { error: "שגיאת התחברות" };

  if (!program || program.traineeId !== user.id) return { error: STALE_WORKOUT_ERROR };
  if (!isEditableWeek(program.weekStartDate)) return { error: LOCKED_WEEK_ERROR };

  if (submitted) {
    const notesResult = await saveExerciseNotes(supabase, user.id, notes);
    if (notesResult.error) return { error: notesResult.error };

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

  // Submitting settles what was (and wasn't) done; un-submitting reopens it.
  if (program.blockId) await applyBlockProgression(supabase, workoutId);
  revalidateTraineeAndTrainer();
  return {};
}
