"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import {
  PLANNED_SET_COLUMNS,
  parseRepsInput,
  parseWeightInput,
  toPlannedSet,
  type PlannedSet,
} from "@/lib/sets";

/** Exercise-level fields — sets/reps/weight/RPE are per set now (migration 0013, see SetFields). */
export interface WorkoutExerciseFields {
  rest_seconds: number | null;
  instructions: string | null;
}

/** What the trainer edits on one planned set. reps/weight are raw text, parsed by src/lib/sets.ts. */
export interface SetFields {
  set_type: "warmup" | "working";
  reps: string;
  weight: string;
  rpe: number | null;
}

export interface WorkoutExerciseRow extends WorkoutExerciseFields {
  id: string;
  workout_id: string;
  exercise_id: string;
  order_index: number;
  sets: PlannedSet[];
}

export interface ActionResult {
  error?: string;
  row?: WorkoutExerciseRow;
  /** True when this edit just reverted a published program back to draft. */
  revertedToDraft?: boolean;
}

export interface SetResult {
  error?: string;
  set?: PlannedSet;
  revertedToDraft?: boolean;
}

export interface WorkoutResult {
  error?: string;
  workout?: { id: string; order_index: number; day_of_week: number };
}

const MAX_WORKOUTS_PER_DAY = 2;
const MAX_SETS_PER_EXERCISE = 20;

type Supabase = Awaited<ReturnType<typeof createClient>>;

/** A new exercise starts with sane, immediately-valid defaults: 3 working sets of 8-10. */
const DEFAULT_NEW_SETS = [1, 2, 3].map((n) => ({
  set_index: n,
  set_type: "working" as const,
  reps_min: 8,
  reps_max: 10,
}));

const HAS_HISTORY_ERROR =
  "למתאמן יש ביצוע מתועד כאן, ולכן אי אפשר למחוק. כדי לא לאבד היסטוריה, אפשר לערוך במקום למחוק.";

function validateExerciseFields(fields: WorkoutExerciseFields): string | null {
  if (fields.rest_seconds != null && (!Number.isFinite(fields.rest_seconds) || fields.rest_seconds < 0)) {
    return "זמן מנוחה לא תקין";
  }
  return null;
}

/**
 * Real validation, not just the inputs' HTML hints: every set needs a reps
 * target (a number, a range like 8-10, or a short note such as AMRAP), a
 * weight that's a number of kg or a short note, and an RPE within 1-10.
 * Mirrored by migration 0013's CHECK constraints as the backstop.
 */
function parseSetFields(
  fields: SetFields,
):
  | { error: string }
  | {
      values: {
        set_type: "warmup" | "working";
        reps_min: number | null;
        reps_max: number | null;
        reps_note: string | null;
        weight_kg: number | null;
        weight_note: string | null;
        rpe: number | null;
      };
    } {
  const reps = parseRepsInput(fields.reps ?? "");
  if ("error" in reps) return { error: reps.error };
  const weight = parseWeightInput(fields.weight ?? "");
  if ("error" in weight) return { error: weight.error };
  if (fields.rpe != null && (!Number.isFinite(fields.rpe) || fields.rpe < 1 || fields.rpe > 10)) {
    return { error: "RPE חייב להיות בין 1 ל-10" };
  }
  return {
    values: {
      set_type: fields.set_type === "warmup" ? "warmup" : "working",
      reps_min: reps.repsMin,
      reps_max: reps.repsMax,
      reps_note: reps.repsNote,
      weight_kg: weight.weightKg,
      weight_note: weight.weightNote,
      rpe: fields.rpe,
    },
  };
}

async function loadSets(supabase: Supabase, workoutExerciseId: string): Promise<PlannedSet[]> {
  const { data } = await supabase
    .from("workout_exercise_sets")
    .select(PLANNED_SET_COLUMNS)
    .eq("workout_exercise_id", workoutExerciseId)
    .order("set_index");
  return (data ?? []).map(toPlannedSet);
}

/**
 * Has the trainee recorded anything against these exercises? (QUESTIONS.md
 * Q1.4: deleting something with recorded performance is blocked, because
 * the "on delete cascade" chain from workout_exercises would silently
 * destroy that history.)
 */
