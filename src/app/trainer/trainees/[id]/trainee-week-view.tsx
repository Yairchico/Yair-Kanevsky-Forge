"use client";

import { useState } from "react";
import { AlertTriangle, Check, Clock } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { addDays, dayName, formatWeekLabel, formatWeekRange, parseDateKey, toDateKey } from "@/lib/week";
import { WorkoutDetailModal, type WorkoutDetailData } from "./workout-detail-modal";

interface WeekData {
  programId: string;
  title: string;
  status: "draft" | "published";
  weekStartDate: string;
  workouts: WorkoutDetailData[];
}

type WorkoutStatus = "done" | "late" | "pending";

/** Done if submitted; otherwise late once the workout's own calendar day has passed, else still pending. */
function workoutStatus(weekStartDate: string, dayOfWeek: number, submittedAt: string | null): WorkoutStatus {
  if (submittedAt) return "done";
  const workoutDateKey = toDateKey(addDays(parseDateKey(weekStartDate), dayOfWeek));
  return workoutDateKey < toDateKey(new Date()) ? "late" : "pending";
}

const STATUS_CONFIG: Record<WorkoutStatus, { label: string; icon: typeof Check; className: string }> = {
  done: { label: "בוצע", icon: Check, className: "bg-success/15 text-success" },
  late: { label: "באיחור", icon: AlertTriangle, className: "bg-destructive/15 text-destructive" },
  pending: { label: "לא בוצע", icon: Clock, className: "bg-secondary text-secondary-foreground" },
};

/**
 * Read-only mirror of the trainee's own screen, from the trainer's side.
 * Week selection stays a row of tabs (there can be many weeks); within a
 * week, workouts are cards with a large, unambiguous status — "בוצע"
 * (submitted) / "באיחור" (its calendar day has already passed with no
 * submission) / "לא בוצע" (still upcoming) — rather than a small pill a
 * trainer would have to click through to find out. Clicking a card opens
 * WorkoutDetailModal with the full planned-vs-actual breakdown.
 */
export function TraineeWeekView({ weeks }: { weeks: WeekData[] }) {
  const [activeWeekIndex, setActiveWeekIndex] = useState(0);
  const [openWorkoutId, setOpenWorkoutId] = useState<string | null>(null);

  const week = weeks[activeWeekIndex];
  const openWorkout = week?.workouts.find((w) => w.id === openWorkoutId);

  function selectWeek(index: number) {
    setActiveWeekIndex(index);
    setOpenWorkoutId(null);
  }

  function workoutLabel(w: WorkoutDetailData) {
    const sameDayCount = week?.workouts.filter((x) => x.dayOfWeek === w.dayOfWeek).length ?? 1;
    return sameDayCount > 1 ? `${dayName(w.dayOfWeek)} · אימון ${w.orderIndex + 1}` : dayName(w.dayOfWeek);
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
            <p className="text-base text-muted-foreground">אין אימונים בשבוע זה.</p>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {week.workouts.map((w) => {
                const status = workoutStatus(week.weekStartDate, w.dayOfWeek, w.submittedAt);
                const config = STATUS_CONFIG[status];
                const StatusIcon = config.icon;
                const doneCount = w.exercises.filter((ex) => ex.done).length;
                return (
                  <Card
                    key={w.id}
                    role="button"
                    tabIndex={0}
                    onClick={() => setOpenWorkoutId(w.id)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        setOpenWorkoutId(w.id);
                      }
                    }}
                    className="cursor-pointer transition-shadow hover:shadow-sm"
                  >
                    <CardContent className="space-y-2.5 p-4">
                      <p className="text-base font-semibold">{workoutLabel(w)}</p>
                      <span
                        className={cn(
                          "inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-base font-bold",
                          config.className,
                        )}
                      >
                        <StatusIcon className="h-4 w-4" />
                        {config.label}
                      </span>
                      {w.exercises.length > 0 && (
                        <p className="text-sm text-muted-foreground">
                          {doneCount}/{w.exercises.length} תרגילים בוצעו
                        </p>
                      )}
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}
        </>
      )}

      {openWorkout && (
        <WorkoutDetailModal
          workout={openWorkout}
          label={workoutLabel(openWorkout)}
          onClose={() => setOpenWorkoutId(null)}
        />
      )}
    </div>
  );
}
