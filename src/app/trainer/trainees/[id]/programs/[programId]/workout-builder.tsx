"use client";

import { useMemo, useRef } from "react";
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
import { useDeferredSync } from "@/lib/use-deferred-sync";
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

/** A few quiet seconds: long enough that the catch-up rarely lands between two edits. */
const BUILDER_SYNC_DELAY_MS = 5000;

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
  // The row-level saves below don't reload the page's data (the editor
  // already shows what was saved, and each of these reloads used to make
  // the next edit wait). One catch-up request follows a few quiet seconds
  // after the last save — see src/app/sync-actions.ts.
  const inFlight = useRef(0);
  const scheduleSync = useDeferredSync(BUILDER_SYNC_DELAY_MS, () => inFlight.current > 0);

  const api = useMemo<ExerciseListApi>(() => {
    async function saved<T>(action: Promise<T>): Promise<T> {
      inFlight.current += 1;
      try {
        return await action;
      } finally {
        inFlight.current -= 1;
        scheduleSync();
      }
    }
    return {
      addExercise: (exerciseId) => saved(addExerciseToWorkout(traineeId, programId, workoutId, exerciseId)),
      deleteExercise: (id) => saved(deleteWorkoutExercise(traineeId, programId, id)),
      duplicateExercise: (id) => saved(duplicateWorkoutExercise(traineeId, programId, id)),
      reorder: (ids) => saved(reorderWorkoutExercises(traineeId, programId, ids)),
      updateFields: (id, fields) => saved(updateWorkoutExercise(traineeId, programId, id, fields)),
      addSet: (id) => saved(addSet(traineeId, programId, id)),
      updateSet: (setId, fields) => saved(updateSet(traineeId, programId, setId, fields)),
      deleteSet: (setId) => saved(deleteSet(traineeId, programId, setId)),
      updateProgression: (id, rule) => saved(updateProgression(traineeId, programId, id, rule)),
      clearSetOverride: (setId) => saved(clearSetOverride(traineeId, programId, setId)),
    };
  }, [traineeId, programId, workoutId, scheduleSync]);
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
                  const result = await api.updateProgression!(item.id, rule);
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
