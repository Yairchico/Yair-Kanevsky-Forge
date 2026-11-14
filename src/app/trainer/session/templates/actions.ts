"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type {
  ExerciseFields,
  ExerciseResult,
  SetFields,
  SetResult,
} from "@/lib/exercise-editor-types";
import { NOT_TRAINER_ERROR, getTrainerContext } from "@/lib/require-trainer";
import {
  DEFAULT_NEW_SETS,
  parseSetFieldsInput,
  plannedSetValues,
  toPlannedSet,
  type PlannedSet,
} from "@/lib/sets";
import { isUuid } from "@/lib/utils";

/**
 * Saved workouts (planning/PLAN.md feature 5c): reusable templates for a
 * trainer-led session — a list of exercises with target sets, tied to no
 * trainee and no week. Edited with the same exercise/set editor as the
 * weekly program builder; the actions below are that editor's "save" for a
 * template (same validation, src/lib/sets.ts), plus the template's own
 * title/notes, duplicate and (soft) delete.
 *
 * Trainer only — RLS (migration 0016) enforces it, getTrainerContext() is
 * the readable early version.
 */

type Ctx = NonNullable<Awaited<ReturnType<typeof getTrainerContext>>>;

const TEMPLATE_SET_COLUMNS =
  "id, template_exercise_id, set_index, set_type, reps_min, reps_max, reps_note, weight_kg, weight_note, rpe";
const TEMPLATE_EXERCISE_COLUMNS = "id, template_id, exercise_id, order_index, rest_seconds, instructions";

const MAX_TITLE_LENGTH = 120;
const MAX_NOTES_LENGTH = 1000;
const MAX_TEMPLATE_EXERCISES = 40;
const MAX_SETS_PER_EXERCISE = 20;
const NOT_FOUND_ERROR = "האימון השמור לא נמצא";

function revalidateTemplates(templateId?: string) {
  revalidatePath("/trainer/session/templates");
  revalidatePath("/trainer/session");
  revalidatePath("/trainer");
  if (templateId) revalidatePath(`/trainer/session/templates/${templateId}`);
}

/** The template, if it exists and wasn't deleted. */
async function liveTemplate(ctx: Ctx, templateId: string) {
  if (!isUuid(templateId)) return null;
  const { data } = await ctx.supabase
    .from("session_templates")
    .select("id, title, notes")
    .eq("id", templateId)
    .is("deleted_at", null)
    .maybeSingle();
  return data;
}

/** A template exercise together with proof that it belongs to a live template. */
async function liveTemplateExercise(ctx: Ctx, templateExerciseId: string) {
  if (!isUuid(templateExerciseId)) return null;
  const { data: exercise } = await ctx.supabase
    .from("session_template_exercises")
    .select(TEMPLATE_EXERCISE_COLUMNS)
    .eq("id", templateExerciseId)
    .maybeSingle();
  if (!exercise) return null;
  return (await liveTemplate(ctx, exercise.template_id)) ? exercise : null;
}

async function loadSets(ctx: Ctx, templateExerciseId: string): Promise<PlannedSet[]> {
  const { data } = await ctx.supabase
    .from("session_template_sets")
    .select(TEMPLATE_SET_COLUMNS)
    .eq("template_exercise_id", templateExerciseId)
    .order("set_index");
  return (data ?? []).map(toPlannedSet);
}

/** The template editor has no "hide the permanent note" switch; the shared row shape still carries the field. */
function toEditorRow(
  row: { id: string; exercise_id: string; rest_seconds: number | null; instructions: string | null },
  sets: PlannedSet[],
) {
  return {
    id: row.id,
    exercise_id: row.exercise_id,
    rest_seconds: row.rest_seconds,
    instructions: row.instructions,
    hide_library_note: false,
    sets,
  };
}

function touch(ctx: Ctx, templateId: string) {
  return ctx.supabase
    .from("session_templates")
    .update({ updated_at: new Date().toISOString() })
    .eq("id", templateId);
}

// ---------------------------------------------------------------------------
// The template itself
// ---------------------------------------------------------------------------

export interface CreateTemplateState {
  error?: string;
}