async function hasRecordedHistory(supabase: Supabase, workoutExerciseIds: string[]): Promise<boolean> {
  if (workoutExerciseIds.length === 0) return false;
  const [{ count: setLogs }, { count: exerciseLogs }] = await Promise.all([
    supabase
      .from("set_logs")
      .select("id", { count: "exact", head: true })
      .in("workout_exercise_id", workoutExerciseIds),
    supabase
      .from("workout_logs")
      .select("id", { count: "exact", head: true })
      .in("workout_exercise_id", workoutExerciseIds),
  ]);
  return (setLogs ?? 0) > 0 || (exerciseLogs ?? 0) > 0;
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
  supabase: Supabase,
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

  // order_index isn't just "how many exist" — it's whichever of {0, 1} is
  // still free. Deleting the first of a day's two workouts and then adding
  // a new one used to assign it the surviving workout's own order_index
  // (both landed on order_index=1), a silent (day_of_week, order_index)
  // collision within the program: the "אימון N" numbering above showed two
  // workouts as "אימון 2", and duplicateProgramContents (programs/actions.ts),
  // which maps old->new workout ids by that exact composite key, would
  // silently mis-map or drop one side of the collision when a program in
  // that state was later duplicated into a new week.
  const { data: existingOnDay } = await supabase
    .from("workouts")
    .select("order_index")
    .eq("program_id", programId)
    .eq("day_of_week", dayOfWeek);

  const usedIndexes = new Set((existingOnDay ?? []).map((w) => w.order_index));
  if (usedIndexes.size >= MAX_WORKOUTS_PER_DAY) {
    return { error: `ניתן ליצור עד ${MAX_WORKOUTS_PER_DAY} אימונים ביום` };
  }
  const orderIndex = usedIndexes.has(0) ? 1 : 0;

  const { data: workout, error } = await supabase
    .from("workouts")
    .insert({ program_id: programId, day_of_week: dayOfWeek, order_index: orderIndex })
    .select("id, order_index, day_of_week")
    .single();

  if (error || !workout) {
    return { error: "שגיאה ביצירת האימון" };
  }

  revalidateBuilder(traineeId, programId);
  return { workout };
}

export interface MoveWorkoutResult {
  error?: string;
  workout?: { id: string; order_index: number; day_of_week: number };
  revertedToDraft?: boolean;
}

/**
 * Moves an existing workout (with all its exercises) to a different day.
 * Same free-slot logic as createWorkout: the moved workout takes whichever
 * of order_index {0, 1} is still free on the target day, so the
 * (day_of_week, order_index) pair never collides. The max-2-per-day DB
 * trigger (migration 0009) also fires on `update of day_of_week` as the
 * backstop. workout_logs/workout_completions reference the workout id, not
 * the day, so a trainee's history for this workout is untouched.
 */
export async function moveWorkoutToDay(
  traineeId: string,
  programId: string,
  workoutId: string,
  dayOfWeek: number,
): Promise<MoveWorkoutResult> {
  if (!Number.isInteger(dayOfWeek) || dayOfWeek < 0 || dayOfWeek > 6) {
    return { error: "יום לא תקין" };
  }

  const supabase = await createClient();

  const { data: current } = await supabase
    .from("workouts")
    .select("id, day_of_week, order_index")
    .eq("id", workoutId)
    .eq("program_id", programId)
    .single();
  if (!current) return { error: "האימון לא נמצא" };
  if (current.day_of_week === dayOfWeek) {
    return { workout: current };
  }

  const { data: existingOnDay } = await supabase
    .from("workouts")
    .select("order_index")
    .eq("program_id", programId)
    .eq("day_of_week", dayOfWeek)
    .neq("id", workoutId);

  const usedIndexes = new Set((existingOnDay ?? []).map((w) => w.order_index));
  if (usedIndexes.size >= MAX_WORKOUTS_PER_DAY) {
    return { error: `ניתן ליצור עד ${MAX_WORKOUTS_PER_DAY} אימונים ביום` };
  }
  const orderIndex = usedIndexes.has(0) ? 1 : 0;

  const { data: workout, error } = await supabase
    .from("workouts")
    .update({ day_of_week: dayOfWeek, order_index: orderIndex })
    .eq("id", workoutId)
    .select("id, order_index, day_of_week")
    .single();

  if (error || !workout) {
    return { error: "שגיאה בהעברת האימון" };
  }

  const revertedToDraft = await revertToDraftIfPublished(supabase, programId);
  revalidateBuilder(traineeId, programId);
  return { workout, revertedToDraft };
}

