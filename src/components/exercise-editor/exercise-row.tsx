"use client";

import { useRef, useState, type ReactNode } from "react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { ChevronDown, ChevronUp, Copy, GripVertical, Lock, Pin, Plus, Trash2, X } from "lucide-react";
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
import type {
  EditedInfo,
  ExerciseFields,
  ExerciseListApi,
  SetFields,
} from "@/lib/exercise-editor-types";

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

// Narrower on a phone so the whole row (type, reps, kg, RPE, delete) fits the card without scrolling.
const cellInput = "h-8 rounded-md px-1 text-center text-sm sm:px-2";
const cell = "py-1 pe-1 sm:pe-1.5";

function toSetFields(set: PlannedSet): SetFields {
  return {
    set_type: set.setType === "warmup" ? "warmup" : "working",
    reps: formatRepsTarget(set),
    weight: weightInputValue(set),
    rpe: set.rpe,
  };
}

/** The permanent note of the exercise (from the library), as shown inside a row. */
function LibraryNote({
  note,
  hidden,
  onToggleHidden,
}: {
  note: string;
  hidden: boolean;
  /** Omit to render the note without the "hide here" option. */
  onToggleHidden?: (next: boolean) => void;
}) {
  return (
    <div className="mt-2 rounded-md bg-muted/60 px-2 py-1.5 text-xs">
      <p className="flex items-center gap-1 font-semibold text-muted-foreground">
        <Pin className="h-3 w-3" />
        הערה קבועה (מהספרייה)
      </p>
      <p className={cn("mt-0.5 whitespace-pre-line", hidden && "text-muted-foreground line-through")}>
        {note}
      </p>
      {onToggleHidden && (
        <label className="mt-1 flex w-fit cursor-pointer items-center gap-1.5 text-muted-foreground">
          <input
            type="checkbox"
            checked={hidden}
            onChange={(e) => onToggleHidden(e.target.checked)}
            className="h-3.5 w-3.5 rounded border-border accent-primary"
          />
          הסתר מהמתאמן בתוכנית הזו
        </label>
      )}
    </div>
  );
}

/**
 * One planned set as an editable table row. Same save-on-blur pattern as
 * the exercise's own fields: local state while typing, one updateSet per
 * blur (or per change, for the type select). A rejected value snaps back to
 * the last one that saved, and the error is shown under the table.
 */
