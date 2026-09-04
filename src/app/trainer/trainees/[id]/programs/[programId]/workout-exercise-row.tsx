"use client";

import { useState } from "react";
import { ChevronDown, ChevronUp, Copy, Trash2 } from "lucide-react";
import { updateWorkoutExercise, type WorkoutExerciseFields } from "./actions";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

function MiniField({
  label,
  className,
  ...props
}: {
  label: string;
  className?: string;
} & React.ComponentProps<"input">) {
  return (
    <label className={cn("flex flex-col gap-0.5", className)}>
      <span className="text-[10px] leading-none text-muted-foreground">
        {label}
      </span>
      <Input className="h-8 px-2 text-sm" {...props} />
    </label>
  );
}

/**
 * A compact "flow" node: numbered badge + connecting line on the side, a
 * small card with the exercise name and one tight row of fields. Kept
 * deliberately small so a whole day's list stays scannable — this used to
 * be a much taller grid-of-5 card.
 *
 * Field edits save themselves (local state, save on blur — no page
 * refresh). Structural changes (move/duplicate/delete) are reported to
 * the parent DayBuilder via callbacks, which updates its local list
 * immediately instead of waiting on a server round trip.
 */
export function WorkoutExerciseRow({
  traineeId,
  programId,
  id,
  index,
  count,
  exerciseName,
  muscleGroup,
  initialFields,
  onMove,
  onDuplicate,
  onDelete,
}: {
  traineeId: string;
  programId: string;
  id: string;
  index: number;
  count: number;
  exerciseName: string;
  muscleGroup: string | null;
  initialFields: WorkoutExerciseFields;
  onMove: (direction: "up" | "down") => void;
  onDuplicate: () => void;
  onDelete: () => void;
}) {
  const [fields, setFields] = useState(initialFields);

  function save(next: WorkoutExerciseFields) {
    setFields(next);
    void updateWorkoutExercise(traineeId, programId, id, next);
  }

  const iconBtn =
    "flex h-6 w-6 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-30 disabled:pointer-events-none";

  return (
    <div className="flex gap-2">
      <div className="flex flex-col items-center">
        <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-bold text-primary-foreground">
          {index + 1}
        </div>
        {index < count - 1 && <div className="my-1 w-px flex-1 bg-border" />}
      </div>

      <div className="min-w-0 flex-1 pb-2">
        <div className="rounded-lg border border-border bg-card p-2.5">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="truncate text-sm font-medium leading-tight">
                {exerciseName}
              </p>
              {muscleGroup && (
                <p className="text-xs text-muted-foreground">{muscleGroup}</p>
              )}
            </div>
            <div className="flex shrink-0 items-center gap-0.5">
              <button
                type="button"
                className={iconBtn}
                disabled={index === 0}
                onClick={() => onMove("up")}
                aria-label="הזז למעלה"
              >
                <ChevronUp className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                className={iconBtn}
                disabled={index === count - 1}
                onClick={() => onMove("down")}
                aria-label="הזז למטה"
              >
                <ChevronDown className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                className={iconBtn}
                onClick={onDuplicate}
                aria-label="שכפל"
              >
                <Copy className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                className={cn(iconBtn, "hover:text-destructive")}
                onClick={onDelete}
                aria-label="מחק"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>

          <div className="mt-2 flex flex-wrap gap-1.5">
            <MiniField
              label="סטים"
              className="w-14"
              type="number"
              min={0}
              value={fields.sets ?? ""}
              onChange={(e) =>
                setFields((f) => ({
                  ...f,
                  sets: e.target.value === "" ? null : Number(e.target.value),
                }))
              }
              onBlur={() => save(fields)}
            />
            <MiniField
              label="חזרות"
              className="w-16"
              placeholder="8-10"
              value={fields.reps ?? ""}
              onChange={(e) => setFields((f) => ({ ...f, reps: e.target.value }))}
              onBlur={() => save(fields)}
            />
            <MiniField
              label="משקל"
              className="w-16"
              placeholder='ק"ג'
              value={fields.weight ?? ""}
              onChange={(e) => setFields((f) => ({ ...f, weight: e.target.value }))}
              onBlur={() => save(fields)}
            />
            <MiniField
              label="RPE"
              className="w-12"
              type="number"
              min={1}
              max={10}
              step={0.5}
              value={fields.rpe ?? ""}
              onChange={(e) =>
                setFields((f) => ({
                  ...f,
                  rpe: e.target.value === "" ? null : Number(e.target.value),
                }))
              }
              onBlur={() => save(fields)}
            />
            <MiniField
              label="מנוחה (שנ')"
              className="w-16"
              type="number"
              min={0}
              value={fields.rest_seconds ?? ""}
              onChange={(e) =>
                setFields((f) => ({
                  ...f,
                  rest_seconds: e.target.value === "" ? null : Number(e.target.value),
                }))
              }
              onBlur={() => save(fields)}
            />
            <MiniField
              label="הערות"
              className="min-w-24 flex-1"
              placeholder="הנחיות ביצוע"
              value={fields.instructions ?? ""}
              onChange={(e) =>
                setFields((f) => ({ ...f, instructions: e.target.value }))
              }
              onBlur={() => save(fields)}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
