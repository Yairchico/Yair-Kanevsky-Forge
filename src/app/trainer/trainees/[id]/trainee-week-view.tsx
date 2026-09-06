"use client";

import { useState } from "react";
import { Check } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { dayName, formatWeekLabel, formatWeekRange, parseDateKey } from "@/lib/week";
import { formatWeight } from "@/lib/format";

interface LoggedPerformance {
  weight: string | null;
  reps: string | null;
  rpe: number | null;
  notes: string | null;
  performedAt: string;
}

interface PlannedFields {
  sets: number | null;
  reps: string | null;
  weight: string | null;
  rpe: number | null;
  restSeconds: number | null;
}

interface ExerciseStatus {
  id: string;
  name: string;
  muscleGroup: string | null;
  planned: PlannedFields;
  done: boolean;
  log: LoggedPerformance | null;
}

interface WorkoutData {
  id: string;
  dayOfWeek: number;
  orderIndex: number;
  submittedAt: string | null;
  exercises: ExerciseStatus[];
}

interface WeekData {
  programId: string;
  title: string;
  status: "draft" | "published";
  weekStartDate: string;
  workouts: WorkoutData[];
}

function formatSubmittedAt(iso: string) {
  return new Date(iso).toLocaleString("he-IL", {
    day: "numeric",
    month: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/**
 * Read-only mirror of the trainee's own screen, from the trainer's side —
 * one level of tabs for the week, one for the workout within it. All data
 * for every week in range is fetched once by the server, so both levels
 * of tabs are a local state change, not a server round trip.
 */
export function TraineeWeekView({ weeks }: { weeks: WeekData[] }) {
  const [activeWeekIndex, setActiveWeekIndex] = useState(0);
  const [activeWorkoutIndex, setActiveWorkoutIndex] = useState(0);

  const week = weeks[activeWeekIndex];
  const workout = week?.workouts[activeWorkoutIndex];

  function selectWeek(index: number) {
    setActiveWeekIndex(index);
    setActiveWorkoutIndex(0);
  }

  return (
    <div className="space-y-3">
      <div className="flex gap-2 overflow-x-auto pb-1">
        {weeks.map((w, i) => {
          const weekStart = parseDateKey(w.weekStartDate);
          return (
            <button
              key={w.programId}
              type="button"
              onClick={() => selectWeek(i)}
              className={cn(
                "shrink-0 rounded-full px-3 py-1.5 text-start text-sm font-medium transition-colors",
                i === activeWeekIndex
                  ? "bg-primary text-primary-foreground"
                  : "bg-secondary text-secondary-foreground hover:bg-muted",
              )}
            >
              {formatWeekLabel(weekStart)}
              <span className="ms-1 opacity-70">{formatWeekRange(weekStart)}</span>
            </button>
          );
        })}
      </div>

      {week && (
        <>
          <div className="flex items-center justify-between gap-2">
            <span className="text-sm font-medium">{week.title}</span>
            <span
              className={cn(
                "rounded-full px-2.5 py-1 text-xs font-medium",
                week.status === "published"
                  ? "bg-success/15 text-success"
                  : "bg-warning/20 text-warning-foreground",
              )}
            >
              {week.status === "published" ? "פורסם" : "טיוטה"}
            </span>
          </div>

          {week.workouts.length === 0 ? (
            <p className="text-sm text-muted-foreground">אין אימונים בשבוע זה.</p>
          ) : (
            <>
              <div className="flex flex-wrap gap-2">
                {week.workouts.map((w, i) => {
                  const sameDayCount = week.workouts.filter(
                    (x) => x.dayOfWeek === w.dayOfWeek,
                  ).length;
                  const label =
                    sameDayCount > 1
                      ? `${dayName(w.dayOfWeek)} · אימון ${w.orderIndex + 1}`
                      : dayName(w.dayOfWeek);
                  return (
                    <button
                      key={w.id}
                      type="button"
                      onClick={() => setActiveWorkoutIndex(i)}
                      className={cn(
                        "shrink-0 rounded-full px-3 py-1.5 text-sm font-medium transition-colors",
                        i === activeWorkoutIndex
                          ? "bg-primary text-primary-foreground"
                          : w.submittedAt
                            ? "bg-success/15 text-success"
                            : "bg-secondary text-secondary-foreground hover:bg-muted",
                      )}
                    >
                      {label}
                    </button>
                  );
                })}
              </div>

              {workout && (
                <div className="space-y-2">
                  <div className="flex flex-wrap items-center gap-2">
                    {workout.submittedAt ? (
                      <span className="rounded-full bg-success/15 px-2.5 py-1 text-xs font-medium text-success">
                        הוגש · {formatSubmittedAt(workout.submittedAt)}
                      </span>
                    ) : (
                      <span className="rounded-full bg-secondary px-2.5 py-1 text-xs font-medium text-secondary-foreground">
                        טרם הוגש
                      </span>
                    )}
                    {workout.exercises.length > 0 && (
                      <span className="text-xs text-muted-foreground">
                        {workout.exercises.filter((ex) => ex.done).length}/
                        {workout.exercises.length} תרגילים בוצעו
                      </span>
                    )}
                  </div>

                  {workout.exercises.length === 0 ? (
                    <p className="text-sm text-muted-foreground">
                      אין תרגילים באימון זה.
                    </p>
                  ) : (
                    workout.exercises.map((ex) => (
                      <Card key={ex.id}>
                        <CardContent className="flex items-start gap-3 p-3">
                          <div
                            className={cn(
                              "mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full",
                              ex.done
                                ? "bg-success text-success-foreground"
                                : "border-2 border-border",
                            )}
                          >
                            {ex.done && <Check className="h-3.5 w-3.5" />}
                          </div>
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-sm font-medium">{ex.name}</p>
                            {ex.muscleGroup && (
                              <p className="text-xs text-muted-foreground">
                                {ex.muscleGroup}
                              </p>
                            )}
                            <p className="mt-1 text-xs text-muted-foreground">
                              מתוכנן:{" "}
                              {[
                                ex.planned.sets != null && `${ex.planned.sets} סטים`,
                                ex.planned.reps && `${ex.planned.reps} חזרות`,
                                formatWeight(ex.planned.weight),
                                ex.planned.rpe != null && `RPE ${ex.planned.rpe}`,
                              ]
                                .filter(Boolean)
                                .join(" · ") || "—"}
                            </p>
                            {ex.log && (
                              <p className="mt-0.5 text-xs text-primary">
                                בפועל (בהגשה):{" "}
                                {[
                                  ex.log.reps && `${ex.log.reps} חזרות`,
                                  formatWeight(ex.log.weight),
                                  ex.log.rpe != null && `RPE ${ex.log.rpe}`,
                                ]
                                  .filter(Boolean)
                                  .join(" · ") || "נרשם"}
                                {ex.log.notes && (
                                  <span className="text-muted-foreground"> — {ex.log.notes}</span>
                                )}
                              </p>
                            )}
                          </div>
                        </CardContent>
                      </Card>
                    ))
                  )}
                </div>
              )}
            </>
          )}
        </>
      )}
    </div>
  );
}
