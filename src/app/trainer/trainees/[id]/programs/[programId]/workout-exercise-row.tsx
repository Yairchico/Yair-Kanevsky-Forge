"use client";

import { useRef, useState } from "react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Copy, GripVertical, Trash2 } from "lucide-react";
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
 * small card with the exercise name and one tight row of fields, and a
 * drag handle for real reordering (dnd-kit). Field edits save themselves
 * (local state, save on blur — no page refresh); onEdited fires so the
 * parent can flip the program's "פורסם" badge to "טיוטה" immediately,
 * matching the server-side auto-revert-to-draft.
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
  onDuplicate,
  onDelete,
  onEdited,
}: {
  traineeId: string;
  programId: string;
  id: string;
  index: number;
  count: number;
  exerciseName: string;
  muscleGroup: string | null;
  initialFields: WorkoutExerciseFields;
  onDuplicate: () => void;
  onDelete: () => void;
  onEdited?: () => void;
}) {
  const [fields, setFields] = useState(initialFields);
  const [error, setError] = useState<string | null>(null);
  const lastValid = useRef(initialFields);
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  async function save(next: WorkoutExerciseFields) {
    setFields(next);
    const result = await updateWorkoutExercise(traineeId, programId, id, next);
    if (result.error) {
      // Rejected (e.g. missing sets/reps, RPE out of range) — nothing was
      // persisted, so snap the field back to the last value that did save
      // rather than leaving the UI showing an invalid state as if it saved.
      setError(result.error);
      setFields(lastValid.current);
      return;
    }
    setError(null);
    lastValid.current = next;
    if (result.revertedToDraft) onEdited?.();
  }

  const iconBtn =
    "flex h-6 w-6 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-30 disabled:pointer-events-none";

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn("flex gap-2", isDragging && "z-10 opacity-70")}
    >
      <div className="flex flex-col items-center">
        <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-bold text-primary-foreground">
          {index + 1}
        </div>
        {index < count - 1 && <div className="my-1 w-px flex-1 bg-border" />}
      </div>

      <div className="min-w-0 flex-1 pb-2">
        <div className="rounded-lg border border-border bg-card p-2.5">
          <div className="flex items-start justify-between gap-2">
            <div className="flex min-w-0 items-start gap-1.5">
              <button
                type="button"
                {...attributes}
                {...listeners}
                className="mt-0.5 flex h-6 w-6 shrink-0 cursor-grab touch-none items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground active:cursor-grabbing"
                aria-label="גרור לשינוי סדר"
              >
                <GripVertical className="h-4 w-4" />
              </button>
              <div className="min-w-0">
                <p className="truncate text-sm font-medium leading-tight">
                  {exerciseName}
                </p>
                {muscleGroup && (
                  <p className="text-xs text-muted-foreground">{muscleGroup}</p>
                )}
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-0.5">
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
              label="סטים *"
              className="w-14"
              type="number"
              required
              min={1}
              value={fields.sets ?? ""}
              onChange={(e) =>
                setFields((f) => ({
                  ...f,
                  sets: e.target.value === "" ? null : Number(e.target.value),
                }))
              }
              onBlur={() => void save(fields)}
            />
            <MiniField
              label="חזרות *"
              className="w-16"
              required
              placeholder="8-10"
              value={fields.reps ?? ""}
              onChange={(e) => setFields((f) => ({ ...f, reps: e.target.value }))}
              onBlur={() => void save(fields)}
            />
            <MiniField
              label='משקל (ק"ג)'
              className="w-16"
              placeholder="20"
              value={fields.weight ?? ""}
              onChange={(e) => setFields((f) => ({ ...f, weight: e.target.value }))}
              onBlur={() => void save(fields)}
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
              onBlur={() => void save(fields)}
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
              onBlur={() => void save(fields)}
            />
            <MiniField
              label="הערות"
              className="min-w-24 flex-1"
              placeholder="הנחיות ביצוע"
              value={fields.instructions ?? ""}
              onChange={(e) =>
                setFields((f) => ({ ...f, instructions: e.target.value }))
              }
              onBlur={() => void save(fields)}
            />
          </div>
          {error && <p className="mt-1.5 text-xs text-destructive">{error}</p>}
        </div>
      </div>
    </div>
  );
}

function MiniValue({ label, value }: { label: string; value: string | number | null }) {
  if (value == null || value === "") return null;
  return (
    <span className="rounded bg-muted px-1.5 py-0.5 text-xs">
      <span className="text-muted-foreground">{label}: </span>
      {value}
    </span>
  );
}

/**
 * The read-only superadmin's version of the row above — same numbered
 * "flow" shape, but no drag handle (useSortable requires a DndContext,
 * which the read-only list doesn't render at all — no reordering to wire
 * up), no duplicate/delete, and fields as plain text instead of inputs.
 */
export function WorkoutExerciseRowReadOnly({
  index,
  count,
  exerciseName,
  muscleGroup,
  fields,
}: {
  index: number;
  count: number;
  exerciseName: string;
  muscleGroup: string | null;
  fields: WorkoutExerciseFields;
}) {
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
          <p className="truncate text-sm font-medium leading-tight">{exerciseName}</p>
          {muscleGroup && <p className="text-xs text-muted-foreground">{muscleGroup}</p>}

          <div className="mt-2 flex flex-wrap gap-1.5">
            <MiniValue label="סטים" value={fields.sets} />
            <MiniValue label="חזרות" value={fields.reps} />
            <MiniValue label='משקל' value={fields.weight} />
            <MiniValue label="RPE" value={fields.rpe} />
            <MiniValue label="מנוחה" value={fields.rest_seconds} />
            {fields.instructions && (
              <p className="w-full text-xs text-muted-foreground">{fields.instructions}</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
