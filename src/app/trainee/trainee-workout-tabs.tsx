"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { Check, ChevronLeft, History } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { getExerciseImage } from "@/lib/exercise-image";
import { ExerciseThumbnail } from "@/components/exercise-photo";
import { dayName } from "@/lib/week";
import { Toast, useToast } from "@/components/toast";
import { SubmitWorkoutButton } from "./workout-actions";
import { toggleExerciseCompletion } from "./actions";
import type { LoggedPerformance, PerformanceEntry } from "./actions";
import { TraineeExerciseModal, type TraineeExerciseData } from "./trainee-exercise-modal";
import {
  loadWorkoutDraft,
  saveWorkoutDraft,
  EMPTY_DRAFT_ENTRY,
  type WorkoutDraft,
  type WorkoutExerciseDraft,
} from "@/lib/workout-draft";

interface ExerciseData extends TraineeExerciseData {
  done: boolean;
  initialLog: LoggedPerformance | null;
}

interface WorkoutData {
  id: string;
  dayOfWeek: number;
  orderIndex: number;
  submitted: boolean;
  exercises: ExerciseData[];
}

/**
 * All of the current week's workouts are fetched once by the server (see
 * page.tsx) and handed here, so switching between "אימון 1" / "אימון 2" is
 * a local state change — no server round trip. That used to be a `<Link
 * href="/trainee?workout=N">`, i.e. a full server re-render just to look
 * at a different workout, which is exactly what made it feel slow.
 */
export function TraineeWorkoutTabs({ workouts }: { workouts: WorkoutData[] }) {
  const [activeId, setActiveId] = useState(workouts[0]?.id ?? null);
  const activeWorkout = workouts.find((w) => w.id === activeId) ?? workouts[0];

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <div className="flex gap-2 overflow-x-auto pb-1">
          {workouts.map((w) => {
            const sameDayCount = workouts.filter((x) => x.dayOfWeek === w.dayOfWeek).length;
            const label =
              sameDayCount > 1
                ? `${dayName(w.dayOfWeek)} · אימון ${w.orderIndex + 1}`
                : dayName(w.dayOfWeek);
            return (
              <button
                key={w.id}
                type="button"
                onClick={() => setActiveId(w.id)}
                className={cn(
                  "shrink-0 rounded-full px-3 py-1.5 text-sm font-medium transition-colors",
                  w.id === activeWorkout?.id
                    ? "bg-primary text-primary-foreground"
                    : w.submitted
                      ? "bg-success/15 text-success"
                      : "bg-secondary text-secondary-foreground hover:bg-muted",
                )}
              >
                {label}
              </button>
            );
          })}
        </div>
        <Link
          href="/trainee/history"
          className="flex shrink-0 items-center gap-1 rounded-full px-3 py-1.5 text-sm text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          <History className="h-4 w-4" />
          היסטוריה
        </Link>
      </div>

      {!activeWorkout || activeWorkout.exercises.length === 0 ? (
        <Card>
          <CardContent className="p-6 text-base text-muted-foreground">
            אין תרגילים באימון הזה.
          </CardContent>
        </Card>
      ) : (
        // Keyed by workout id so switching tabs remounts this panel — its
        // draft state is reloaded fresh from localStorage for whichever
        // workout is now active, rather than one panel juggling every
        // workout's draft at once.
        <WorkoutPanel key={activeWorkout.id} workout={activeWorkout} />
      )}
    </div>
  );
}

/**
 * Owns one workout's performance-entry draft (localStorage, survives a
 * closed tab — see src/lib/workout-draft.ts) and its per-exercise "done"
 * state. The exercise list itself is just clickable name cards; all the
 * actual detail (the trainer's guidance, the exercise's image/description,
 * the performance fields, and the "done" toggle) lives in
 * TraineeExerciseModal, opened per exercise. There's no per-exercise
 * "save" to the server — SubmitWorkoutButton reads the whole draft at
 * submit time and writes it in one batch.
 */