/** "אימון שמור חדש": creates an empty template and opens its editor. */
export async function createTemplate(
  _prevState: CreateTemplateState,
  formData: FormData,
): Promise<CreateTemplateState> {
  const ctx = await getTrainerContext();
  if (!ctx) return { error: NOT_TRAINER_ERROR };

  const title = String(formData.get("title") ?? "").replace(/\s+/g, " ").trim();
  if (!title) return { error: "יש לתת שם לאימון השמור" };
  if (title.length > MAX_TITLE_LENGTH) return { error: `השם ארוך מדי (עד ${MAX_TITLE_LENGTH} תווים)` };

  const { data, error } = await ctx.supabase
    .from("session_templates")
    .insert({ title, created_by: ctx.user.id })
    .select("id")
    .single();
  if (error || !data) return { error: "שגיאה ביצירת האימון השמור" };

  revalidateTemplates();
  redirect(`/trainer/session/templates/${data.id}`);
}

export async function updateTemplateDetails(
  templateId: string,
  details: { title: string; notes: string | null },
): Promise<{ error?: string }> {
  const ctx = await getTrainerContext();
  if (!ctx) return { error: NOT_TRAINER_ERROR };
  if (!(await liveTemplate(ctx, templateId))) return { error: NOT_FOUND_ERROR };

  const title = (details.title ?? "").replace(/\s+/g, " ").trim();
  if (!title) return { error: "יש לתת שם לאימון השמור" };
  if (title.length > MAX_TITLE_LENGTH) return { error: `השם ארוך מדי (עד ${MAX_TITLE_LENGTH} תווים)` };
  const notes = details.notes?.replace(/\r\n/g, "\n").trim() || null;
  if (notes && notes.length > MAX_NOTES_LENGTH) return { error: `ההערה ארוכה מדי (עד ${MAX_NOTES_LENGTH} תווים)` };

  const { error } = await ctx.supabase.from("session_templates").update({ title, notes }).eq("id", templateId);
  if (error) return { error: "שגיאה בשמירה" };
  revalidateTemplates(templateId);
  return {};
}

/**
 * A soft delete: sessions that were started from the template keep saying
 * where they came from. Then back to the list — a redirect, so the editor
 * never re-renders for a template that's gone. Only returns on failure.
 */
export async function deleteTemplate(templateId: string): Promise<{ error: string }> {
  const ctx = await getTrainerContext();
  if (!ctx) return { error: NOT_TRAINER_ERROR };
  if (await liveTemplate(ctx, templateId)) {
    const { error } = await ctx.supabase
      .from("session_templates")
      .update({ deleted_at: new Date().toISOString() })
      .eq("id", templateId);
    if (error) return { error: "שגיאה במחיקה" };
    revalidateTemplates();
  }
  redirect("/trainer/session/templates");
}

export async function duplicateTemplate(templateId: string): Promise<{ error?: string; templateId?: string }> {
  const ctx = await getTrainerContext();
  if (!ctx) return { error: NOT_TRAINER_ERROR };
  if (!isUuid(templateId)) return { error: NOT_FOUND_ERROR };

  const { data, error } = await ctx.supabase.rpc("duplicate_session_template", { p_template_id: templateId });
  if (error || !data) return { error: error?.code === "P0002" ? NOT_FOUND_ERROR : "שגיאה בשכפול" };
  revalidateTemplates();
  return { templateId: data };
}

// ---------------------------------------------------------------------------
// Exercises and sets — the shared editor's ExerciseListApi for a template
// ---------------------------------------------------------------------------

export async function addTemplateExercise(templateId: string, exerciseId: string): Promise<ExerciseResult> {
  const ctx = await getTrainerContext();
  if (!ctx) return { error: NOT_TRAINER_ERROR };
  if (!(await liveTemplate(ctx, templateId))) return { error: NOT_FOUND_ERROR };
  if (!isUuid(exerciseId)) return { error: "התרגיל לא נמצא" };

  const { data: existing } = await ctx.supabase
    .from("session_template_exercises")
    .select("order_index")
    .eq("template_id", templateId);
  if ((existing?.length ?? 0) >= MAX_TEMPLATE_EXERCISES) {
    return { error: `אפשר עד ${MAX_TEMPLATE_EXERCISES} תרגילים באימון שמור` };
  }
  const nextOrder = Math.max(-1, ...(existing ?? []).map((e) => e.order_index)) + 1;

  const { data: row, error } = await ctx.supabase
    .from("session_template_exercises")
    .insert({ template_id: templateId, exercise_id: exerciseId, order_index: nextOrder })
    .select(TEMPLATE_EXERCISE_COLUMNS)
    .single();
  if (error || !row) return { error: "שגיאה בהוספת התרגיל" };

  const { data: sets, error: setsError } = await ctx.supabase
    .from("session_template_sets")
    .insert(DEFAULT_NEW_SETS.map((set) => ({ ...set, template_exercise_id: row.id })))
    .select(TEMPLATE_SET_COLUMNS)
    .order("set_index");
  if (setsError) {
    // Don't leave a set-less exercise behind.
    await ctx.supabase.from("session_template_exercises").delete().eq("id", row.id);
    return { error: "שגיאה בהוספת התרגיל" };
  }

  await touch(ctx, templateId);
  revalidateTemplates(templateId);
  return { row: toEditorRow(row, (sets ?? []).map(toPlannedSet)) };
}