function SetRow({
  api,
  set,
  disabled,
  canDelete,
  showOverride,
  onSaved,
  onDelete,
  onError,
}: {
  api: ExerciseListApi;
  set: PlannedSet;
  disabled: boolean;
  canDelete: boolean;
  /** Training-block weeks: show whether this set is automatic or hand-set. */
  showOverride: boolean;
  onSaved: (set: PlannedSet, info: EditedInfo) => void;
  onDelete: () => void;
  onError: (message: string | null) => void;
}) {
  const [fields, setFields] = useState<SetFields>(() => toSetFields(set));
  const lastValid = useRef(fields);
  const [restoring, setRestoring] = useState(false);

  async function save(next: SetFields) {
    setFields(next);
    const typeChanged = next.set_type !== lastValid.current.set_type;
    const unchanged =
      !typeChanged &&
      next.reps.trim() === lastValid.current.reps.trim() &&
      next.weight.trim() === lastValid.current.weight.trim() &&
      next.rpe === lastValid.current.rpe;
    if (unchanged) return;

    const result = await api.updateSet(set.id, next);
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
    onSaved(result.set, { revertedToDraft: Boolean(result.revertedToDraft), structural: typeChanged });
  }

  async function restoreAutomatic() {
    if (!api.clearSetOverride) return;
    setRestoring(true);
    const result = await api.clearSetOverride(set.id);
    setRestoring(false);
    if (result.error || !result.set) {
      onError(result.error ?? "שגיאה בשחזור הסט");
      return;
    }
    onError(null);
    const normalized = toSetFields(result.set);
    lastValid.current = normalized;
    setFields(normalized);
    onSaved(result.set, { revertedToDraft: Boolean(result.revertedToDraft), structural: false });
  }

  return (
    <tr className="border-t border-border">
      <td className={cn(cell, "text-center text-xs font-bold text-muted-foreground")}>{set.setIndex}</td>
      <td className={cell}>
        <select
          aria-label={`סוג סט ${set.setIndex}`}
          disabled={disabled}
          value={fields.set_type}
          onChange={(e) => void save({ ...fields, set_type: e.target.value as SetFields["set_type"] })}
          className="h-8 w-[3.4rem] rounded-md border border-input bg-card px-1 text-xs outline-none sm:w-[4.5rem] sm:px-1.5 focus-visible:border-ring disabled:opacity-50"
        >
          <option value="working">{SET_TYPE_LABEL.working}</option>
          <option value="warmup">{SET_TYPE_LABEL.warmup}</option>
        </select>
      </td>
      <td className={cell}>
        <Input
          aria-label={`חזרות בסט ${set.setIndex}`}
          title={fields.reps}
          className={cn(cellInput, "w-[3.75rem] sm:w-24")}
          placeholder="8-10"
          disabled={disabled}
          value={fields.reps}
          onChange={(e) => setFields((f) => ({ ...f, reps: e.target.value }))}
          onBlur={() => void save(fields)}
        />
      </td>
      <td className={cell}>
        <Input
          aria-label={`משקל בסט ${set.setIndex}`}
          title={fields.weight}
          className={cn(cellInput, "w-14 sm:w-20", showOverride && set.isManualOverride && "border-warning bg-warning/10")}
          inputMode="decimal"
          placeholder="—"
          disabled={disabled}
          value={fields.weight}
          onChange={(e) => setFields((f) => ({ ...f, weight: e.target.value }))}
          onBlur={() => void save(fields)}
        />
      </td>
      <td className={cell}>
        <Input
          aria-label={`RPE בסט ${set.setIndex}`}
          className={cn(cellInput, "w-10 sm:w-12")}
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
      {showOverride && (
        <td className={cn(cell, "text-[11px]")}>
          {set.isManualOverride ? (
            <span className="flex flex-wrap items-center gap-1.5">
              <span className="inline-flex items-center gap-1 rounded-full bg-warning/20 px-1.5 py-0.5 font-medium text-warning-foreground">
                <Lock className="h-3 w-3" />
                ידני
              </span>
              <button
                type="button"
                onClick={() => void restoreAutomatic()}
                disabled={disabled || restoring}
                className="text-primary-text underline-offset-2 hover:underline disabled:opacity-50"
              >
                {restoring ? "משחזר…" : (
                  <>
                    <span className="sm:hidden">שחזר</span>
                    <span className="hidden sm:inline">שחזר לאוטומטי</span>
                  </>
                )}
              </button>
            </span>
          ) : (
            <span className="text-muted-foreground">אוטומטי</span>
          )}
        </td>
      )}
      <td className="py-1 text-end">
        <button
          type="button"
          onClick={onDelete}
          disabled={disabled || !canDelete}
          aria-label={`מחק סט ${set.setIndex}`}
          className="flex h-6 w-6 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-hover hover:text-destructive disabled:pointer-events-none disabled:opacity-30"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </td>
    </tr>
  );
}

/**
 * A compact "flow" node: numbered badge + connecting line on the side, a
 * card with the exercise name, its planned sets (one row per set, each with
 * its own reps/weight/RPE), and the exercise-level fields (rest, a note for
 * this program). Every field saves itself on blur — no page refresh;
 * onEdited fires so the owner can react (the program builder flips its
 * "פורסם" badge to "טיוטה", matching the server-side auto-revert-to-draft).
 * The set table can be collapsed to a one-line summary.
 *
 * Owner-agnostic: everything it saves goes through `api`, so the weekly
 * program builder and the saved-workout editor share this exact component.
 */
