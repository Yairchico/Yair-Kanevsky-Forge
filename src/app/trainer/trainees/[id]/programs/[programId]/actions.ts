"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import {
  DEFAULT_NEW_SETS,
  PLANNED_SET_COLUMNS,
  parseSetFieldsInput,
  plannedSetValues,
  toPlannedSet,
  type PlannedSet,
} from "@/lib/sets";
import type {
  ExerciseFields,
  ExerciseResult,
  ProgressionRule,
  SetFields,
  SetResult,
} from "@/lib/exercise-editor-types";
import { RULE_COLUMNS, blockErrorMessage, ruleFromRow, validateRule } from "@/lib/blocks";

const EXERCISE_ROW_COLUMNS = `id, workout_id, exercise_id, order_index, rest_seconds, instructions, hide_library_note, ${RULE_COLUMNS}`;

export type WorkoutExerciseFields = ExerciseFields;
export type { SetFields };
export type ActionResult = ExerciseResult;
export type { SetResult };

export interface WorkoutResult {
  error?: string;
  workout?: { id: string; order_index: number; day_of_week: number };
}

const MAX_WORKOUTS_PER_DAY = 2;
const MAX_SETS_PER_EXERCISE = 20;

type Supabase = Awaited<ReturnType<typeof createClient>>;

const HAS_HISTORY_ERROR =
  "למתאמן יש ביצוע מתועד כאן, ולכן אי אפשר למחוק. כדי לא לאבד היסטוריה, אפשר לערוך במקום למחוק.";

