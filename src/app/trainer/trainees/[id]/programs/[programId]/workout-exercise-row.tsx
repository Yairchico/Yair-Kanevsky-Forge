"use client";

import { useRef, useState } from "react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { ChevronDown, ChevronUp, Copy, GripVertical, Plus, Trash2, X } from "lucide-react";
import {
  addSet,
  deleteSet,
  updateSet,
  updateWorkoutExercise,
  type SetFields,
  type WorkoutExerciseFields,
} from "./actions";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import {
  SET_TYPE_LABEL,
  formatRepsTarget,
  formatSetTarget,
  summarizeSets,
  weightInputValue,
  type PlannedSet,
} from "@/lib/sets";

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

const cellInput = "h-8 rounded-md px-2 text-center text-sm";

function toSetFields(set: PlannedSet): SetFields {
  return {
    set_type: set.setType === "warmup" ? "warmup" : "working",
    reps: formatRepsTarget(set),
    weight: weightInputValue(set),
    rpe: set.rpe,
  };
}

/**
 * One planned set as an editable table row. Same save-on-blur pattern as
 * the exercise's own fields: local state while typing, one updateSet per
 * blur (or per change, for the type select). A rejected value snaps back to
 * the last one that saved, and the error is shown under the table.
 */
function SetRow({
  traineeId,
  programId,
  set,
  disabled,
  canDelete,
  onSaved,
  onDelete,
  onError,
}: {
  traineeId: string;
  programId: string;
  set: PlannedSet;
  disabled: boolean;
  canDelete: boolean;
  onSaved: (set: PlannedSet, revertedToDraft: boolean) => void;
  onDelete: () => void;
  onError: (message: string | null) => void;
}) {
  const [fields, setFields] = useState<SetFields>(() => toSetFields(set));
  const lastValid = useRef(fields);

  async function save(next: SetFields) {
    setFields(next);
    const unchanged =
      next.set_type === lastValid.current.set_type &&
      next.reps.trim() === lastValid.current.reps.trim() &&
      next.weight.trim() === lastValid.current.weight.trim() &&
      next.rpe === lastValid.current.rpe;
    if (unchanged) return;

    const result = await updateSet(traineeId, programId, set.id, next);
    if (result.error || !result.set) {
      onError(result.error ?? "שגיאה בשמירת הסט");
      setFields(lastValid.current);
      return;
    }
    onError(null);
    // Normalized by the server ("8 - 10" -> "8-10", "82,5" -> "82.5").
    const normalized = toSetFields(result.set);
    lastValid.current = normalized;
    setFields(normalized);
    onSaved(result.set, Boolean(result.revertedToDraft));
  }

  return (
    <tr className="border-t border-border">
      <td className="py-1 pe-1.5 text-center text-xs font-bold text-muted-foreground">{set.setIndex}</td>
      <td className="py-1 pe-1.5">
        <select
          aria-label={`סוג סט ${set.setIndex}`}
          disabled={disabled}
          value={fields.set_type}
          onChange={(e) => void save({ ...fields, set_type: e.target.value as SetFields["set_type"] })}
          className="h-8 w-[4.5rem] rounded-md border border-input bg-card px-1.5 text-xs outline-none focus-visible:border-ring disabled:opacity-50"
        >
          <option value="working">{SET_TYPE_LABEL.working}</option>
          <option value="warmup">{SET_TYPE_LABEL.warmup}</option>
        </select>
      </td>
      <td className="py-1 pe-1.5">
        <Input
          aria-label={`חזרות בסט ${set.setIndex}`}
          title={fields.reps}
          className={cn(cellInput, "w-24")}
          placeholder="8-10"
          disabled={disabled}
          value={fields.reps}
          onChange={(e) => setFields((f) => ({ ...f, reps: e.target.value }))}
          onBlur={() => void save(fields)}
        />
      </td>
      <td className="py-1 pe-1.5">
        <Input
          aria-label={`משקל בסט ${set.setIndex}`}
          title={fields.weight}
          className={cn(cellInput, "w-20")}
          inputMode="decimal"
          placeholder="—"
          disabled={disabled}
          value={fields.weight}
          onChange={(e) => setFields((f) => ({ ...f, weight: e.target.value }))}
          onBlur={() => void save(fields)}
        />
      </td>
      <td className="py-1 pe-1.5">
        <Input
          aria-label={`RPE בסט ${set.setIndex}`}
          className={cn(cellInput, "w-12")}
          type="number"
          min={1}
          max={10}
          step={0.5}
          disabled={disabled}
          value={fields.rpe ?? ""}
          onChange={(e) =>
            setFields((f) => ({ ...f, rpe: e.target.value === "" ? null : Number(e.target.value) }))
          }
          onBlur={() => void save(fields)}
        />
      </td>
      <td className="py-1 text-end">
        <button
          type="button"
          onClick={onDelete}
          disabled={disabled || !canDelete}
          aria-label={`מחק סט ${set.setIndex}`}
          className="flex h-6 w-6 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-muted hover:text-destructive disabled:pointer-events-none disabled:opacity-30"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </td>
    </tr>
  );
}

