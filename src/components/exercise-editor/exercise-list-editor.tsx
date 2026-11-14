"use client";

import { useRef, useState, type ReactNode } from "react";
import {
  DndContext,
  PointerSensor,
  TouchSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { ExerciseRow, ExerciseRowReadOnly } from "./exercise-row";
import { AddExercisePicker } from "./add-exercise-picker";
import type { PlannedSet } from "@/lib/sets";
import type {
  CatalogExercise,
  EditedInfo,
  EditorRow,
  ExerciseFields,
  ExerciseListApi,
  ProgressionRule,
} from "@/lib/exercise-editor-types";

export interface EditorItem {
  /**
   * Stable identity for React's own reconciliation — set once and never
   * changed, unlike `id` below. Keeping these separate is what lets a
   * newly-added/duplicated row's temp-id get swapped for its real server
   * id without the row remounting (and losing whatever the trainer is
   * mid-typing into it, e.g. notes) the moment that swap lands.
   */
  key: string;
  id: string;
  exerciseId: string;
  exerciseName: string;
  muscleGroup: string | null;
  /** The exercise's permanent note from the library. */
  libraryNote: string | null;
  fields: ExerciseFields;
  sets: PlannedSet[];
  progression?: ProgressionRule;
  /**
   * Training blocks: this exercise's targets are computed from an earlier
   * week (so its sets can be "automatic" or hand-set). False for an
   * exercise with nothing before it in the block.
   */
  computed?: boolean;
}

export type InitialEditorItem = Omit<EditorItem, "key">;

function rowToItemPatch(row: EditorRow): Pick<EditorItem, "id" | "fields" | "sets" | "progression"> {
  return {
    id: row.id,
    fields: {
      rest_seconds: row.rest_seconds,
      instructions: row.instructions,
      hide_library_note: row.hide_library_note,
    },
    sets: row.sets,
    progression: row.progression,
  };
}

/**
 * Owns one list of exercises (a workout in a weekly program, or a saved
 * workout) as local state and updates it immediately (optimistically) for
 * every structural change — add, delete, duplicate, drag-reorder — instead
 * of calling router.refresh() and waiting on a server round trip +
 * re-render. Individual field edits (sets/reps/...) live inside each
 * ExerciseRow's own local state. What "saving" means is entirely up to
 * `api` (src/lib/exercise-editor-types.ts).
 *
 * onEdited fires on any saved change so the owner can react — the program
 * builder flips its "פורסם" badge to "טיוטה" right away, mirroring the
 * server auto-reverting a published program to draft on any edit.
 */
export function ExerciseListEditor({
  listId,
  api,
  initialItems,
  catalog,
  allowHideLibraryNote = false,
  showOverrides = false,
  disabled = false,
  readOnly = false,
  emptyText,
  renderFooter,
  onNewExercise,
  onEdited,
}: {
  /** Unique and stable per list — also keeps dnd-kit's generated ids identical on server and client. */
  listId: string;
  api: ExerciseListApi;
  /** Already-confirmed rows only — real ids, so `key` is just `id` for these. */
  initialItems: InitialEditorItem[];
  catalog: CatalogExercise[];
  allowHideLibraryNote?: boolean;
  showOverrides?: boolean;
  /** The list itself isn't saved yet (a workout still being created) — nothing can be added to it. */
  disabled?: boolean;
  /** The read-only superadmin viewer (migration 0011) — hides every mutation control, disables drag-reorder. */
  readOnly?: boolean;
  emptyText?: string;
  /** Extra per-exercise controls (the training-block progression rule). */
  renderFooter?: (item: EditorItem, helpers: { replaceItem: (row: EditorRow) => void }) => ReactNode;
  onNewExercise?: (exercise: CatalogExercise) => void;
  onEdited?: (info: EditedInfo) => void;
}) {
  const [items, setItems] = useState<EditorItem[]>(() =>
    initialItems.map((it) => ({ ...it, key: it.id })),
  );
  const [error, setError] = useState<string | null>(null);
  const tempCounter = useRef(0);
  const nextTempId = () => `temp-${listId}-${(tempCounter.current += 1)}`;

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 150, tolerance: 5 } }),
  );

  function structural(revertedToDraft: boolean | undefined) {
    onEdited?.({ revertedToDraft: Boolean(revertedToDraft), structural: true });
  }

  /** Swap in what the server actually saved for a row (also used by the progression footer). */
  function replaceItem(row: EditorRow) {
    setItems((prev) => prev.map((it) => (it.id === row.id ? { ...it, ...rowToItemPatch(row) } : it)));
  }

  function handleAdd(exerciseId: string, newExercise?: CatalogExercise) {
    // A just-created exercise (from the picker's inline "add to library")
    // isn't in `catalog` yet — the parent hands it back via onNewExercise
    // for next time, but this call still needs it right now.
    const ex = catalog.find((c) => c.id === exerciseId) ?? newExercise;
    if (!ex || disabled) return;
    if (newExercise) onNewExercise?.(newExercise);

    const tempId = nextTempId();
    setItems((prev) => [
      ...prev,
      {
        key: tempId,
        id: tempId,
        exerciseId: ex.id,
        exerciseName: ex.name,
        muscleGroup: ex.muscle_group,
        libraryNote: ex.instructions ?? null,
        // Matches the server's own defaults for a new row (3 working sets
        // of 8-10), so it looks right while the call is in flight. The
        // placeholder sets have temp ids and stay disabled until the real
        // row (and its real set ids) comes back below.
        fields: { rest_seconds: null, instructions: null, hide_library_note: false },
        sets: [1, 2, 3].map((n) => ({
          id: `${tempId}-set-${n}`,
          setIndex: n,
          setType: "working" as const,
          repsMin: 8,
          repsMax: 10,
          repsNote: null,
          weightKg: null,
          weightNote: null,
          rpe: null,
        })),
      },
    ]);

    void (async () => {
      const result = await api.addExercise(exerciseId);
      if (result.row) {
        const row = result.row;
        // Sync with whatever actually got saved, not just the id — the
        // real set ids are needed to edit the sets at all.
        setItems((prev) => prev.map((it) => (it.id === tempId ? { ...it, ...rowToItemPatch(row) } : it)));
        setError(null);
        structural(result.revertedToDraft);
      } else {
        setItems((prev) => prev.filter((it) => it.id !== tempId));
        setError(result.error ?? "שגיאה בהוספת התרגיל");
      }
    })();
  }

  function handleDelete(id: string) {
    const index = items.findIndex((it) => it.id === id);
    const removed = items[index];
    if (!removed) return;
    setItems((prev) => prev.filter((it) => it.id !== id));
    void (async () => {
      const result = await api.deleteExercise(id);
      if (result.error) {
        // Refused (e.g. the trainee already logged this exercise) — put it
        // back where it was.
        setItems((prev) => [...prev.slice(0, index), removed, ...prev.slice(index)]);
        setError(result.error);
        return;
      }
      setError(null);
      structural(result.revertedToDraft);
    })();
  }

  function handleDuplicate(id: string) {
    const index = items.findIndex((it) => it.id === id);
    const source = items[index];
    if (!source) return;

    const tempId = nextTempId();
    setItems((prev) => [
      ...prev.slice(0, index + 1),
      {
        ...source,
        key: tempId,
        id: tempId,
        sets: source.sets.map((set) => ({ ...set, id: `${tempId}-set-${set.setIndex}` })),
      },
      ...prev.slice(index + 1),
    ]);

    void (async () => {
      const result = await api.duplicateExercise(id);
      if (result.row) {
        const row = result.row;
        setItems((prev) => prev.map((it) => (it.id === tempId ? { ...it, ...rowToItemPatch(row) } : it)));
        setError(null);
        structural(result.revertedToDraft);
      } else {
        setItems((prev) => prev.filter((it) => it.id !== tempId));
        setError(result.error ?? "שגיאה בשכפול");
      }
    })();
  }

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const oldIndex = items.findIndex((it) => it.id === active.id);
    const newIndex = items.findIndex((it) => it.id === over.id);
    if (oldIndex === -1 || newIndex === -1) return;
    const next = arrayMove(items, oldIndex, newIndex);
    setItems(next);

    void (async () => {
      const result = await api.reorder(next.filter((it) => !it.id.startsWith("temp-")).map((it) => it.id));
      if (result.error) {
        setError(result.error);
        return;
      }
      structural(result.revertedToDraft);
    })();
  }

  return (
    <div className="space-y-4">
      {error && (
        <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      )}
      {items.length === 0 ? (
        <p className="rounded-md border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
          {emptyText ?? (readOnly ? "אין תרגילים." : "אין עדיין תרגילים. הוסף תרגיל מהרשימה למטה.")}
        </p>
      ) : readOnly ? (
        // No DndContext at all — nothing to reorder, and useSortable
        // requires one, so this renders the plain read-only row instead.
        <div>
          {items.map((it, i) => (
            <ExerciseRowReadOnly
              key={it.id}
              index={i}
              count={items.length}
              exerciseName={it.exerciseName}
              muscleGroup={it.muscleGroup}
              libraryNote={it.libraryNote}
              fields={it.fields}
              sets={it.sets}
              footer={renderFooter?.(it, { replaceItem })}
            />
          ))}
        </div>
      ) : (
        // An explicit id: dnd-kit otherwise numbers its accessibility
        // elements with a module-level counter, which comes out different
        // on the server and in the browser (a hydration mismatch warning).
        <DndContext
          id={`dnd-${listId}`}
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={handleDragEnd}
        >
          <SortableContext
            items={items.map((it) => it.id)}
            strategy={verticalListSortingStrategy}
          >
            <div>
              {items.map((it, i) => (
                <ExerciseRow
                  key={it.key}
                  api={api}
                  id={it.id}
                  index={i}
                  count={items.length}
                  exerciseName={it.exerciseName}
                  muscleGroup={it.muscleGroup}
                  libraryNote={it.libraryNote}
                  allowHideLibraryNote={allowHideLibraryNote}
                  showOverrides={showOverrides && it.computed !== false}
                  initialFields={it.fields}
                  initialSets={it.sets}
                  footer={renderFooter?.(it, { replaceItem })}
                  onDuplicate={() => handleDuplicate(it.id)}
                  onDelete={() => handleDelete(it.id)}
                  onEdited={onEdited}
                />
              ))}
            </div>
          </SortableContext>
        </DndContext>
      )}

      {!readOnly && !disabled && <AddExercisePicker exercises={catalog} onAdd={handleAdd} />}
    </div>
  );
}
