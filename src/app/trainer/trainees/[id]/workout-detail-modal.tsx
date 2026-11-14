"use client";

import { Check } from "lucide-react";
import { Modal } from "@/components/ui/modal";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { SetsTable } from "@/components/sets-table";
import { formatShortDateTime } from "@/lib/format";
import type { LoggedSet, PlannedSet } from "@/lib/sets";

export interface WorkoutDetailExercise {
  id: string;
  name: string;
  muscleGroup: string | null;
  plannedSets: PlannedSet[];
  /** Performed sets (migration 0013), excluding ones carried over from the old single-value logs. */
  loggedSets: LoggedSet[];
  restSeconds: number | null;
  instructions: string | null;
  done: boolean;
  /** The trainee's note on this exercise, from the submission. */
  note: string | null;
  /** The old one-value-per-exercise entry, when this was logged before sets were split. */
  legacyActual: string | null;
}

export interface WorkoutDetailData {
  id: string;
  dayOfWeek: number;
  orderIndex: number;
  submittedAt: string | null;
  /** Who submitted it: the trainee, or the trainer in a personal session (migration 0016). */
  submittedBy: "trainee" | "trainer_session" | null;
  /** The trainer's overall note from a personal session. */
  sessionNote: string | null;
  exercises: WorkoutDetailExercise[];
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
              הוגש · {formatShortDateTime(workout.submittedAt)}
            </span>
          ) : (
            <span className="rounded-full bg-secondary px-3 py-1 text-sm font-medium text-secondary-foreground">
              טרם הוגש
            </span>
          )}
          {workout.submittedBy === "trainer_session" && (
            <span className="rounded-full bg-primary/10 px-3 py-1 text-sm font-medium text-primary">
              אימון אישי עם המאמן
            </span>
          )}
          {workout.exercises.length > 0 && (
            <span className="text-sm text-muted-foreground">
              {workout.exercises.filter((ex) => ex.done).length}/{workout.exercises.length} תרגילים בוצעו
            </span>
          )}
        </div>

        {workout.sessionNote && (
          <p className="rounded-md bg-muted/60 px-3 py-2 text-sm whitespace-pre-line">
            <span className="text-muted-foreground">הערה כללית: </span>
            {workout.sessionNote}
          </p>
        )}

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
                  <div className="min-w-0 flex-1 space-y-1.5">
                    <div>
                      <p className="text-base font-medium">{ex.name}</p>
                      {ex.muscleGroup && (
                        <p className="text-sm text-muted-foreground">{ex.muscleGroup}</p>
                      )}
                    </div>
                    <SetsTable
                      planned={ex.plannedSets}
                      logged={ex.loggedSets}
                      mode={ex.legacyActual ? "targets" : "both"}
                    />
                    {ex.legacyActual && (
                      <p className="text-sm">
                        <span className="text-muted-foreground">בפועל (מלפני פיצול הסטים): </span>
                        {ex.legacyActual}
                      </p>
                    )}
                    {ex.instructions && (
                      <p className="text-sm text-muted-foreground">הנחיה: {ex.instructions}</p>
                    )}
                    {ex.note && (
                      <p className="text-sm">
                        <span className="text-muted-foreground">
                          {workout.submittedBy === "trainer_session" ? "הערה לתרגיל: " : "הערת המתאמן: "}
                        </span>
                        {ex.note}
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
