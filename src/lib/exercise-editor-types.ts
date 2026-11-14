/**
 * Shared shapes for the exercise/set editor (src/components/exercise-editor)
 * and the Server Actions behind it. The same editor drives the weekly
 * program builder and the saved-workout (template) editor; each supplies
 * its own ExerciseListApi, so the UI — and its validation — exists once.
 *
 * A plain module on purpose: "use server" files can only export async
 * functions, so anything both sides need to name lives here.
 */

import type { PlannedSet } from "@/lib/sets";

export interface CatalogExercise {
  id: string;
  name: string;
  muscle_group: string | null;
  equipment: string | null;
  media_url: string | null;
  /** The exercise's permanent note (exercises.instructions). */
  instructions?: string | null;
}

/** Exercise-level fields of one row. */
export interface ExerciseFields {
  rest_seconds: number | null;
  /** A note for this program/template only. */
  instructions: string | null;
  /** Don't show the exercise's permanent note here (program builder only). */
  hide_library_note: boolean;
}

/** What the trainer edits on one planned set. reps/weight are raw text, parsed by src/lib/sets.ts. */
export interface SetFields {
  set_type: "warmup" | "working";
  reps: string;
  weight: string;
  rpe: number | null;
}

/** How an exercise's targets move from one block week to the next (training blocks, migration 0017). */
export interface ProgressionRule {
  type: "none" | "weight" | "reps" | "double";
  /** Weight step unit: fixed kg, or a percentage of the current weight. */
  unit: "kg" | "pct";
  stepKg: number | null;
  stepPct: number | null;
  repsStep: number | null;
  /** Double progression: add reps up to this many, then add weight and start over. */
  repsCap: number | null;
  /** 'actual' = only after the trainee hit the target; 'planned' = every week regardless. */
  basis: "actual" | "planned";
  /** Computed weights (percent steps, deloads) are rounded to a multiple of this. */
  roundingKg: number;
}

/** A saved exercise row as the editor needs it back from the server. */
export interface EditorRow extends ExerciseFields {
  id: string;
  exercise_id: string;
  sets: PlannedSet[];
  progression?: ProgressionRule;
}

export interface ExerciseResult {
  error?: string;
  row?: EditorRow;
  /** True when this edit just reverted a published program back to draft. */
  revertedToDraft?: boolean;
}

export interface SetResult {
  error?: string;
  set?: PlannedSet;
  revertedToDraft?: boolean;
}

/**
 * Everything the editor can do, supplied by whoever owns the rows. The two
 * optional members switch on the training-block UI (a progression rule per
 * exercise, and "manual override" badges on sets).
 */
export interface ExerciseListApi {
  addExercise(exerciseId: string): Promise<ExerciseResult>;
  deleteExercise(id: string): Promise<ExerciseResult>;
  duplicateExercise(id: string): Promise<ExerciseResult>;
  reorder(orderedIds: string[]): Promise<ExerciseResult>;
  updateFields(id: string, fields: ExerciseFields): Promise<ExerciseResult>;
  addSet(id: string): Promise<SetResult>;
  updateSet(setId: string, fields: SetFields): Promise<SetResult>;
  deleteSet(setId: string): Promise<SetResult>;
  updateProgression?(id: string, rule: ProgressionRule): Promise<ExerciseResult>;
  clearSetOverride?(setId: string): Promise<SetResult>;
}

export interface EditedInfo {
  revertedToDraft: boolean;
  /** The set of exercises/sets changed (vs. only their numbers). */
  structural: boolean;
}

export const DEFAULT_PROGRESSION: ProgressionRule = {
  type: "none",
  unit: "kg",
  stepKg: null,
  stepPct: null,
  repsStep: null,
  repsCap: null,
  basis: "actual",
  roundingKg: 2.5,
};