function WorkoutPanel({ workout }: { workout: WorkoutData }) {
  const [draft, setDraft] = useState<WorkoutDraft>(() => {
    const stored = loadWorkoutDraft(workout.id);
    const initial: WorkoutDraft = {};
    for (const ex of workout.exercises) {
      initial[ex.id] = stored[ex.id] ?? {
        weight: ex.initialLog?.weight ?? "",
        reps: ex.initialLog?.reps ?? "",
        rpe: ex.initialLog?.rpe != null ? String(ex.initialLog.rpe) : "",
        notes: ex.initialLog?.notes ?? "",
      };
    }
    return initial;
  });

  const [doneMap, setDoneMap] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(workout.exercises.map((ex) => [ex.id, ex.done])),
  );
  const [, startDoneTransition] = useTransition();

  const [openExerciseId, setOpenExerciseId] = useState<string | null>(null);
  const toast = useToast();

  function updateEntry(exerciseId: string, next: WorkoutExerciseDraft) {
    setDraft((prev) => {
      const updated = { ...prev, [exerciseId]: next };
      saveWorkoutDraft(workout.id, updated);
      return updated;
    });
  }

  function toggleDone(exerciseId: string, next: boolean) {
    setDoneMap((prev) => ({ ...prev, [exerciseId]: next }));
    startDoneTransition(() => {
      void toggleExerciseCompletion(exerciseId, next);
    });
  }

  function getEntries(): PerformanceEntry[] {
    return workout.exercises.map((ex) => {
      const d = draft[ex.id] ?? EMPTY_DRAFT_ENTRY;
      return {
        workoutExerciseId: ex.id,
        weight: d.weight.trim() || null,
        reps: d.reps.trim() || null,
        rpe: d.rpe.trim() ? Number(d.rpe) : null,
        notes: d.notes.trim() || null,
      };
    });
  }

  const openExercise = openExerciseId
    ? workout.exercises.find((ex) => ex.id === openExerciseId)
    : undefined;

  return (
    <>
      <div className="space-y-2.5">
        {workout.exercises.map((ex) => {
          const done = doneMap[ex.id] ?? false;
          return (
            <Card
              key={ex.id}
              role="button"
              tabIndex={0}
              onClick={() => setOpenExerciseId(ex.id)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  setOpenExerciseId(ex.id);
                }
              }}
              className={cn(
                "cursor-pointer transition-shadow hover:shadow-sm",
                done && "border-success/40 bg-success/5",
              )}
            >
              <CardContent className="flex items-center gap-3 p-4">
                <ExerciseThumbnail
                  src={getExerciseImage({
                    name: ex.name,
                    muscle_group: ex.muscleGroup,
                    media_url: ex.imageUrl,
                  })}
                  className="h-12 w-12 rounded-lg bg-primary/10"
                />
                <div
                  className={cn(
                    "flex h-7 w-7 shrink-0 items-center justify-center rounded-full border-2",
                    done ? "border-success bg-success text-success-foreground" : "border-border text-transparent",
                  )}
                >
                  <Check className="h-4 w-4" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-base font-medium">{ex.name}</p>
                  {ex.muscleGroup && (
                    <p className="text-sm text-muted-foreground">{ex.muscleGroup}</p>
                  )}
                </div>
                <ChevronLeft className="h-5 w-5 shrink-0 text-muted-foreground" />
              </CardContent>
            </Card>
          );
        })}
      </div>

      <SubmitWorkoutButton workoutId={workout.id} submitted={workout.submitted} getEntries={getEntries} />

      {openExercise && (
        <TraineeExerciseModal
          exercise={openExercise}
          done={doneMap[openExercise.id] ?? false}
          draft={draft[openExercise.id] ?? EMPTY_DRAFT_ENTRY}
          onDraftChange={(next) => updateEntry(openExercise.id, next)}
          onToggleDone={(next) => toggleDone(openExercise.id, next)}
          onClose={() => setOpenExerciseId(null)}
          onToast={toast.show}
        />
      )}

      <Toast message={toast.message} />
    </>
  );
}
