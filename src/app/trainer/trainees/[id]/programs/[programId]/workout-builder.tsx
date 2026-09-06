"use client";

import { useRef, useState } from "react";
import {
  DndContext,
  PointerSensor,
  TouchSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import {
  addExerciseToWorkout,
  deleteWorkoutExercise,
  duplicateWorkoutExercise,
  reorderWorkoutExercises,
  type WorkoutExerciseFields,
} from "./actions";
import { WorkoutExerciseRow } from "./workout-exercise-row";
import { AddExercisePicker } from "./add-exercise-picker";

interface CatalogExercise {
  id: string;
  name: string;
  muscle_group: string | null;
  equipment: string | null;
  media_url: string | null;
}

interface Item {
  id: string;
  exerciseName: string;
  muscleGroup: string | null;
  fields: WorkoutExerciseFields;
}

/**
 * Owns one workout's exercise list as local state and updates it
 * immediately (optimistically) for every structural change — add,
 * delete, duplicate, drag-reorder — instead of calling router.refresh()
 * and waiting on a server round trip + re-render. Individual field edits
 * (sets/reps/...) live inside each WorkoutExerciseRow's own local state.
 *
 * onEdited fires on any change (including a field edit) so the parent can
 * flip the program's "פורסם" badge to "טיוטה" right away, mirroring the
 * server auto-reverting a published program to draft on any edit.
 */
export function WorkoutBuilder({
  traineeId,
  programId,
  workoutId,
  initialItems,
  catalog,
  onNewExercise,
  onEdited,
}: {
  traineeId: string;
  programId: string;
  workoutId: string;
  initialItems: Item[];
  catalog: CatalogExercise[];
  onNewExercise?: (exercise: CatalogExercise) => void;
  onEdited?: () => void;
}) {
  const [items, setItems] = useState(initialItems);
  const tempCounter = useRef(0);
  const nextTempId = () => `temp-${(tempCounter.current += 1)}`;

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 150, tolerance: 5 } }),
  );

  function handleAdd(exerciseId: string, newExercise?: CatalogExercise) {
    // A just-created exercise (from the picker's inline "add to library")
    // isn't in `catalog` yet — the parent hands it back via onNewExercise
    // for next time, but this call still needs it right now.
    const ex = catalog.find((c) => c.id === exerciseId) ?? newExercise;
    if (!ex) return;
    if (newExercise) onNewExercise?.(newExercise);

    const tempId = nextTempId();
    setItems((prev) => [
      ...prev,
      {
        id: tempId,
        exerciseName: ex.name,
        muscleGroup: ex.muscle_group,
        fields: {
          sets: 3,
          reps: null,
          weight: null,
          rpe: null,
          rest_seconds: null,
          instructions: null,
        },
      },
    ]);

    void (async () => {
      const result = await addExerciseToWorkout(
        traineeId,
        programId,
        workoutId,
        exerciseId,
      );
      if (result.row) {
        setItems((prev) =>
          prev.map((it) => (it.id === tempId ? { ...it, id: result.row!.id } : it)),
        );
        if (result.revertedToDraft) onEdited?.();
      } else {
        setItems((prev) => prev.filter((it) => it.id !== tempId));
      }
    })();
  }

  function handleDelete(id: string) {
    setItems((prev) => prev.filter((it) => it.id !== id));
    void (async () => {
      const result = await deleteWorkoutExercise(traineeId, programId, id);
      if (result.revertedToDraft) onEdited?.();
    })();
  }

  function handleDuplicate(id: string) {
    const index = items.findIndex((it) => it.id === id);
    const source = items[index];
    if (!source) return;

    const tempId = nextTempId();
    setItems((prev) => [
      ...prev.slice(0, index + 1),
      { ...source, id: tempId },
      ...prev.slice(index + 1),
    ]);

    void (async () => {
      const result = await duplicateWorkoutExercise(traineeId, programId, id);
      if (result.row) {
        setItems((prev) =>
          prev.map((it) => (it.id === tempId ? { ...it, id: result.row!.id } : it)),
        );
        if (result.revertedToDraft) onEdited?.();
      } else {
        setItems((prev) => prev.filter((it) => it.id !== tempId));
      }
    })();
  }

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    setItems((prev) => {
      const oldIndex = prev.findIndex((it) => it.id === active.id);
      const newIndex = prev.findIndex((it) => it.id === over.id);
      if (oldIndex === -1 || newIndex === -1) return prev;
      const next = arrayMove(prev, oldIndex, newIndex);

      void (async () => {
        const result = await reorderWorkoutExercises(
          traineeId,
          programId,
          next.map((it) => it.id),
        );
        if (result.revertedToDraft) onEdited?.();
      })();

      return next;
    });
  }

  return (
    <div className="space-y-4">
      {items.length === 0 ? (
        <p className="rounded-md border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
          אין עדיין תרגילים באימון הזה. הוסף תרגיל מהרשימה למטה.
        </p>
      ) : (
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={handleDragEnd}
        >
          <SortableContext
            items={items.map((it) => it.id)}
            strategy={verticalListSortingStrategy}
          >
            <div>
              {items.map((it, i) => (
                <WorkoutExerciseRow
                  key={it.id}
                  traineeId={traineeId}
                  programId={programId}
                  id={it.id}
                  index={i}
                  count={items.length}
                  exerciseName={it.exerciseName}
                  muscleGroup={it.muscleGroup}
                  initialFields={it.fields}
                  onDuplicate={() => handleDuplicate(it.id)}
                  onDelete={() => handleDelete(it.id)}
                  onEdited={onEdited}
                />
              ))}
            </div>
          </SortableContext>
        </DndContext>
      )}

      <AddExercisePicker exercises={catalog} onAdd={handleAdd} />
    </div>
  );
}