export async function deleteWorkout(
  traineeId: string,
  programId: string,
  workoutId: string,
): Promise<ActionResult> {
  const supabase = await createClient();

  const [{ data: exercises }, { count: completions }] = await Promise.all([
    supabase.from("workout_exercises").select("id").eq("workout_id", workoutId),
    supabase
      .from("workout_completions")
      .select("id", { count: "exact", head: true })
      .eq("workout_id", workoutId),
  ]);
  if (
    (completions ?? 0) > 0 ||
    (await hasRecordedHistory(supabase, (exercises ?? []).map((e) => e.id)))
  ) {
    return { error: HAS_HISTORY_ERROR };
  }

  const { error } = await supabase.from("workouts").delete().eq("id", workoutId);
  if (error) {
    return { error: "שגיאה במחיקת האימון" };
  }

  const revertedToDraft = await revertToDraftIfPublished(supabase, programId);
  revalidateBuilder(traineeId, programId);
  return { revertedToDraft };
}

/** Adds an exercise (with its default sets) to an existing workout, returning the created row. */
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
    .insert({ workout_id: workoutId, exercise_id: exerciseId, order_index: count ?? 0 })
    .select("id, workout_id, exercise_id, order_index, rest_seconds, instructions")
    .single();

  if (error || !row) {
    return { error: "שגיאה בהוספת התרגיל" };
  }

  const { data: sets, error: setsError } = await supabase
    .from("workout_exercise_sets")
    .insert(DEFAULT_NEW_SETS.map((set) => ({ ...set, workout_exercise_id: row.id })))
    .select(PLANNED_SET_COLUMNS)
    .order("set_index");

  if (setsError) {
    // Don't leave a set-less exercise behind (it couldn't be performed).
    await supabase.from("workout_exercises").delete().eq("id", row.id);
    return { error: "שגיאה בהוספת התרגיל" };
  }

  const revertedToDraft = await revertToDraftIfPublished(supabase, programId);
  revalidateBuilder(traineeId, programId);
  return { row: { ...row, sets: (sets ?? []).map(toPlannedSet) }, revertedToDraft };
}

