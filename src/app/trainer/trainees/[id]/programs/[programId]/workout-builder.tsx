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
import { WorkoutExerciseRow, WorkoutExerciseRowReadOnly } from "./workout-exercise-row";
import { AddExercisePicker } from "./add-exercise-picker";
import type { PlannedSet } from "@/lib/sets";

interface CatalogExercise {
  id: string;
  name: string;
  muscle_group: string | null;
  equipment: string | null;
  media_url: string | null;
}

interface Item {
  /**
   * Stable identity for React's own reconciliation — set once and never
   * changed, unlike `id` below. Keeping these separate is what lets a
   * newly-added/duplicated row's temp-id get swapped for its real server
   * id without WorkoutExerciseRow remounting (and losing whatever the
   * trainer is mid-typing into it, e.g. notes) the moment that swap lands.
   */
  key: string;
  id: string;
  exerciseName: string;
  muscleGroup: string | null;
  fields: WorkoutExerciseFields;
  sets: PlannedSet[];
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
  readOnly = false,
}: {
  traineeId: string;
  programId: string;
  workoutId: string;
  /** Already-confirmed rows only — real ids, so `key` is just `id` for these. */
  initialItems: Omit<Item, "key">[];
  catalog: CatalogExercise[];
  onNewExercise?: (exercise: CatalogExercise) => void;
  onEdited?: () => void;
  /** The read-only superadmin viewer (migration 0011) — hides every mutation control, disables drag-reorder. */
  readOnly?: boolean;
}) {
  const [items, setItems] = useState<Item[]>(() =>
    initialItems.map((it) => ({ ...it, key: it.id })),
  );
  const [error, setError] = useState<string | null>(null);
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
        key: tempId,
        id: tempId,
        exerciseName: ex.name,
        muscleGroup: ex.muscle_group,
        // Matches addExerciseToWorkout's own defaults (3 working sets of
        // 8-10), so the row looks right while the server call is in flight.
        // The placeholder sets have temp ids and stay disabled until the
        // real row (and its real set ids) comes back below.
        fields: { rest_seconds: null, instructions: null },
        sets: [1, 2, 3].map((n) => ({
          id: `${tempId}-set-${n}`,
          setIndex: n,
          setType: "working" as const,
          repsMin: 8,
          repsMax: 10,
          repsNote: null,
          weightKg: null,
          weightNote: null,
          rpe: null,
        })),
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
        const row = result.row;
        setItems((prev) =>
          prev.map((it) =>
            it.id === tempId
              ? {
                  ...it,
                  id: row.id,
                  // Sync with whatever actually got saved, not just the id —
                  // the real set ids are needed to edit the sets at all.
                  fields: { rest_seconds: row.rest_seconds, instructions: row.instructions },
                  sets: row.sets,
                }
              : it,
          ),
        );
        if (result.revertedToDraft) onEdited?.();
      } else {
        setItems((prev) => prev.filter((it) => it.id !== tempId));
        setError(result.error ?? "שגיאה בהוספת התרגיל");
      }
    })();
  }

  function handleDelete(id: string) {
    const index = items.findIndex((it) => it.id === id);
    const removed = items[index];
    if (!removed) return;
    setItems((prev) => prev.filter((it) => it.id !== id));
    void (async () => {
      const result = await deleteWorkoutExercise(traineeId, programId, id);
      if (result.error) {
        // Refused (e.g. the trainee already logged this exercise) — put it
        // back where it was.
        setItems((prev) => [...prev.slice(0, index), removed, ...prev.slice(index)]);
        setError(result.error);
        return;
      }
      setError(null);
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
      {
        ...source,
        key: tempId,
        id: tempId,
        sets: source.sets.map((set) => ({ ...set, id: `${tempId}-set-${set.setIndex}` })),
      },
      ...prev.slice(index + 1),
    ]);

    void (async () => {
      const result = await duplicateWorkoutExercise(traineeId, programId, id);
      if (result.row) {
        const row = result.row;
        setItems((prev) =>
          prev.map((it) =>
            it.id === tempId
              ? {
                  ...it,
                  id: row.id,
                  fields: { rest_seconds: row.rest_seconds, instructions: row.instructions },
                  sets: row.sets,
                }
              : it,
          ),
        );
        if (result.revertedToDraft) onEdited?.();
      } else {
        setItems((prev) => prev.filter((it) => it.id !== tempId));
        setError(result.error ?? "שגיאה בשכפול");
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
      {error && (
        <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      )}
      {items.length === 0 ? (
        <p className="rounded-md border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
          {readOnly ? "אין תרגילים באימון הזה." : "אין עדיין תרגילים באימון הזה. הוסף תרגיל מהרשימה למטה."}
        </p>
      ) : readOnly ? (
        // No DndContext at all — nothing to reorder, and useSortable
        // requires one, so this renders the plain read-only row instead.
        <div>
          {items.map((it, i) => (
            <WorkoutExerciseRowReadOnly
              key={it.id}
              index={i}
              count={items.length}
              exerciseName={it.exerciseName}
              muscleGroup={it.muscleGroup}
              fields={it.fields}
              sets={it.sets}
            />
          ))}
        </div>
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
                  key={it.key}
                  traineeId={traineeId}
                  programId={programId}
                  id={it.id}
                  index={i}
                  count={items.length}
                  exerciseName={it.exerciseName}
                  muscleGroup={it.muscleGroup}
                  initialFields={it.fields}
                  initialSets={it.sets}
                  onDuplicate={() => handleDuplicate(it.id)}
                  onDelete={() => handleDelete(it.id)}
                  onEdited={onEdited}
                />
              ))}
            </div>
          </SortableContext>
        </DndContext>
      )}

      {!readOnly && <AddExercisePicker exercises={catalog} onAdd={handleAdd} />}
    </div>
  );
}
