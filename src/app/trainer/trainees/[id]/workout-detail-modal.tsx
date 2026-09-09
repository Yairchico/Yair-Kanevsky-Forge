"use client";

import { Check } from "lucide-react";
import { Modal } from "@/components/ui/modal";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
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

export interface WorkoutDetailExercise {
  id: string;
  name: string;
  muscleGroup: string | null;
  planned: PlannedFields;
  instructions: string | null;
  done: boolean;
  log: LoggedPerformance | null;
}

export interface WorkoutDetailData {
  id: string;
  dayOfWeek: number;
  orderIndex: number;
  submittedAt: string | null;
  exercises: WorkoutDetailExercise[];
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
 * The read-only workout-detail popup, opened by clicking a workout status
 * card in TraineeWeekView — everything that was previously shown inline
 * below the workout tabs (planned vs. actual per exercise), just relocated
 * into the same centered-modal pattern used elsewhere in the app and with
 * more legible type sizes.
 */
export function WorkoutDetailModal({
  workout,
  label,
  onClose,
}: {
  workout: WorkoutDetailData;
  /** Pre-disambiguated title, e.g. "יום ג׳ · אימון 2" when there are two workouts on the same day. */
  label: string;
  onClose: () => void;
}) {
  return (
    <Modal open onClose={onClose} title={label} className="max-w-lg">
      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          {workout.submittedAt ? (
            <span className="rounded-full bg-success/15 px-3 py-1 text-sm font-medium text-success">
              הוגש · {formatSubmittedAt(workout.submittedAt)}
            </span>
          ) : (
            <span className="rounded-full bg-secondary px-3 py-1 text-sm font-medium text-secondary-foreground">
              טרם הוגש
            </span>
          )}
          {workout.exercises.length > 0 && (
            <span className="text-sm text-muted-foreground">
              {workout.exercises.filter((ex) => ex.done).length}/{workout.exercises.length} תרגילים בוצעו
            </span>
          )}
        </div>

        {workout.exercises.length === 0 ? (
          <p className="text-base text-muted-foreground">אין תרגילים באימון זה.</p>
        ) : (
          <div className="space-y-2.5">
            {workout.exercises.map((ex) => (
              <Card key={ex.id}>
                <CardContent className="flex items-start gap-3 p-3.5">
                  <div
                    className={cn(
                      "mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full",
                      ex.done ? "bg-success text-success-foreground" : "border-2 border-border",
                    )}
                  >
                    {ex.done && <Check className="h-4 w-4" />}
                  </div>
                  <div className="min-w-0 flex-1 space-y-1">
                    <p className="text-base font-medium">{ex.name}</p>
                    {ex.muscleGroup && (
                      <p className="text-sm text-muted-foreground">{ex.muscleGroup}</p>
                    )}
                    <p className="text-sm text-muted-foreground">
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
                    {ex.instructions && <p className="text-sm">{ex.instructions}</p>}
                    {ex.log && (
                      <p className="text-sm text-primary">
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
            ))}
          </div>
        )}
      </div>
    </Modal>
  );
}
