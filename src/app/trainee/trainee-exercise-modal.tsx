"use client";

import { Check, Dumbbell, Lock, Pin, Plus, RefreshCw } from "lucide-react";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ExerciseVideo } from "@/components/exercise-video";
import { cn } from "@/lib/utils";
import { getExerciseImage } from "@/lib/exercise-image";
import {
  SET_TYPE_LABEL,
  formatKg,
  formatLoggedSet,
  formatSetTarget,
  isSetTargetMet,
  type LoggedSet,
  type PlannedSet,
} from "@/lib/sets";
import type { PreviousPerformance } from "@/lib/previous-sets";
import { EMPTY_SET_DRAFT, type ExerciseDraft, type SetDraft } from "@/lib/workout-draft";

export interface TraineeExerciseData {
  id: string;
  name: string;
  muscleGroup: string | null;
  imageUrl: string | null;
  videoUrl: string | null;
  /** The exercise's permanent note from the library (null when it has none, or it's hidden in this program). */
  permanentNote: string | null;
  plannedSets: PlannedSet[];
  loggedSets: LoggedSet[];
  previous: PreviousPerformance | null;
  restSeconds: number | null;
  instructions: string | null;
}

/** The set rows to show: every planned set, then any extras (logged or added) beyond the plan. */
export function setIndexesFor(
  exercise: Pick<TraineeExerciseData, "plannedSets">,
  logged: Record<number, LoggedSet>,
  extraSets: number,
): number[] {
  const plannedIndexes = exercise.plannedSets.map((s) => s.setIndex);
  const maxPlanned = plannedIndexes.length ? Math.max(...plannedIndexes) : 0;
  const loggedExtra = Object.keys(logged)
    .map(Number)
    .filter((i) => i > maxPlanned);
  const maxExtra = Math.max(maxPlanned + extraSets, ...loggedExtra, maxPlanned);
  const indexes = [...plannedIndexes];
  for (let i = maxPlanned + 1; i <= maxExtra; i += 1) indexes.push(i);
  return indexes;
}

type RowState = "logged" | "logged-short" | "pending" | "changed" | "open";