export function ExerciseRow({
  api,
  id,
  index,
  count,
  exerciseName,
  muscleGroup,
  libraryNote,
  allowHideLibraryNote,
  showOverrides = false,
  initialFields,
  initialSets,
  footer,
  onDuplicate,
  onDelete,
  onEdited,
}: {
  api: ExerciseListApi;
  id: string;
  index: number;
  count: number;
  exerciseName: string;
  muscleGroup: string | null;
  /** The exercise's permanent note from the library, if it has one. */
  libraryNote: string | null;
  /** Offer "hide the permanent note in this program" (the program builder; not templates). */
  allowHideLibraryNote: boolean;
  /** Training-block weeks after the first: mark hand-set targets. */
  showOverrides?: boolean;
  initialFields: ExerciseFields;
  initialSets: PlannedSet[];
  /** Extra controls under the fields (the training-block progression rule). */
  footer?: ReactNode;
  onDuplicate: () => void;
  onDelete: () => void;
  onEdited?: (info: EditedInfo) => void;
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
  // The parent can also hand down fresh sets for an existing row (a block
  // recompute changed the targets) by changing `initialSets`' identity.
  const [syncedId, setSyncedId] = useState(id);
  const [syncedSets, setSyncedSets] = useState(initialSets);
  // Bumped on every such hand-down; part of each set row's key, so the rows
  // re-read their values then — and ONLY then. (A row must not remount when
  // its own save comes back, or a trainer already typing in the next field
  // of the same row would lose focus and whatever they had typed.)
  const [setsVersion, setSetsVersion] = useState(0);
  if (id !== syncedId || initialSets !== syncedSets) {
    setSyncedId(id);
    setSyncedSets(initialSets);
    setSets(initialSets);
    setSetsVersion((v) => v + 1);
  }
  const isTemp = id.startsWith("temp-");

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  async function saveFields(next: ExerciseFields) {
    setFields(next);
    if (isTemp) return;
    const result = await api.updateFields(id, next);
    if (result.error) {
      setError(result.error);
      return;
    }
    setError(null);
    onEdited?.({ revertedToDraft: Boolean(result.revertedToDraft), structural: false });
  }

  async function handleAddSet() {
    if (isTemp) return;
    setAddingSet(true);
    const result = await api.addSet(id);
    setAddingSet(false);
    if (result.error || !result.set) {
      setError(result.error ?? "שגיאה בהוספת סט");
      return;
    }
    setError(null);
    setSets((prev) => [...prev, result.set!]);
    onEdited?.({ revertedToDraft: Boolean(result.revertedToDraft), structural: true });
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
      const result = await api.deleteSet(setId);
      if (result.error) {
        setSets(previous);
        setError(result.error);
        return;
      }
      setError(null);
      onEdited?.({ revertedToDraft: Boolean(result.revertedToDraft), structural: true });
    })();
  }

  function handleSetSaved(saved: PlannedSet, info: EditedInfo) {
    setSets((prev) => prev.map((s) => (s.id === saved.id ? saved : s)));
    onEdited?.(info);
  }

  const iconBtn =
    "flex h-6 w-6 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-hover hover:text-foreground disabled:opacity-30 disabled:pointer-events-none";

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
                className="mt-0.5 flex h-6 w-6 shrink-0 cursor-grab touch-none items-center justify-center rounded text-muted-foreground hover:bg-hover hover:text-foreground active:cursor-grabbing"
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

          {libraryNote && (
            <LibraryNote
              note={libraryNote}
              hidden={allowHideLibraryNote && fields.hide_library_note}
              onToggleHidden={
                allowHideLibraryNote
                  ? (next) => void saveFields({ ...fields, hide_library_note: next })
                  : undefined
              }
            />
          )}

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
                <table className="w-auto text-sm">
                  <thead>
                    <tr className="text-[10px] text-muted-foreground">
                      <th className="pb-0.5 pe-1 text-center font-normal sm:pe-1.5">#</th>
                      <th className="pb-0.5 pe-1 text-start font-normal sm:pe-1.5">סוג</th>
                      <th className="pb-0.5 pe-1 text-start font-normal sm:pe-1.5">חזרות *</th>
                      <th className="pb-0.5 pe-1 text-start font-normal sm:pe-1.5">
                        ק&quot;ג<span className="hidden sm:inline"> (משקל)</span>
                      </th>
                      <th className="pb-0.5 pe-1 text-start font-normal sm:pe-1.5">RPE</th>
                      {showOverrides && <th className="pb-0.5 pe-1 text-start font-normal sm:pe-1.5">מקור</th>}
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {sets.map((set) => (
                      <SetRow
                        // Index in the key: after a deletion renumbers the
                        // rows, each remaining row re-reads its (unchanged)
                        // values instead of keeping stale local edit state.
                        key={`${set.id}-${set.setIndex}-${setsVersion}`}
                        api={api}
                        set={set}
                        disabled={isTemp}
                        canDelete={sets.length > 1}
                        showOverride={showOverrides}
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
                className="mt-1.5 flex items-center gap-1 rounded-md border border-dashed border-border px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-hover hover:text-foreground disabled:opacity-50"
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
              label={libraryNote ? "הערה לתוכנית הזו (בנוסף להערה הקבועה)" : "הערות"}
              className="min-w-24 flex-1"
              placeholder="הנחיות ביצוע"
              value={fields.instructions ?? ""}
              onChange={(e) =>
                setFields((f) => ({ ...f, instructions: e.target.value }))
              }
              onBlur={() => void saveFields(fields)}
            />
          </div>

          {footer}

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
export function ExerciseRowReadOnly({
  index,
  count,
  exerciseName,
  muscleGroup,
  libraryNote,
  fields,
  sets,
  footer,
}: {
  index: number;
  count: number;
  exerciseName: string;
  muscleGroup: string | null;
  libraryNote: string | null;
  fields: ExerciseFields;
  sets: PlannedSet[];
  footer?: ReactNode;
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

          {libraryNote && <LibraryNote note={libraryNote} hidden={fields.hide_library_note} />}

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
                {set.isManualOverride && (
                  <span className="inline-flex items-center gap-0.5 rounded-full bg-warning/20 px-1.5 text-[10px] text-warning-foreground">
                    <Lock className="h-2.5 w-2.5" />
                    ידני
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

          {footer}
        </div>
      </div>
    </div>
  );
}