/**
 * A compact "flow" node: numbered badge + connecting line on the side, a
 * card with the exercise name, its planned sets (migration 0013: one row
 * per set, each with its own reps/weight/RPE), and the exercise-level
 * fields (rest, a note for this program). Every field saves itself on blur
 * — no page refresh; onEdited fires so the parent can flip the program's
 * "פורסם" badge to "טיוטה" immediately, matching the server-side
 * auto-revert-to-draft. The set table can be collapsed to a one-line
 * summary.
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
  initialSets,
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
  initialSets: PlannedSet[];
  onDuplicate: () => void;
  onDelete: () => void;
  onEdited?: () => void;
}) {
  const [fields, setFields] = useState(initialFields);
  const [sets, setSets] = useState(initialSets);
  const [collapsed, setCollapsed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [addingSet, setAddingSet] = useState(false);
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id });

  // A just-added (or duplicated) exercise renders first with a temp id and
  // placeholder sets; once the server answers, the parent swaps in the real
  // id together with the real sets (real set ids are needed to edit them).
  const [syncedId, setSyncedId] = useState(id);
  if (id !== syncedId) {
    setSyncedId(id);
    setSets(initialSets);
  }
  const isTemp = id.startsWith("temp-");

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  async function saveFields(next: WorkoutExerciseFields) {
    setFields(next);
    if (isTemp) return;
    const result = await updateWorkoutExercise(traineeId, programId, id, next);
    if (result.error) {
      setError(result.error);
      return;
    }
    setError(null);
    if (result.revertedToDraft) onEdited?.();
  }

  async function handleAddSet() {
    if (isTemp) return;
    setAddingSet(true);
    const result = await addSet(traineeId, programId, id);
    setAddingSet(false);
    if (result.error || !result.set) {
      setError(result.error ?? "שגיאה בהוספת סט");
      return;
    }
    setError(null);
    setSets((prev) => [...prev, result.set!]);
    if (result.revertedToDraft) onEdited?.();
  }

  function handleDeleteSet(setId: string) {
    const previous = sets;
    const removed = sets.find((s) => s.id === setId);
    if (!removed) return;
    // Optimistic: drop it and renumber locally the same way the server does.
    setSets(
      sets
        .filter((s) => s.id !== setId)
        .map((s) => (s.setIndex > removed.setIndex ? { ...s, setIndex: s.setIndex - 1 } : s)),
    );
    void (async () => {
      const result = await deleteSet(traineeId, programId, setId);
      if (result.error) {
        setSets(previous);
        setError(result.error);
        return;
      }
      setError(null);
      if (result.revertedToDraft) onEdited?.();
    })();
  }

  function handleSetSaved(saved: PlannedSet, revertedToDraft: boolean) {
    setSets((prev) => prev.map((s) => (s.id === saved.id ? saved : s)));
    if (revertedToDraft) onEdited?.();
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
                disabled={isTemp}
                aria-label="שכפל"
              >
                <Copy className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                className={cn(iconBtn, "hover:text-destructive")}
                onClick={onDelete}
                disabled={isTemp}
                aria-label="מחק"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                className={iconBtn}
                onClick={() => setCollapsed((c) => !c)}
                aria-label={collapsed ? "הצג סטים" : "כווץ סטים"}
                aria-expanded={!collapsed}
              >
                {collapsed ? <ChevronDown className="h-4 w-4" /> : <ChevronUp className="h-4 w-4" />}
              </button>
            </div>
          </div>

          {collapsed ? (
            <button
              type="button"
              onClick={() => setCollapsed(false)}
              className="mt-2 rounded bg-muted px-1.5 py-0.5 text-xs"
            >
              {summarizeSets(sets)}
            </button>
          ) : (
            <>
              <div className="mt-2 overflow-x-auto">
                <table className="w-auto min-w-[19rem] text-sm">
                  <thead>
                    <tr className="text-[10px] text-muted-foreground">
                      <th className="pb-0.5 pe-1.5 text-center font-normal">#</th>
                      <th className="pb-0.5 pe-1.5 text-start font-normal">סוג</th>
                      <th className="pb-0.5 pe-1.5 text-start font-normal">חזרות *</th>
                      <th className="pb-0.5 pe-1.5 text-start font-normal">משקל (ק&quot;ג)</th>
                      <th className="pb-0.5 pe-1.5 text-start font-normal">RPE</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {sets.map((set) => (
                      <SetRow
                        // Index in the key: after a deletion renumbers the
                        // rows, each remaining row re-reads its (unchanged)
                        // values instead of keeping stale local edit state.
                        key={`${set.id}-${set.setIndex}`}
                        traineeId={traineeId}
                        programId={programId}
                        set={set}
                        disabled={isTemp}
                        canDelete={sets.length > 1}
                        onSaved={handleSetSaved}
                        onDelete={() => handleDeleteSet(set.id)}
                        onError={setError}
                      />
                    ))}
                  </tbody>
                </table>
              </div>
              <button
                type="button"
                onClick={() => void handleAddSet()}
                disabled={isTemp || addingSet}
                className="mt-1.5 flex items-center gap-1 rounded-md border border-dashed border-border px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-50"
              >
                <Plus className="h-3.5 w-3.5" />
                סט
              </button>
            </>
          )}

          <div className="mt-2 flex flex-wrap gap-1.5">
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
              onBlur={() => void saveFields(fields)}
            />
            <MiniField
              label="הערות"
              className="min-w-24 flex-1"
              placeholder="הנחיות ביצוע"
              value={fields.instructions ?? ""}
              onChange={(e) =>
                setFields((f) => ({ ...f, instructions: e.target.value }))
              }
              onBlur={() => void saveFields(fields)}
            />
          </div>
          {error && <p className="mt-1.5 text-xs text-destructive">{error}</p>}
        </div>
      </div>
    </div>
  );
}

/**
 * The read-only superadmin's version of the row above — same numbered
 * "flow" shape, but no drag handle (useSortable requires a DndContext,
 * which the read-only list doesn't render at all — no reordering to wire
 * up), no duplicate/delete, and every set as plain text instead of inputs.
 */