export async function updateTemplateExercise(id: string, fields: ExerciseFields): Promise<ExerciseResult> {
  if (
    fields.rest_seconds != null &&
    (!Number.isInteger(fields.rest_seconds) || fields.rest_seconds < 0 || fields.rest_seconds > 3600)
  ) {
    return { error: "זמן מנוחה לא תקין" };
  }
  if (fields.instructions && fields.instructions.length > 1000) return { error: "ההערה ארוכה מדי" };

  const ctx = await getTrainerContext();
  if (!ctx) return { error: NOT_TRAINER_ERROR };
  const exercise = await liveTemplateExercise(ctx, id);
  if (!exercise) return { error: NOT_FOUND_ERROR };

  const { error } = await ctx.supabase
    .from("session_template_exercises")
    .update({ rest_seconds: fields.rest_seconds, instructions: fields.instructions?.trim() || null })
    .eq("id", id);
  if (error) return { error: "שגיאה בשמירה" };

  await touch(ctx, exercise.template_id);
  revalidateTemplates(exercise.template_id);
  return {};
}

export async function deleteTemplateExercise(id: string): Promise<ExerciseResult> {
  const ctx = await getTrainerContext();
  if (!ctx) return { error: NOT_TRAINER_ERROR };
  const exercise = await liveTemplateExercise(ctx, id);
  if (!exercise) return {};

  const { error } = await ctx.supabase.from("session_template_exercises").delete().eq("id", id);
  if (error) return { error: "שגיאה במחיקה" };
  await touch(ctx, exercise.template_id);
  revalidateTemplates(exercise.template_id);
  return {};
}

/** Copies an exercise row, sets included, to the end of the same template. */
export async function duplicateTemplateExercise(id: string): Promise<ExerciseResult> {
  const ctx = await getTrainerContext();
  if (!ctx) return { error: NOT_TRAINER_ERROR };
  const original = await liveTemplateExercise(ctx, id);
  if (!original) return { error: "התרגיל לא נמצא" };

  const { data: existing } = await ctx.supabase
    .from("session_template_exercises")
    .select("order_index")
    .eq("template_id", original.template_id);
  if ((existing?.length ?? 0) >= MAX_TEMPLATE_EXERCISES) {
    return { error: `אפשר עד ${MAX_TEMPLATE_EXERCISES} תרגילים באימון שמור` };
  }
  const nextOrder = Math.max(-1, ...(existing ?? []).map((e) => e.order_index)) + 1;

  const { data: row, error } = await ctx.supabase
    .from("session_template_exercises")
    .insert({
      template_id: original.template_id,
      exercise_id: original.exercise_id,
      order_index: nextOrder,
      rest_seconds: original.rest_seconds,
      instructions: original.instructions,
    })
    .select(TEMPLATE_EXERCISE_COLUMNS)
    .single();
  if (error || !row) return { error: "שגיאה בשכפול" };

  const sourceSets = await loadSets(ctx, id);
  const { data: sets, error: setsError } = await ctx.supabase
    .from("session_template_sets")
    .insert(
      sourceSets.map((set) => ({
        ...plannedSetValues(set),
        template_exercise_id: row.id,
        set_index: set.setIndex,
      })),
    )
    .select(TEMPLATE_SET_COLUMNS)
    .order("set_index");
  if (setsError) {
    await ctx.supabase.from("session_template_exercises").delete().eq("id", row.id);
    return { error: "שגיאה בשכפול" };
  }

  await touch(ctx, original.template_id);
  revalidateTemplates(original.template_id);
  return { row: toEditorRow(row, (sets ?? []).map(toPlannedSet)) };
}

