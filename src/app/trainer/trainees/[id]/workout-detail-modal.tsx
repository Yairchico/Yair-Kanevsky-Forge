"use client";

import { Check } from "lucide-react";
import { Modal } from "@/components/ui/modal";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import {
  SET_TYPE_LABEL,
  formatLoggedSet,
  formatSetTarget,
  isSetTargetMet,
  type LoggedSet,
  type PlannedSet,
} from "@/lib/sets";

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
  exercises: WorkoutDetailExercise[];
}

/**
 * Planned vs. performed, one row per set (planned sets first, then any
 * extras the trainee added). `targetsOnly` drops the performed columns —
 * for an exercise logged before sets were split, whose single old value is
 * shown separately, so its sets don't each read "לא בוצע".
 */
function SetsTable({
  planned,
  logged,
  targetsOnly = false,
}: {
  planned: PlannedSet[];
  logged: LoggedSet[];
  targetsOnly?: boolean;
}) {
  const plannedByIndex = new Map(planned.map((s) => [s.setIndex, s]));
  const loggedByIndex = new Map(logged.map((s) => [s.setIndex, s]));
  const indexes = [...new Set([...plannedByIndex.keys(), ...loggedByIndex.keys()])].sort((a, b) => a - b);
  if (indexes.length === 0) return null;

  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="text-[11px] text-muted-foreground">
          <th className="w-8 pb-0.5 text-center font-normal">סט</th>
          <th className="pb-0.5 text-start font-normal">יעד</th>
          {!targetsOnly && <th className="pb-0.5 text-start font-normal">בפועל</th>}
          {!targetsOnly && <th className="w-14 pb-0.5" />}
        </tr>
      </thead>
      <tbody>
        {indexes.map((index) => {
          const target = plannedByIndex.get(index);
          const log = loggedByIndex.get(index);
          const met = log ? isSetTargetMet(target, log) : false;
          return (
            <tr key={index} className="border-t border-border">
              <td className="py-1 text-center text-xs font-bold text-muted-foreground">{index}</td>
              <td className="py-1">
                <span dir="ltr">{target ? formatSetTarget(target) : "—"}</span>
                {target?.setType === "warmup" && (
                  <span className="ms-1 text-[11px] text-muted-foreground">({SET_TYPE_LABEL.warmup})</span>
                )}
                {!target && <span className="ms-1 text-[11px] text-muted-foreground">(סט נוסף)</span>}
              </td>
              {!targetsOnly && (
                <td className="py-1 font-medium">
                  {log ? <span dir="ltr">{formatLoggedSet(log)}</span> : <span className="text-muted-foreground">—</span>}
                  {log?.rpe != null && <span className="ms-1 text-[11px] text-muted-foreground">RPE {log.rpe}</span>}
                </td>
              )}
              {!targetsOnly && (
                <td
                  className={cn(
                    "py-1 text-xs",
                    !log ? "text-muted-foreground" : met ? "text-success" : "text-warning-foreground",
                  )}
                >
                  {!log ? "לא בוצע" : met ? "✓" : "פחות מהיעד"}
                </td>
              )}
            </tr>
          );
        })}
      </tbody>
    </table>
  );
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
                      targetsOnly={Boolean(ex.legacyActual)}
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
                        <span className="text-muted-foreground">הערת המתאמן: </span>
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
