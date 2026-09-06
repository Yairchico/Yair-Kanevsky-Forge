"use client";

import { useRef, useState, useTransition } from "react";
import { Plus, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { dayName } from "@/lib/week";
import { Modal } from "@/components/ui/modal";
import { PublishToggle } from "./publish-toggle";
import { WorkoutBuilder } from "./workout-builder";
import { createWorkout, deleteWorkout } from "./actions";
import type { WorkoutExerciseFields } from "./actions";

const MAX_WORKOUTS_PER_DAY = 2;
const DAYS = [0, 1, 2, 3, 4, 5, 6];

interface WorkoutData {
  id: string;
  dayOfWeek: number;
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
  media_url: string | null;
}

function sortWorkouts(list: WorkoutData[]): WorkoutData[] {
  return [...list].sort((a, b) => a.dayOfWeek - b.dayOfWeek || a.orderIndex - b.orderIndex);
}

/**
 * All of a program's workouts are fetched once by the server and handed
 * here, so switching between workouts is a local state change — no server
 * round trip. That used to be the slow part of the builder (a Link with
 * ?day=N triggering a full server re-render for something as routine as
 * looking at a different workout).
 */
export function ProgramBuilderClient({
  traineeId,
  programId,
  traineeName,
  initialIsPublished,
  workouts,
  catalog,
  readOnly = false,
}: {
  traineeId: string;
  programId: string;
  traineeName: string;
  initialIsPublished: boolean;
  workouts: WorkoutData[];
  catalog: CatalogExercise[];
  /** The read-only superadmin viewer (migration 0011) — hides every mutation control. */
  readOnly?: boolean;
}) {
  const [isPublished, setIsPublished] = useState(initialIsPublished);
  const [workoutList, setWorkoutList] = useState(workouts);
  const [catalogList, setCatalogList] = useState(catalog);
  const [activeId, setActiveId] = useState(workoutList[0]?.id ?? null);
  const [dayPickerOpen, setDayPickerOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const tempCounter = useRef(0);

  const sorted = sortWorkouts(workoutList);
  const activeWorkout = sorted.find((w) => w.id === activeId) ?? sorted[0];

  function handleEdited() {
    if (isPublished) setIsPublished(false);
  }

  // A trainer creating a new exercise from inside one workout's picker
  // (add-exercise-picker.tsx's inline creation) should be able to find it
  // again from another workout's tab too, since WorkoutBuilder remounts
  // (key={activeWorkout.id}) with a fresh copy of catalog on every switch.
  function handleNewExercise(exercise: CatalogExercise) {
    setCatalogList((prev) => (prev.some((e) => e.id === exercise.id) ? prev : [...prev, exercise]));
  }

  function countOnDay(day: number) {
    return workoutList.filter((w) => w.dayOfWeek === day).length;
  }

  function handleAddWorkout(dayOfWeek: number) {
    setDayPickerOpen(false);
    if (countOnDay(dayOfWeek) >= MAX_WORKOUTS_PER_DAY) return;

    const tempId = `temp-workout-${(tempCounter.current += 1)}`;
    const optimistic: WorkoutData = {
      id: tempId,
      dayOfWeek,
      orderIndex: countOnDay(dayOfWeek),
      items: [],
    };
    setWorkoutList((prev) => [...prev, optimistic]);
    setActiveId(tempId);

    startTransition(async () => {
      const result = await createWorkout(traineeId, programId, dayOfWeek);
      if (result.workout) {
        setWorkoutList((prev) =>
          prev.map((w) => (w.id === tempId ? { ...w, id: result.workout!.id } : w)),
        );
        setActiveId((cur) => (cur === tempId ? result.workout!.id : cur));
      } else {
        setWorkoutList((prev) => prev.filter((w) => w.id !== tempId));
        setActiveId((cur) => (cur === tempId ? (sorted[0]?.id ?? null) : cur));
      }
    });
  }

  function handleDeleteWorkout(workoutId: string) {
    const index = sorted.findIndex((w) => w.id === workoutId);
    const next = workoutList.filter((w) => w.id !== workoutId);
    setWorkoutList(next);
    if (activeId === workoutId) {
      const nextSorted = sortWorkouts(next);
      setActiveId(nextSorted[Math.max(0, index - 1)]?.id ?? null);
    }
    startTransition(async () => {
      const result = await deleteWorkout(traineeId, programId, workoutId);
      if (result.revertedToDraft) handleEdited();
    });
  }

  const allDaysFull = DAYS.every((d) => countOnDay(d) >= MAX_WORKOUTS_PER_DAY);

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
        {!readOnly && (
          <PublishToggle
            traineeId={traineeId}
            programId={programId}
            isPublished={isPublished}
            onChange={setIsPublished}
          />
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {sorted.map((w) => {
          const sameDayCount = countOnDay(w.dayOfWeek);
          const label =
            sameDayCount > 1 ? `${dayName(w.dayOfWeek)} · אימון ${w.orderIndex + 1}` : dayName(w.dayOfWeek);
          return (
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
                {label}
              </button>
              {!readOnly && (
                <button
                  type="button"
                  onClick={() => handleDeleteWorkout(w.id)}
                  aria-label={`מחק ${label}`}
                  className={cn(
                    "flex h-5 w-5 items-center justify-center rounded-full opacity-60 hover:opacity-100",
                    w.id === activeId
                      ? "hover:bg-primary-foreground/20"
                      : "hover:bg-foreground/10",
                  )}
                >
                  <Trash2 className="h-3 w-3" />
                </button>
              )}
            </div>
          );
        })}

        {!readOnly && !allDaysFull && (
          <button
            type="button"
            onClick={() => setDayPickerOpen(true)}
            disabled={pending}
            className="flex shrink-0 items-center gap-1 rounded-full border border-dashed border-border px-3 py-1.5 text-sm font-medium text-muted-foreground transition-colors hover:border-primary hover:text-primary"
          >
            <Plus className="h-3.5 w-3.5" />
            אימון חדש
          </button>
        )}
      </div>

      {!readOnly && (
        <Modal open={dayPickerOpen} onClose={() => setDayPickerOpen(false)} title="בחר יום לאימון החדש">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {DAYS.map((day) => {
              const count = countOnDay(day);
              const full = count >= MAX_WORKOUTS_PER_DAY;
              return (
                <button
                  key={day}
                  type="button"
                  disabled={full}
                  onClick={() => handleAddWorkout(day)}
                  className={cn(
                    "flex flex-col items-center gap-0.5 rounded-lg border p-3 text-sm font-medium transition-colors",
                    full
                      ? "cursor-not-allowed border-border bg-muted text-muted-foreground/60"
                      : "border-border hover:border-primary hover:text-primary",
                  )}
                >
                  {dayName(day)}
                  <span className="text-xs font-normal text-muted-foreground">
                    {count}/{MAX_WORKOUTS_PER_DAY}
                  </span>
                </button>
              );
            })}
          </div>
        </Modal>
      )}

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
          catalog={catalogList}
          onNewExercise={handleNewExercise}
          onEdited={handleEdited}
          readOnly={readOnly}
        />
      )}
    </div>
  );
}