/** Persists a reorder the client already applied. Only ids that belong to this template are touched. */
export async function reorderTemplateExercises(templateId: string, orderedIds: string[]): Promise<ExerciseResult> {
  const ctx = await getTrainerContext();
  if (!ctx) return { error: NOT_TRAINER_ERROR };
  if (!(await liveTemplate(ctx, templateId))) return { error: NOT_FOUND_ERROR };

  const ids = (orderedIds ?? []).filter(isUuid).slice(0, MAX_TEMPLATE_EXERCISES);
  await Promise.all(
    ids.map((id, index) =>
      ctx.supabase
        .from("session_template_exercises")
        .update({ order_index: index })
        .eq("id", id)
        .eq("template_id", templateId),
    ),
  );
  await touch(ctx, templateId);
  revalidateTemplates(templateId);
  return {};
}

/** Appends a set, copying the last set's targets (the usual "one more of the same"). */
export async function addTemplateSet(templateExerciseId: string): Promise<SetResult> {
  const ctx = await getTrainerContext();
  if (!ctx) return { error: NOT_TRAINER_ERROR };
  const exercise = await liveTemplateExercise(ctx, templateExerciseId);
  if (!exercise) return { error: NOT_FOUND_ERROR };

  const sets = await loadSets(ctx, templateExerciseId);
  if (sets.length >= MAX_SETS_PER_EXERCISE) return { error: `אפשר עד ${MAX_SETS_PER_EXERCISE} סטים בתרגיל` };
  const last = sets[sets.length - 1];

  const { data, error } = await ctx.supabase
    .from("session_template_sets")
    .insert({
      template_exercise_id: templateExerciseId,
      set_index: (last?.setIndex ?? 0) + 1,
      set_type: "working",
      reps_min: last ? last.repsMin : 8,
      reps_max: last ? last.repsMax : 10,
      reps_note: last ? last.repsNote : null,
      weight_kg: last?.weightKg ?? null,
      weight_note: last?.weightNote ?? null,
      rpe: last?.rpe ?? null,
    })
    .select(TEMPLATE_SET_COLUMNS)
    .single();
  if (error || !data) return { error: "שגיאה בהוספת סט" };

  await touch(ctx, exercise.template_id);
  revalidateTemplates(exercise.template_id);
  return { set: toPlannedSet(data) };
}

async function liveTemplateSet(ctx: Ctx, setId: string) {
  if (!isUuid(setId)) return null;
  const { data: set } = await ctx.supabase
    .from("session_template_sets")
    .select("id, template_exercise_id, set_index")
    .eq("id", setId)
    .maybeSingle();
  if (!set) return null;
  const exercise = await liveTemplateExercise(ctx, set.template_exercise_id);
  return exercise ? { set, exercise } : null;
}

export async function updateTemplateSet(setId: string, fields: SetFields): Promise<SetResult> {
  const parsed = parseSetFieldsInput(fields);
  if ("error" in parsed) return { error: parsed.error };

  const ctx = await getTrainerContext();
  if (!ctx) return { error: NOT_TRAINER_ERROR };
  const found = await liveTemplateSet(ctx, setId);
  if (!found) return { error: "הסט לא נמצא" };

  const { data, error } = await ctx.supabase
    .from("session_template_sets")
    .update(parsed.values)
    .eq("id", setId)
    .select(TEMPLATE_SET_COLUMNS)
    .single();
  if (error || !data) return { error: "שגיאה בשמירת הסט" };

  await touch(ctx, found.exercise.template_id);
  revalidateTemplates(found.exercise.template_id);
  return { set: toPlannedSet(data) };
}

/** Removes a set and renumbers the ones after it (sets stay 1..n). The last set can't be removed. */
export async function deleteTemplateSet(setId: string): Promise<SetResult> {
  const ctx = await getTrainerContext();
  if (!ctx) return { error: NOT_TRAINER_ERROR };
  const found = await liveTemplateSet(ctx, setId);
  if (!found) return { error: "הסט לא נמצא" };

  const sets = await loadSets(ctx, found.set.template_exercise_id);
  if (sets.length <= 1) return { error: "לתרגיל חייב להיות לפחות סט אחד" };

  const { error } = await ctx.supabase.from("session_template_sets").delete().eq("id", setId);
  if (error) return { error: "שגיאה במחיקת הסט" };

  // Ascending order: each set moves into the slot just freed below it, so
  // the (template_exercise_id, set_index) unique key never collides.
  for (const set of sets.filter((s) => s.setIndex > found.set.set_index)) {
    await ctx.supabase.from("session_template_sets").update({ set_index: set.setIndex - 1 }).eq("id", set.id);
  }

  await touch(ctx, found.exercise.template_id);
  revalidateTemplates(found.exercise.template_id);
  return {};
}