function SetEntryRow({
  setIndex,
  planned,
  previous,
  draft,
  logged,
  saving,
  editable,
  isNext,
  onChange,
  onConfirm,
}: {
  setIndex: number;
  planned: PlannedSet | undefined;
  previous: LoggedSet | undefined;
  draft: SetDraft;
  logged: LoggedSet | undefined;
  saving: boolean;
  editable: boolean;
  isNext: boolean;
  onChange: (next: Partial<SetDraft>) => void;
  onConfirm: () => void;
}) {
  const pending = draft.status === "pending";
  const changed =
    Boolean(logged) &&
    !pending &&
    ((draft.weight.trim() !== "" && Number(draft.weight.replace(",", ".")) !== (logged!.weightKg ?? NaN)) ||
      (draft.reps.trim() !== "" && Number(draft.reps) !== (logged!.reps ?? NaN)));

  const state: RowState = pending
    ? "pending"
    : changed
      ? "changed"
      : logged
        ? isSetTargetMet(planned, logged)
          ? "logged"
          : "logged-short"
        : "open";

  const showRpe = planned?.rpe != null || logged?.rpe != null;

  return (
    <div
      className={cn(
        "rounded-xl border p-2.5 transition-colors",
        state === "logged" && "border-success/30 bg-success/5",
        (state === "logged-short" || state === "pending") && "border-warning/40 bg-warning/5",
        state === "changed" && "border-primary/50 bg-card",
        state === "open" && (isNext ? "border-primary bg-card ring-2 ring-primary/20" : "border-border bg-card"),
      )}
    >
      <div className="flex items-center gap-2">
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary text-sm font-bold text-primary-foreground">
          {setIndex}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-sm font-semibold" dir="ltr">
              {planned ? formatSetTarget(planned) : "סט נוסף"}
            </span>
            {planned?.setType === "warmup" && (
              <span className="rounded-full bg-secondary px-1.5 py-0.5 text-[10px] text-muted-foreground">
                {SET_TYPE_LABEL.warmup}
              </span>
            )}
            {planned?.rpe != null && <span className="text-[11px] text-muted-foreground">RPE {planned.rpe}</span>}
          </div>
          {previous && (
            <p className="text-[11px] text-muted-foreground">
              בפעם הקודמת: <span dir="ltr">{formatLoggedSet(previous)}</span>
            </p>
          )}
        </div>
        <label className="flex flex-col items-center gap-0.5">
          <span className="text-[10px] text-muted-foreground">ק&quot;ג</span>
          <Input
            inputMode="decimal"
            aria-label={`משקל בסט ${setIndex}`}
            disabled={!editable}
            value={draft.weight}
            placeholder={planned?.weightKg != null ? formatKg(planned.weightKg) : "—"}
            onChange={(e) => onChange({ weight: e.target.value })}
            className="h-10 w-16 rounded-md px-1.5 text-center text-base"
          />
        </label>
        <label className="flex flex-col items-center gap-0.5">
          <span className="text-[10px] text-muted-foreground">חזרות</span>
          <Input
            inputMode="numeric"
            aria-label={`חזרות בסט ${setIndex}`}
            disabled={!editable}
            value={draft.reps}
            placeholder={planned?.repsMin != null ? String(planned.repsMin) : ""}
            onChange={(e) => onChange({ reps: e.target.value })}
            className="h-10 w-12 rounded-md px-1 text-center text-base"
          />
        </label>
        {showRpe && (
          <label className="flex flex-col items-center gap-0.5">
            <span className="text-[10px] text-muted-foreground">RPE</span>
            <Input
              inputMode="decimal"
              aria-label={`RPE בסט ${setIndex}`}
              disabled={!editable}
              value={draft.rpe}
              placeholder={planned?.rpe != null ? String(planned.rpe) : ""}
              onChange={(e) => onChange({ rpe: e.target.value })}
              className="h-10 w-11 rounded-md px-1 text-center text-base"
            />
          </label>
        )}
        <button
          type="button"
          onClick={onConfirm}
          disabled={!editable || saving}
          aria-label={state === "logged" || state === "logged-short" ? `ביטול סט ${setIndex}` : `אישור סט ${setIndex}`}
          aria-pressed={state === "logged" || state === "logged-short"}
          className={cn(
            "mt-3 flex h-11 w-11 shrink-0 items-center justify-center rounded-full border-2 transition-colors disabled:opacity-50",
            state === "logged" && "border-success bg-success text-success-foreground",
            state === "logged-short" && "border-warning bg-warning/20 text-warning-foreground",
            state === "pending" && "border-warning bg-warning/15 text-warning-foreground",
            state === "changed" && "border-primary bg-primary text-primary-foreground",
            state === "open" && "border-border bg-card text-muted-foreground hover:border-primary hover:text-primary",
          )}
        >
          {state === "pending" ? (
            <RefreshCw className={cn("h-5 w-5", saving && "animate-spin")} />
          ) : (
            <Check className="h-6 w-6" />
          )}
        </button>
      </div>
      {state === "logged-short" && (
        <p className="mt-1 text-[11px] text-warning-foreground">נשמר · פחות מהיעד</p>
      )}
      {state === "logged" && <p className="mt-1 text-[11px] text-success">נשמר ✓</p>}
      {state === "pending" && (
        <p className="mt-1 text-[11px] text-warning-foreground">ממתין לחיבור — יישלח שוב אוטומטית</p>
      )}
      {state === "changed" && <p className="mt-1 text-[11px] text-muted-foreground">לחצו ✓ כדי לשמור את השינוי</p>}
    </div>
  );
}

/**
 * The exercise popup opened from a trainee's workout card: the trainer's
 * guidance (rest, per-program instructions), the exercise's image and
 * general description, and one row per set (migration 0013) — the set's
 * own target, what the trainee did on this exercise last time, and the
 * fields for what they actually do now. Tapping ✓ saves that one set to
 * the server right away (logSet); tapping it again un-confirms it. Typed
 * but unconfirmed values, and sets that couldn't be saved yet, live in
 * the localStorage draft (src/lib/workout-draft.ts) owned by the parent.
 */
