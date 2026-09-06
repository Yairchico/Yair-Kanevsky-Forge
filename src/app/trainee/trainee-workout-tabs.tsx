"use client";

import { useState } from "react";
import Link from "next/link";
import { History } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { formatWeight } from "@/lib/format";
import { getExerciseImage } from "@/lib/exercise-image";
import { ExercisePhoto } from "@/components/exercise-photo";
import { dayName } from "@/lib/week";
import {
  ExerciseCheckbox,
  PerformanceEntryFields,
  SubmitWorkoutButton,
} from "./workout-actions";
import type { LoggedPerformance, PerformanceEntry } from "./actions";
import {
  loadWorkoutDraft,
  saveWorkoutDraft,
  EMPTY_DRAFT_ENTRY,
  type WorkoutDraft,
  type WorkoutExerciseDraft,
} from "@/lib/workout-draft";

interface ExerciseData {
  id: string;
  name: string;
  muscleGroup: string | null;
  imageUrl: string | null;
  sets: number | null;
  reps: string | null;
  weight: string | null;
  rpe: number | null;
  restSeconds: number | null;
  instructions: string | null;
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
          <CardContent className="p-6 text-sm text-muted-foreground">
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
 * Owns one workout's performance-entry draft: initialized from
 * localStorage (falling back to the trainee's last logged values per
 * exercise), updated on every keystroke, and persisted right back to
 * localStorage so it survives a closed tab. There's no per-exercise save
 * anymore — SubmitWorkoutButton reads the whole draft at submit time and
 * writes it to the server in one batch.
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

  function updateEntry(exerciseId: string, next: WorkoutExerciseDraft) {
    setDraft((prev) => {
      const updated = { ...prev, [exerciseId]: next };
      saveWorkoutDraft(workout.id, updated);
      return updated;
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

  return (
    <>
      <div className="space-y-3">
        {workout.exercises.map((ex) => (
          <Card key={ex.id}>
            <CardContent className="flex items-start gap-3 p-4">
              <ExercisePhoto
                src={getExerciseImage({ name: ex.name, muscle_group: ex.muscleGroup, media_url: ex.imageUrl })}
                className="h-12 w-12 rounded-lg bg-primary/10"
              />
              <ExerciseCheckbox workoutExerciseId={ex.id} completed={ex.done} />
              <div className="min-w-0 flex-1">
                <p className="font-medium">{ex.name}</p>
                {ex.muscleGroup && (
                  <p className="text-xs text-muted-foreground">{ex.muscleGroup}</p>
                )}
                <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted-foreground">
                  {ex.sets != null && <span>{ex.sets} סטים</span>}
                  {ex.reps && <span>{ex.reps} חזרות</span>}
                  {ex.weight && <span>{formatWeight(ex.weight)}</span>}
                  {ex.rpe != null && <span>RPE {ex.rpe}</span>}
                  {ex.restSeconds != null && <span>{ex.restSeconds} שנ׳ מנוחה</span>}
                </div>
                {ex.instructions && <p className="mt-2 text-sm">{ex.instructions}</p>}
                <PerformanceEntryFields
                  value={draft[ex.id] ?? EMPTY_DRAFT_ENTRY}
                  onChange={(next) => updateEntry(ex.id, next)}
                />
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <SubmitWorkoutButton
        workoutId={workout.id}
        submitted={workout.submitted}
        getEntries={getEntries}
      />
    </>
  );
}
