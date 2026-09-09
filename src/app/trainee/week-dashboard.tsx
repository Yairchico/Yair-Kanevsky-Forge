"use client";

import { CalendarClock, PartyPopper } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { addDays, dayName, parseDateKey } from "@/lib/week";

export interface WorkoutSummary {
  id: string;
  dayOfWeek: number;
  orderIndex: number;
  submitted: boolean;
  exerciseCount: number;
  doneCount: number;
}

/** "9.9" — matches the short numeric style already used elsewhere (formatWeekRange). */
function formatDayDate(date: Date): string {
  return `${date.getDate()}.${date.getMonth() + 1}`;
}

/**
 * The trainee home screen's "how am I doing this week" strip: a light
 * progress summary (workouts and exercises submitted vs. assigned, with a
 * one-line nudge that changes with progress) and a brief preview of
 * whatever's next — the earliest not-yet-submitted workout and its actual
 * calendar date, with a one-tap way to jump straight to it (skips having
 * to scan the tab row below). When every workout for the week is already
 * submitted, that card becomes a small celebration instead of a dead end.
 */
export function WeekDashboard({
  weekStartDate,
  workouts,
  onJumpToWorkout,
}: {
  weekStartDate: string;
  workouts: WorkoutSummary[];
  onJumpToWorkout: (workoutId: string) => void;
}) {
  const totalWorkouts = workouts.length;
  const doneWorkouts = workouts.filter((w) => w.submitted).length;
  const totalExercises = workouts.reduce((sum, w) => sum + w.exerciseCount, 0);
  const doneExercises = workouts.reduce((sum, w) => sum + w.doneCount, 0);

  const workoutPct = totalWorkouts > 0 ? Math.round((doneWorkouts / totalWorkouts) * 100) : 0;
  const exercisePct = totalExercises > 0 ? Math.round((doneExercises / totalExercises) * 100) : 0;

  const nextWorkout = [...workouts]
    .filter((w) => !w.submitted)
    .sort((a, b) => a.dayOfWeek - b.dayOfWeek || a.orderIndex - b.orderIndex)[0];

  const weekStart = parseDateKey(weekStartDate);

  function workoutLabel(w: WorkoutSummary): string {
    const sameDayCount = workouts.filter((x) => x.dayOfWeek === w.dayOfWeek).length;
    return sameDayCount > 1 ? `${dayName(w.dayOfWeek)} · אימון ${w.orderIndex + 1}` : dayName(w.dayOfWeek);
  }

  const message =
    totalWorkouts === 0
      ? null
      : doneWorkouts === totalWorkouts
        ? "השבוע הושלם, כל הכבוד! 💪"
        : doneWorkouts === 0
          ? "בואו נתחיל את השבוע 🚀"
          : "בדרך הנכונה, תמשיך/י כך!";

  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <Card>
        <CardContent className="space-y-3 p-4">
          <p className="text-sm font-semibold text-muted-foreground">התקדמות השבוע</p>

          <div className="space-y-1.5">
            <div className="flex items-center justify-between text-sm">
              <span>אימונים</span>
              <span className="font-medium">
                {doneWorkouts}/{totalWorkouts}
              </span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-muted">
              <div
                className="h-full rounded-full bg-primary transition-[width]"
                style={{ width: `${workoutPct}%` }}
              />
            </div>
          </div>

          {totalExercises > 0 && (
            <div className="space-y-1.5">
              <div className="flex items-center justify-between text-sm">
                <span>תרגילים</span>
                <span className="font-medium">
                  {doneExercises}/{totalExercises}
                </span>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full rounded-full bg-primary/60 transition-[width]"
                  style={{ width: `${exercisePct}%` }}
                />
              </div>
            </div>
          )}

          {message && <p className="text-sm text-muted-foreground">{message}</p>}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="flex flex-col gap-2.5 p-4">
          <p className="text-sm font-semibold text-muted-foreground">האימון הבא</p>

          {nextWorkout ? (
            <>
              <div className="flex items-center gap-2.5">
                <CalendarClock className="h-6 w-6 shrink-0 text-primary" />
                <div className="min-w-0">
                  <p className="truncate text-base font-medium">{workoutLabel(nextWorkout)}</p>
                  <p className="text-sm text-muted-foreground">
                    {formatDayDate(addDays(weekStart, nextWorkout.dayOfWeek))}
                  </p>
                </div>
              </div>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => onJumpToWorkout(nextWorkout.id)}
              >
                עבור לאימון
              </Button>
            </>
          ) : (
            <div className="flex items-center gap-2.5 text-success">
              <PartyPopper className="h-6 w-6 shrink-0" />
              <p className="text-base font-medium">כל האימונים הוגשו השבוע!</p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