function validateExerciseFields(fields: WorkoutExerciseFields): string | null {
  if (
    fields.rest_seconds != null &&
    (!Number.isInteger(fields.rest_seconds) || fields.rest_seconds < 0 || fields.rest_seconds > 3600)
  ) {
    return "זמן מנוחה לא תקין";
  }
  if (fields.instructions && fields.instructions.length > 1000) {
    return "ההערה ארוכה מדי";
  }
  return null;
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

/** The training block this program is a week of, if it is one (migration 0017). */
async function blockWeekOf(
  supabase: Supabase,
  programId: string,
): Promise<{ blockId: string; weekIndex: number } | null> {
  const { data } = await supabase
    .from("programs")
    .select("block_id, block_week_index")
    .eq("id", programId)
    .maybeSingle();
  return data?.block_id && data.block_week_index != null
    ? { blockId: data.block_id, weekIndex: data.block_week_index }
    : null;
}

/** A block's later weeks follow this one: other weeks' pages (and the block page, and the trainee) changed too. */
function revalidateBlock(traineeId: string, blockId: string) {
  revalidatePath(`/trainer/trainees/${traineeId}/blocks/${blockId}`);
  revalidatePath("/trainer/trainees/[id]/programs/[programId]", "page");
  revalidatePath("/trainee");
  revalidatePath("/trainee/workouts");
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
    .select(EXERCISE_ROW_COLUMNS)
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
  return { row: { ...row, sets: (sets ?? []).map(toPlannedSet), progression: ruleFromRow(row) }, revertedToDraft };
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
      hide_library_note: fields.hide_library_note === true,
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
    .select("workout_id, exercise_id, rest_seconds, instructions, hide_library_note")
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
    .select(EXERCISE_ROW_COLUMNS)
    .single();

  if (error || !row) {
    return { error: "שגיאה בשכפול" };
  }

  const sourceSets = await loadSets(supabase, id);
  const { data: sets, error: setsError } = await supabase
    .from("workout_exercise_sets")
    .insert(
      sourceSets.map((set) => ({
        ...plannedSetValues(set),
        workout_exercise_id: row.id,
        set_index: set.setIndex,
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
  return { row: { ...row, sets: (sets ?? []).map(toPlannedSet), progression: ruleFromRow(row) }, revertedToDraft };
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
  const parsed = parseSetFieldsInput(fields);
  if ("error" in parsed) {
    return { error: parsed.error };
  }

  const supabase = await createClient();
  const { data: before } = await supabase
    .from("workout_exercise_sets")
    .select("workout_exercise_id, reps_min, reps_max, reps_note, weight_kg, weight_note")
    .eq("id", setId)
    .maybeSingle();
  if (!before) return { error: "הסט לא נמצא" };

  // Did the TARGET change (reps / weight), as opposed to only the type or RPE?
  const next = parsed.values;
  const sameNumber = (a: number | string | null, b: number | null) =>
    a == null || b == null ? a == null && b == null : Number(a) === b;
  const targetChanged =
    !sameNumber(before.reps_min, next.reps_min) ||
    !sameNumber(before.reps_max, next.reps_max) ||
    (before.reps_note ?? null) !== next.reps_note ||
    !sameNumber(before.weight_kg, next.weight_kg) ||
    (before.weight_note ?? null) !== next.weight_note;

  // In a training block a target typed by hand is the trainer's decision:
  // where the exercise's targets are computed from an earlier week, the set
  // is marked so the automatic progression never overwrites it (and the
  // weeks after it are computed FROM it). An exercise with nothing before
  // it in the block — all of week 1, or one added later — is the trainer's
  // own numbers to begin with; progression_info is what tells them apart.
  const block = targetChanged ? await blockWeekOf(supabase, programId) : null;
  let isComputed = false;
  if (block) {
    const { data: exercise } = await supabase
      .from("workout_exercises")
      .select("progression_info")
      .eq("id", before.workout_exercise_id)
      .maybeSingle();
    isComputed = exercise?.progression_info != null;
  }

  const { data, error } = await supabase
    .from("workout_exercise_sets")
    .update({
      ...next,
      // Whatever was hidden behind a rounded weight is replaced by what was typed.
      ...(targetChanged ? { weight_kg_exact: null } : {}),
      ...(isComputed ? { is_manual_override: true } : {}),
    })
    .eq("id", setId)
    .select(PLANNED_SET_COLUMNS)
    .single();

  if (error || !data) {
    return { error: "שגיאה בשמירת הסט" };
  }

  if (block) {
    await supabase.rpc("recompute_block", { p_block_id: block.blockId, p_from_index: block.weekIndex + 1 });
    revalidateBlock(traineeId, block.blockId);
  }

  const revertedToDraft = await revertToDraftIfPublished(supabase, programId);
  revalidateBuilder(traineeId, programId);
  return { set: toPlannedSet(data), revertedToDraft };
}

/**
 * Training blocks: how an exercise moves from this week to the next
 * ("+2.5 ק״ג", "+2.6%", "+חזרה", double progression). Applies to this week
 * and every later week of the block, and the later weeks are recomputed.
 * It doesn't change anything the trainee sees in THIS week, so a published
 * program stays published.
 */
export async function updateProgression(
  traineeId: string,
  programId: string,
  workoutExerciseId: string,
  rule: ProgressionRule,
): Promise<ActionResult> {
  const validated = validateRule(rule);
  if ("error" in validated) return { error: validated.error };
  const r = validated.rule;

  const supabase = await createClient();
  const { error } = await supabase.rpc("set_exercise_progression", {
    p_workout_exercise_id: workoutExerciseId,
    p_type: r.type,
    p_unit: r.unit,
    p_step_kg: r.stepKg,
    p_step_pct: r.stepPct,
    p_reps_step: r.repsStep,
    p_reps_cap: r.repsCap,
    p_basis: r.basis,
    p_rounding_kg: r.roundingKg,
  });
  if (error) return { error: blockErrorMessage(error, "שגיאה בשמירת הקפיצה") };

  const { data: row } = await supabase
    .from("workout_exercises")
    .select(EXERCISE_ROW_COLUMNS)
    .eq("id", workoutExerciseId)
    .single();
  if (!row) return { error: "התרגיל לא נמצא" };

  const block = await blockWeekOf(supabase, programId);
  if (block) revalidateBlock(traineeId, block.blockId);
  revalidateBuilder(traineeId, programId);
  return { row: { ...row, sets: await loadSets(supabase, workoutExerciseId), progression: ruleFromRow(row) } };
}

/** "שחזר לאוטומטי": a hand-set target goes back to following the block's computation. */
export async function clearSetOverride(
  traineeId: string,
  programId: string,
  setId: string,
): Promise<SetResult> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("clear_set_override", { p_set_id: setId });
  if (error) return { error: blockErrorMessage(error, "שגיאה בשחזור הסט") };

  const { data } = await supabase
    .from("workout_exercise_sets")
    .select(PLANNED_SET_COLUMNS)
    .eq("id", setId)
    .single();
  if (!data) return { error: "הסט לא נמצא" };

  const block = await blockWeekOf(supabase, programId);
  if (block) revalidateBlock(traineeId, block.blockId);
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
