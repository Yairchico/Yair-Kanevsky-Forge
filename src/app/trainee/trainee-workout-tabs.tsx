"use client";

import { useState } from "react";
import Link from "next/link";
import { History } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import {
  ExerciseCheckbox,
  PerformanceLogForm,
  SubmitWorkoutButton,
} from "./workout-actions";
import type { LoggedPerformance } from "./actions";

interface ExerciseData {
  id: string;
  name: string;
  muscleGroup: string | null;
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
          {workouts.map((w, i) => (
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
              אימון {i + 1}
            </button>
          ))}
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
        <>
          <div className="space-y-3">
            {activeWorkout.exercises.map((ex) => (
              <Card key={ex.id}>
                <CardContent className="flex items-start gap-3 p-4">
                  <ExerciseCheckbox workoutExerciseId={ex.id} completed={ex.done} />
                  <div className="min-w-0 flex-1">
                    <p className="font-medium">{ex.name}</p>
                    {ex.muscleGroup && (
                      <p className="text-xs text-muted-foreground">{ex.muscleGroup}</p>
                    )}
                    <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted-foreground">
                      {ex.sets != null && <span>{ex.sets} סטים</span>}
                      {ex.reps && <span>{ex.reps} חזרות</span>}
                      {ex.weight && <span>{ex.weight}</span>}
                      {ex.rpe != null && <span>RPE {ex.rpe}</span>}
                      {ex.restSeconds != null && <span>{ex.restSeconds} שנ׳ מנוחה</span>}
                    </div>
                    {ex.instructions && <p className="mt-2 text-sm">{ex.instructions}</p>}
                    <div className="mt-2">
                      <PerformanceLogForm workoutExerciseId={ex.id} initialLog={ex.initialLog} />
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>

          <SubmitWorkoutButton workoutId={activeWorkout.id} submitted={activeWorkout.submitted} />
        </>
      )}
    </div>
  );
}
