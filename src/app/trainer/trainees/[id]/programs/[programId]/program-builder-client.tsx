"use client";

import { useRef, useState, useTransition } from "react";
import { Plus, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { PublishToggle } from "./publish-toggle";
import { WorkoutBuilder } from "./workout-builder";
import { createWorkout, deleteWorkout } from "./actions";
import type { WorkoutExerciseFields } from "./actions";

const MAX_WORKOUTS = 10;

interface WorkoutData {
  id: string;
  orderIndex: number;
  items: {
    id: string;
    exerciseName: string;
    muscleGroup: string | null;
    fields: WorkoutExerciseFields;
  }[];
}

interface CatalogExercise {
  id: string;
  name: string;
  muscle_group: string | null;
  equipment: string | null;
}

/**
 * All of a program's workouts are fetched once by the server and handed
 * here, so switching between "אימון 1" / "אימון 2" is a local state
 * change — no server round trip. That used to be the slow part of the
 * builder (a Link with ?day=N triggering a full server re-render for
 * something as routine as looking at a different workout).
 */
export function ProgramBuilderClient({
  traineeId,
  programId,
  traineeName,
  initialIsPublished,
  workouts,
  catalog,
}: {
  traineeId: string;
  programId: string;
  traineeName: string;
  initialIsPublished: boolean;
  workouts: WorkoutData[];
  catalog: CatalogExercise[];
}) {
  const [isPublished, setIsPublished] = useState(initialIsPublished);
  const [workoutList, setWorkoutList] = useState(workouts);
  const [activeId, setActiveId] = useState(workoutList[0]?.id ?? null);
  const [pending, startTransition] = useTransition();
  const tempCounter = useRef(0);

  const activeWorkout = workoutList.find((w) => w.id === activeId) ?? workoutList[0];

  function handleEdited() {
    if (isPublished) setIsPublished(false);
  }

  function handleAddWorkout() {
    if (workoutList.length >= MAX_WORKOUTS) return;
    const tempId = `temp-workout-${(tempCounter.current += 1)}`;
    const optimistic: WorkoutData = {
      id: tempId,
      orderIndex: workoutList.length,
      items: [],
    };
    setWorkoutList((prev) => [...prev, optimistic]);
    setActiveId(tempId);

    startTransition(async () => {
      const result = await createWorkout(traineeId, programId);
      if (result.workout) {
        setWorkoutList((prev) =>
          prev.map((w) => (w.id === tempId ? { ...w, id: result.workout!.id } : w)),
        );
        setActiveId((cur) => (cur === tempId ? result.workout!.id : cur));
      } else {
        setWorkoutList((prev) => prev.filter((w) => w.id !== tempId));
        setActiveId((cur) => (cur === tempId ? (workoutList[0]?.id ?? null) : cur));
      }
    });
  }

  function handleDeleteWorkout(workoutId: string) {
    const index = workoutList.findIndex((w) => w.id === workoutId);
    const next = workoutList.filter((w) => w.id !== workoutId);
    setWorkoutList(next);
    if (activeId === workoutId) {
      setActiveId(next[Math.max(0, index - 1)]?.id ?? null);
    }
    startTransition(async () => {
      const result = await deleteWorkout(traineeId, programId, workoutId);
      if (result.revertedToDraft) handleEdited();
    });
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <span
            className={cn(
              "rounded-full px-2.5 py-1 text-xs font-medium",
              isPublished
                ? "bg-success/15 text-success"
                : "bg-warning/20 text-warning-foreground",
            )}
          >
            {isPublished ? "פורסם" : "טיוטה"}
          </span>
          <span className="text-sm text-muted-foreground">
            תוכנית עבור {traineeName}
          </span>
        </div>
        <PublishToggle
          traineeId={traineeId}
          programId={programId}
          isPublished={isPublished}
          onChange={setIsPublished}
        />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {workoutList.map((w, i) => (
          <div
            key={w.id}
            className={cn(
              "group flex shrink-0 items-center gap-1 rounded-full ps-3 pe-1.5 py-1 text-sm font-medium transition-colors",
              w.id === activeId
                ? "bg-primary text-primary-foreground"
                : "bg-secondary text-secondary-foreground hover:bg-muted",
            )}
          >
            <button type="button" onClick={() => setActiveId(w.id)}>
              אימון {i + 1}
            </button>
            <button
              type="button"
              onClick={() => handleDeleteWorkout(w.id)}
              aria-label={`מחק אימון ${i + 1}`}
              className={cn(
                "flex h-5 w-5 items-center justify-center rounded-full opacity-60 hover:opacity-100",
                w.id === activeId
                  ? "hover:bg-primary-foreground/20"
                  : "hover:bg-foreground/10",
              )}
            >
              <Trash2 className="h-3 w-3" />
            </button>
          </div>
        ))}

        {workoutList.length < MAX_WORKOUTS && (
          <button
            type="button"
            onClick={handleAddWorkout}
            disabled={pending}
            className="flex shrink-0 items-center gap-1 rounded-full border border-dashed border-border px-3 py-1.5 text-sm font-medium text-muted-foreground transition-colors hover:border-primary hover:text-primary"
          >
            <Plus className="h-3.5 w-3.5" />
            אימון חדש
          </button>
        )}
      </div>

      {!activeWorkout ? (
        <p className="rounded-md border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
          אין עדיין אימונים בתוכנית. לחץ &quot;אימון חדש&quot; כדי להתחיל.
        </p>
      ) : (
        <WorkoutBuilder
          key={activeWorkout.id}
          traineeId={traineeId}
          programId={programId}
          workoutId={activeWorkout.id}
          initialItems={activeWorkout.items}
          catalog={catalog}
          onEdited={handleEdited}
        />
      )}
    </div>
  );
}