export function WorkoutExerciseRowReadOnly({
  index,
  count,
  exerciseName,
  muscleGroup,
  fields,
  sets,
}: {
  index: number;
  count: number;
  exerciseName: string;
  muscleGroup: string | null;
  fields: WorkoutExerciseFields;
  sets: PlannedSet[];
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

          <ol className="mt-2 space-y-0.5 text-xs">
            {sets.map((set) => (
              <li key={set.id} className="flex flex-wrap items-center gap-1.5">
                <span className="w-4 text-center font-bold text-muted-foreground">{set.setIndex}</span>
                <span dir="ltr">{formatSetTarget(set)}</span>
                {set.rpe != null && <span className="text-muted-foreground">RPE {set.rpe}</span>}
                {set.setType === "warmup" && (
                  <span className="rounded-full bg-secondary px-1.5 text-[10px] text-muted-foreground">
                    {SET_TYPE_LABEL.warmup}
                  </span>
                )}
              </li>
            ))}
          </ol>

          {(fields.rest_seconds != null || fields.instructions) && (
            <div className="mt-2 space-y-0.5 text-xs text-muted-foreground">
              {fields.rest_seconds != null && <p>מנוחה: {fields.rest_seconds} שנ׳</p>}
              {fields.instructions && <p>{fields.instructions}</p>}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
