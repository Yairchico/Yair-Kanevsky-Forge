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

import { applyBlockProgression } from "@/lib/block-server";
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

/** What has to be known about an exercise before one of its sets is written. */
export interface SetLogContext {
  program: ProgramRef;
  /** The exercise's plan. */
  planned: { id: string; setIndex: number; setType: string }[];
  /** The set numbers the program's trainee has already performed. */
  loggedIndexes: number[];
}

/**
 * The program an exercise belongs to, its planned sets and which were
 * already performed — read through the caller's RLS, so for a trainee this
 * only resolves for their own published, non-deleted program.
 *
 * One round trip (set_log_context, migration 0020). On a database where
 * that migration hasn't run yet it falls back to the separate queries, so
 * the code can be deployed before or after it.
 */
export async function setLogContext(supabase: Supabase, workoutExerciseId: string): Promise<SetLogContext | null> {
  const { data, error } = await supabase.rpc("set_log_context", { p_workout_exercise_id: workoutExerciseId });
  if (!error) {
    if (!data) return null;
    return {
      program: {
        workoutId: data.workout_id,
        programId: data.program_id,
        traineeId: data.trainee_id,
        weekStartDate: data.week_start_date,
        status: data.status,
        deletedAt: data.deleted_at,
        blockId: data.block_id,
      },
      planned: (data.planned ?? []).map((s) => ({ id: s.id, setIndex: s.set_index, setType: s.set_type })),
      loggedIndexes: data.logged ?? [],
    };
  }

  // Migration 0020 not applied (or anything else unexpected): the long way.
  const program = await programForWorkoutExercise(supabase, workoutExerciseId);
  if (!program) return null;
  const [{ data: plannedSets }, { data: logged }] = await Promise.all([
    supabase.from("workout_exercise_sets").select("id, set_index, set_type").eq("workout_exercise_id", workoutExerciseId),
    supabase
      .from("set_logs")
      .select("set_index")
      .eq("workout_exercise_id", workoutExerciseId)
      .eq("trainee_id", program.traineeId)
      .eq("status", "done"),
  ]);
  return {
    program,
    planned: (plannedSets ?? []).map((s) => ({ id: s.id, setIndex: s.set_index, setType: s.set_type })),
    loggedIndexes: (logged ?? []).map((l) => l.set_index),
  };
}

/** One set to save, as typed (or its target). */
export interface SetToSave {
  setIndex: number;
  input: SetLogInput;
}

/** Validates a list of sets sent from the screen: indexes in range, no index twice, every value sane. */
export function validateSetsToSave(sets: SetToSave[]): string | null {
  if (!Array.isArray(sets) || sets.length > MAX_SET_INDEX) return "סטים לא תקינים";
  const seen = new Set<number>();
  for (const set of sets) {
    const error = validateSetIndex(set.setIndex) ?? validateSetLogInput(set.input);
    if (error) return error;
    if (seen.has(set.setIndex)) return "סטים לא תקינים";
    seen.add(set.setIndex);
  }
  return null;
}

/** The set_logs row for one set of an exercise, linked to its planned set when there is one. */
export function setLogRow(
  workoutExerciseId: string,
  traineeId: string,
  planned: { id: string; setIndex: number }[],
  set: SetToSave,
  loggedAt: string,
) {
  return {
    workout_exercise_id: workoutExerciseId,
    workout_exercise_set_id: planned.find((p) => p.setIndex === set.setIndex)?.id ?? null,
    trainee_id: traineeId,
    set_index: set.setIndex,
    weight_kg: set.input.weightKg,
    reps: set.input.reps,
    rpe: set.input.rpe,
    status: "done" as const,
    logged_at: loggedAt,
  };
}

/**
 * Upserts performed sets of one exercise on (workout_exercise_id,
 * trainee_id, set_index) in ONE request — confirming a set again after
 * fixing a typo updates it in place — and marks the exercise done when
 * `markDone` is set or this completes every working (non-warm-up) set of
 * its plan. Who logged them (`logged_by`, `source`) is filled in by a DB
 * trigger from the session, not passed in.
 *
 * `context` is what setLogContext returned just before (the plan, and what
 * was already performed), so nothing has to be read again here. In a
 * training block the write is followed by the block's recompute (what was
 * just logged can change next week's targets) — together with the "done"
 * mark, not after it.
 */
export async function saveSetLogs(
  supabase: Supabase,
  args: { workoutExerciseId: string; sets: SetToSave[]; context: SetLogContext; markDone?: boolean },
): Promise<{ error?: string; logs?: LoggedSet[]; exerciseDone?: boolean }> {
  const { workoutExerciseId, sets, context, markDone = false } = args;
  const traineeId = context.program.traineeId;

  let logs: LoggedSet[] = [];
  if (sets.length > 0) {
    const loggedAt = new Date().toISOString();
    const { data: rows, error } = await supabase
      .from("set_logs")
      .upsert(
        sets.map((set) => setLogRow(workoutExerciseId, traineeId, context.planned, set, loggedAt)),
        { onConflict: "workout_exercise_id,trainee_id,set_index" },
      )
      .select(SET_LOG_COLUMNS);
    if (error || !rows || rows.length !== sets.length) {
      return { error: isStaleError(error?.code) ? STALE_WORKOUT_ERROR : "שגיאה בשמירת הסט" };
    }
    logs = rows.map(toLoggedSet);
  }

  // Done = asked for, or every working set is performed: the ones performed before, plus these.
  const workingIndexes = context.planned.filter((s) => s.setType !== "warmup").map((s) => s.setIndex);
  const loggedIndexes = new Set([...context.loggedIndexes, ...sets.map((s) => s.setIndex)]);
  const exerciseDone =
    markDone || (workingIndexes.length > 0 && workingIndexes.every((i) => loggedIndexes.has(i)));

  const [completion] = await Promise.all([
    exerciseDone
      ? supabase
          .from("workout_exercise_completions")
          .upsert(
            { workout_exercise_id: workoutExerciseId, trainee_id: traineeId },
            { onConflict: "workout_exercise_id,trainee_id" },
          )
      : null,
    context.program.blockId && sets.length > 0 ? applyBlockProgression(supabase, context.program.workoutId) : null,
  ]);
  if (markDone && completion?.error) return { error: "שגיאה בסימון התרגיל", logs };

  return { logs, exerciseDone };
}

/** One performed set — saveSetLogs for a single set. */
export async function saveSetLog(
  supabase: Supabase,
  args: { workoutExerciseId: string; setIndex: number; input: SetLogInput; context: SetLogContext },
): Promise<LogSetResult> {
  const result = await saveSetLogs(supabase, {
    workoutExerciseId: args.workoutExerciseId,
    sets: [{ setIndex: args.setIndex, input: args.input }],
    context: args.context,
  });
  if (result.error) return { error: result.error };
  return { log: result.logs?.[0], exerciseDone: result.exerciseDone };
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
