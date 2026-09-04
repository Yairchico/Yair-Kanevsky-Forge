"use client";

import { useRef, useState } from "react";
import {
  addExerciseToDay,
  deleteWorkoutExercise,
  duplicateWorkoutExercise,
  moveWorkoutExercise,
  type WorkoutExerciseFields,
} from "./actions";
import { WorkoutExerciseRow } from "./workout-exercise-row";
import { AddExercisePicker } from "./add-exercise-picker";

interface CatalogExercise {
  id: string;
  name: string;
  muscle_group: string | null;
  equipment: string | null;
}

interface Item {
  id: string;
  exerciseName: string;
  muscleGroup: string | null;
  fields: WorkoutExerciseFields;
}

/**
 * Owns the current day's exercise list as local state and updates it
 * immediately (optimistically) for every structural change — add,
 * delete, duplicate, reorder — instead of calling router.refresh() and
 * waiting on a server round trip + re-render. Individual field edits
 * (sets/reps/...) live inside each WorkoutExerciseRow's own local state
 * and don't need to touch this list at all.
 *
 * Server actions still run (and revalidatePath keeps the server-rendered
 * truth in sync for the *next* real navigation), just not on the critical
 * path of what the trainer sees right now.
 */
export function DayBuilder({
  traineeId,
  programId,
  programDayId,
  initialWorkoutId,
  initialItems,
  catalog,
}: {
  traineeId: string;
  programId: string;
  programDayId: string;
  initialWorkoutId: string | null;
  initialItems: Item[];
  catalog: CatalogExercise[];
}) {
  const [workoutId, setWorkoutId] = useState(initialWorkoutId);
  const [items, setItems] = useState(initialItems);
  const tempCounter = useRef(0);
  const nextTempId = () => `temp-${(tempCounter.current += 1)}`;

  function handleAdd(exerciseId: string) {
    const ex = catalog.find((c) => c.id === exerciseId);
    if (!ex) return;

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
      const result = await addExerciseToDay(
        traineeId,
        programId,
        programDayId,
        exerciseId,
      );
      if (result.row) {
        setWorkoutId(result.row.workout_id);
        setItems((prev) =>
          prev.map((it) => (it.id === tempId ? { ...it, id: result.row!.id } : it)),
        );
      } else {
        setItems((prev) => prev.filter((it) => it.id !== tempId));
      }
    })();
  }

  function handleDelete(id: string) {
    setItems((prev) => prev.filter((it) => it.id !== id));
    void deleteWorkoutExercise(traineeId, programId, id);
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
      } else {
        setItems((prev) => prev.filter((it) => it.id !== tempId));
      }
    })();
  }

  function handleMove(id: string, direction: "up" | "down") {
    setItems((prev) => {
      const index = prev.findIndex((it) => it.id === id);
      const swapWith = direction === "up" ? index - 1 : index + 1;
      if (index === -1 || swapWith < 0 || swapWith >= prev.length) return prev;
      const next = [...prev];
      [next[index], next[swapWith]] = [next[swapWith], next[index]];
      return next;
    });
    if (workoutId) {
      void moveWorkoutExercise(traineeId, programId, workoutId, id, direction);
    }
  }

  return (
    <div className="space-y-4">
      {items.length === 0 ? (
        <p className="rounded-md border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
          אין עדיין תרגילים ליום הזה. הוסף תרגיל מהרשימה למטה.
        </p>
      ) : (
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
              onMove={(direction) => handleMove(it.id, direction)}
              onDuplicate={() => handleDuplicate(it.id)}
              onDelete={() => handleDelete(it.id)}
            />
          ))}
        </div>
      )}

      <AddExercisePicker exercises={catalog} onAdd={handleAdd} />
    </div>
  );
}
