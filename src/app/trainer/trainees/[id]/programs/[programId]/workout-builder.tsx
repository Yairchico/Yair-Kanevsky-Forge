"use client";

import { useMemo } from "react";
import {
  ExerciseListEditor,
  type InitialEditorItem,
} from "@/components/exercise-editor/exercise-list-editor";
import { ProgressionPanel } from "@/components/exercise-editor/progression-panel";
import {
  DEFAULT_PROGRESSION,
  type CatalogExercise,
  type EditedInfo,
  type ExerciseListApi,
} from "@/lib/exercise-editor-types";
import type { ProgressionInfo } from "@/lib/supabase/types";
import {
  addExerciseToWorkout,
  addSet,
  clearSetOverride,
  deleteSet,
  deleteWorkoutExercise,
  duplicateWorkoutExercise,
  reorderWorkoutExercises,
  updateProgression,
  updateSet,
  updateWorkoutExercise,
} from "./actions";

/**
 * One workout of a weekly program, edited with the shared exercise/set
 * editor (src/components/exercise-editor). This wrapper's whole job is to
 * say what "saving" means here: every editor operation becomes the matching
 * program-builder Server Action for this trainee/program/workout.
 */
export function WorkoutBuilder({
  traineeId,
  programId,
  workoutId,
  listId,
  initialItems,
  catalog,
  disabled = false,
  blockWeekIndex = null,
  progressionInfo,
  onNewExercise,
  onEdited,
  readOnly = false,
}: {
  traineeId: string;
  programId: string;
  workoutId: string;
  /** Stable for the lifetime of this workout on screen (unlike workoutId, which starts as a temp id). */
  listId: string;
  initialItems: InitialEditorItem[];
  catalog: CatalogExercise[];
  /** The workout itself is still being created — nothing can be added to it yet. */
  disabled?: boolean;
  /** This program is week N of a training block (migration 0017): progression rules and hand-set badges are on. */
  blockWeekIndex?: number | null;
  /** By workout_exercises.id: what the block's computation decided for this week. */
  progressionInfo?: Record<string, ProgressionInfo | null>;
  onNewExercise?: (exercise: CatalogExercise) => void;
  onEdited?: (info: EditedInfo) => void;
  /** The read-only superadmin viewer (migration 0011) — hides every mutation control, disables drag-reorder. */
  readOnly?: boolean;
}) {
  const api = useMemo<ExerciseListApi>(
    () => ({
      addExercise: (exerciseId) => addExerciseToWorkout(traineeId, programId, workoutId, exerciseId),
      deleteExercise: (id) => deleteWorkoutExercise(traineeId, programId, id),
      duplicateExercise: (id) => duplicateWorkoutExercise(traineeId, programId, id),
      reorder: (ids) => reorderWorkoutExercises(traineeId, programId, ids),
      updateFields: (id, fields) => updateWorkoutExercise(traineeId, programId, id, fields),
      addSet: (id) => addSet(traineeId, programId, id),
      updateSet: (setId, fields) => updateSet(traineeId, programId, setId, fields),
      deleteSet: (setId) => deleteSet(traineeId, programId, setId),
      updateProgression: (id, rule) => updateProgression(traineeId, programId, id, rule),
      clearSetOverride: (setId) => clearSetOverride(traineeId, programId, setId),
    }),
    [traineeId, programId, workoutId],
  );
  const inBlock = blockWeekIndex != null;

  return (
    <ExerciseListEditor
      listId={listId}
      api={api}
      initialItems={initialItems}
      catalog={catalog}
      allowHideLibraryNote
      // Week 1 of a block is the trainer's own numbers; from week 2 on a
      // set is either computed or set by hand.
      showOverrides={inBlock && blockWeekIndex > 1}
      renderFooter={
        inBlock
          ? (item, { replaceItem }) => (
              <ProgressionPanel
                rule={item.progression ?? DEFAULT_PROGRESSION}
                info={progressionInfo?.[item.id] ?? null}
                readOnly={readOnly || item.id.startsWith("temp-")}
                onSave={async (rule) => {
                  const result = await updateProgression(traineeId, programId, item.id, rule);
                  if (result.row) replaceItem(result.row);
                  return { error: result.error };
                }}
              />
            )
          : undefined
      }
      disabled={disabled}
      readOnly={readOnly}
      emptyText={
        readOnly ? "אין תרגילים באימון הזה." : "אין עדיין תרגילים באימון הזה. הוסף תרגיל מהרשימה למטה."
      }
      onNewExercise={onNewExercise}
      onEdited={onEdited}
    />
  );
}