/** Exercise-level fields only (rest, the per-program note). Sets have their own actions below. */
export async function updateWorkoutExercise(
  traineeId: string,
  programId: string,
  id: string,
  fields: WorkoutExerciseFields,
): Promise<ActionResult> {
  const validationError = validateExerciseFields(fields);
  if (validationError) {
    return { error: validationError };
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("workout_exercises")
    .update({
      rest_seconds: fields.rest_seconds,
      instructions: fields.instructions?.trim() || null,
    })
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

  if (await hasRecordedHistory(supabase, [id])) {
    return { error: HAS_HISTORY_ERROR };
  }

  const { error } = await supabase.from("workout_exercises").delete().eq("id", id);
  if (error) {
    return { error: "שגיאה במחיקה" };
  }

  const revertedToDraft = await revertToDraftIfPublished(supabase, programId);
  revalidateBuilder(traineeId, programId);
  return { revertedToDraft };
}

/** Copies an exercise row, sets included, to the end of the same workout. */
export async function duplicateWorkoutExercise(
  traineeId: string,
  programId: string,
  id: string,
): Promise<ActionResult> {
  const supabase = await createClient();
  const { data: original } = await supabase
    .from("workout_exercises")
    .select("workout_id, exercise_id, rest_seconds, instructions")
    .eq("id", id)
    .single();
  if (!original) return { error: "התרגיל לא נמצא" };

  const { count } = await supabase
    .from("workout_exercises")
    .select("id", { count: "exact", head: true })
    .eq("workout_id", original.workout_id);

  const { data: row, error } = await supabase
    .from("workout_exercises")
    .insert({ ...original, order_index: count ?? 0 })
    .select("id, workout_id, exercise_id, order_index, rest_seconds, instructions")
    .single();

  if (error || !row) {
    return { error: "שגיאה בשכפול" };
  }

  const sourceSets = await loadSets(supabase, id);
  const { data: sets, error: setsError } = await supabase
    .from("workout_exercise_sets")
    .insert(
      sourceSets.map((set) => ({
        workout_exercise_id: row.id,
        set_index: set.setIndex,
        set_type: set.setType,
        reps_min: set.repsMin,
        reps_max: set.repsMax,
        reps_note: set.repsNote,
        weight_kg: set.weightKg,
        weight_note: set.weightNote,
        rpe: set.rpe,
      })),
    )
    .select(PLANNED_SET_COLUMNS)
    .order("set_index");

  if (setsError) {
    await supabase.from("workout_exercises").delete().eq("id", row.id);
    return { error: "שגיאה בשכפול" };
  }

  const revertedToDraft = await revertToDraftIfPublished(supabase, programId);
  revalidateBuilder(traineeId, programId);
  return { row: { ...row, sets: (sets ?? []).map(toPlannedSet) }, revertedToDraft };
}

/** Appends a set, copying the last set's targets (the usual "one more of the same"). */
export async function addSet(
  traineeId: string,
  programId: string,
  workoutExerciseId: string,
): Promise<SetResult> {
  const supabase = await createClient();
  const sets = await loadSets(supabase, workoutExerciseId);
  if (sets.length >= MAX_SETS_PER_EXERCISE) {
    return { error: `אפשר עד ${MAX_SETS_PER_EXERCISE} סטים בתרגיל` };
  }
  const last = sets[sets.length - 1];

  const { data, error } = await supabase
    .from("workout_exercise_sets")
    .insert({
      workout_exercise_id: workoutExerciseId,
      set_index: (last?.setIndex ?? 0) + 1,
      set_type: "working",
      reps_min: last ? last.repsMin : 8,
      reps_max: last ? last.repsMax : 10,
      reps_note: last ? last.repsNote : null,
      weight_kg: last?.weightKg ?? null,
      weight_note: last?.weightNote ?? null,
      rpe: last?.rpe ?? null,
    })
    .select(PLANNED_SET_COLUMNS)
    .single();

  if (error || !data) {
    return { error: "שגיאה בהוספת סט" };
  }

  const revertedToDraft = await revertToDraftIfPublished(supabase, programId);
  revalidateBuilder(traineeId, programId);
  return { set: toPlannedSet(data), revertedToDraft };
}

export async function updateSet(
  traineeId: string,
  programId: string,
  setId: string,
  fields: SetFields,
): Promise<SetResult> {
  const parsed = parseSetFields(fields);
  if ("error" in parsed) {
    return { error: parsed.error };
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("workout_exercise_sets")
    .update(parsed.values)
    .eq("id", setId)
    .select(PLANNED_SET_COLUMNS)
    .single();

  if (error || !data) {
    return { error: "שגיאה בשמירת הסט" };
  }

  const revertedToDraft = await revertToDraftIfPublished(supabase, programId);
  revalidateBuilder(traineeId, programId);
  return { set: toPlannedSet(data), revertedToDraft };
}

/**
 * Removes a planned set and renumbers the ones after it (sets stay 1..n).
 * Refused when it's the only set, or when the trainee already logged this
 * set or a later one: renumbering would shift their logged sets onto
 * different targets (performed sets are matched by set_index).
 */
export async function deleteSet(
  traineeId: string,
  programId: string,
  setId: string,
): Promise<SetResult> {
  const supabase = await createClient();
  const { data: target } = await supabase
    .from("workout_exercise_sets")
    .select("id, workout_exercise_id, set_index")
    .eq("id", setId)
    .single();
  if (!target) return { error: "הסט לא נמצא" };

  const sets = await loadSets(supabase, target.workout_exercise_id);
  if (sets.length <= 1) {
    return { error: "לתרגיל חייב להיות לפחות סט אחד" };
  }

  const { count: laterLogs } = await supabase
    .from("set_logs")
    .select("id", { count: "exact", head: true })
    .eq("workout_exercise_id", target.workout_exercise_id)
    .gte("set_index", target.set_index);
  if ((laterLogs ?? 0) > 0) {
    return { error: HAS_HISTORY_ERROR };
  }

  const { error } = await supabase.from("workout_exercise_sets").delete().eq("id", setId);
  if (error) {
    return { error: "שגיאה במחיקת הסט" };
  }

  // Ascending order: each set moves into the slot just freed below it, so
  // the (workout_exercise_id, set_index) unique key never collides.
  for (const set of sets.filter((s) => s.setIndex > target.set_index)) {
    await supabase
      .from("workout_exercise_sets")
      .update({ set_index: set.setIndex - 1 })
      .eq("id", set.id);
  }

  const revertedToDraft = await revertToDraftIfPublished(supabase, programId);
  revalidateBuilder(traineeId, programId);
  return { revertedToDraft };
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