export function TraineeExerciseModal({
  exercise,
  done,
  draft,
  logged,
  savingSetIndexes,
  error,
  editable,
  onSetChange,
  onConfirmSet,
  onAddExtraSet,
  onNotesChange,
  onToggleDone,
  onClose,
  onToast,
}: {
  exercise: TraineeExerciseData;
  done: boolean;
  draft: ExerciseDraft;
  logged: Record<number, LoggedSet>;
  savingSetIndexes: Set<number>;
  error: string | null;
  editable: boolean;
  onSetChange: (setIndex: number, next: Partial<SetDraft>) => void;
  onConfirmSet: (setIndex: number) => void;
  onAddExtraSet: () => void;
  onNotesChange: (notes: string) => void;
  onToggleDone: (next: boolean) => void;
  onClose: () => void;
  onToast: (message: string) => void;
}) {
  const image = getExerciseImage({
    name: exercise.name,
    muscle_group: exercise.muscleGroup,
    media_url: exercise.imageUrl,
  });

  const indexes = setIndexesFor(exercise, logged, draft.extraSets);
  const plannedByIndex = new Map(exercise.plannedSets.map((s) => [s.setIndex, s]));
  const previousByIndex = new Map((exercise.previous?.sets ?? []).map((s) => [s.setIndex, s]));
  const loggedCount = indexes.filter((i) => logged[i] || draft.sets[i]?.status === "pending").length;
  const nextOpen = indexes.find((i) => !logged[i] && draft.sets[i]?.status !== "pending");

  function handleToggleDone() {
    const next = !done;
    onToggleDone(next);
    onToast(next ? "סומן כבוצע ✓" : "הסימון בוטל");
  }

  return (
    <Modal open onClose={onClose} title={exercise.name} className="max-w-lg">
      <div className="space-y-4">
        <div className="flex justify-center">
          <div className="flex h-40 w-40 items-center justify-center overflow-hidden rounded-xl bg-primary/10">
            {image ? (
              // eslint-disable-next-line @next/next/no-img-element -- media_url can be any external host
              <img src={image} alt={exercise.name} className="h-full w-full object-cover" />
            ) : (
              <Dumbbell className="h-1/3 w-1/3 text-primary" />
            )}
          </div>
        </div>

        {exercise.muscleGroup && (
          <p className="text-center text-base text-muted-foreground">{exercise.muscleGroup}</p>
        )}

        {exercise.videoUrl && <ExerciseVideo url={exercise.videoUrl} title={exercise.name} />}

        {(exercise.permanentNote || exercise.instructions || exercise.restSeconds != null) && (
          <div className="space-y-2 rounded-xl bg-muted/50 p-3.5">
            <p className="flex items-center gap-1.5 text-sm font-semibold text-muted-foreground">
              <Pin className="h-3.5 w-3.5" />
              דגשי המאמן
            </p>
            {exercise.permanentNote && (
              <p className="text-base leading-relaxed whitespace-pre-line">{exercise.permanentNote}</p>
            )}
            {exercise.instructions && (
              <div className={cn(exercise.permanentNote && "border-t border-border pt-2")}>
                {exercise.permanentNote && (
                  <p className="text-sm font-semibold text-muted-foreground">באימון הזה</p>
                )}
                <p className="text-base leading-relaxed whitespace-pre-line">{exercise.instructions}</p>
              </div>
            )}
            {exercise.restSeconds != null && (
              <p className="text-sm text-muted-foreground">מנוחה {exercise.restSeconds} שנ׳ בין סטים</p>
            )}
          </div>
        )}

        <div className="space-y-2">
          <div className="flex items-center justify-between gap-2">
            <p className="text-sm font-semibold text-muted-foreground">
              {editable ? "סטים · כל סט נשמר כשמאשרים ✓" : "סטים"}
            </p>
            <p className="text-sm font-medium">
              {loggedCount}/{indexes.length}
            </p>
          </div>

          {!editable && (
            <p className="flex items-center gap-1.5 rounded-md bg-muted px-3 py-2 text-sm text-muted-foreground">
              <Lock className="h-3.5 w-3.5" />
              אפשר לעדכן רק אימונים מהשבוע הנוכחי ומהשבוע הקודם
            </p>
          )}

          {indexes.map((setIndex) => (
            <SetEntryRow
              key={setIndex}
              setIndex={setIndex}
              planned={plannedByIndex.get(setIndex)}
              previous={previousByIndex.get(setIndex)}
              draft={draft.sets[setIndex] ?? EMPTY_SET_DRAFT}
              logged={logged[setIndex]}
              saving={savingSetIndexes.has(setIndex)}
              editable={editable}
              isNext={setIndex === nextOpen}
              onChange={(next) => onSetChange(setIndex, next)}
              onConfirm={() => onConfirmSet(setIndex)}
            />
          ))}

          {error && <p className="text-sm text-destructive">{error}</p>}

          {editable && (
            <button
              type="button"
              onClick={onAddExtraSet}
              className="flex w-full items-center justify-center gap-1.5 rounded-md border border-dashed border-border py-2 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              <Plus className="h-4 w-4" />
              סט נוסף
            </button>
          )}
        </div>

        <div className="space-y-1">
          <Label className="text-sm">הערה לתרגיל (אופציונלי · נשמרת בהגשת האימון)</Label>
          <Input
            value={draft.notes}
            disabled={!editable}
            onChange={(e) => onNotesChange(e.target.value)}
            placeholder="איך הרגשת, שינויים וכו׳"
          />
        </div>

        <div className="space-y-2">
          <Button
            type="button"
            variant={done ? "outline" : "default"}
            onClick={handleToggleDone}
            disabled={!editable}
            className="w-full"
          >
            <Check className="h-4 w-4" />
            {done ? "בוצע ✓ (לחיצה לביטול הסימון)" : "סמן כבוצע"}
          </Button>
          <Button type="button" variant="outline" onClick={onClose} className="w-full">
            סגור
          </Button>
        </div>
      </div>
    </Modal>
  );
}
