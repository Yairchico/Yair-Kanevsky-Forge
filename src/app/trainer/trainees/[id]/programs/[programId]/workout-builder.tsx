"use client";

import { useMemo } from "react";
import {
  ExerciseListEditor,
  type InitialEditorItem,
} from "@/components/exercise-editor/exercise-list-editor";
import type {
  CatalogExercise,
  EditedInfo,
  ExerciseListApi,
} from "@/lib/exercise-editor-types";
import {
  addExerciseToWorkout,
  addSet,
  deleteSet,
  deleteWorkoutExercise,
  duplicateWorkoutExercise,
  reorderWorkoutExercises,
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
    }),
    [traineeId, programId, workoutId],
  );

  return (
    <ExerciseListEditor
      listId={listId}
      api={api}
      initialItems={initialItems}
      catalog={catalog}
      allowHideLibraryNote
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
