"use client";

import { ArrowUp, Check, Dumbbell, Loader2, Lock, Pin, Plus, Trash2, X } from "lucide-react";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ExerciseVideo } from "@/components/exercise-video";
import { cn } from "@/lib/utils";
import { getExerciseImage } from "@/lib/exercise-image";
import {
  SET_TYPE_LABEL,
  formatLoggedSet,
  formatSetTarget,
  type LoggedSet,
  type PlannedSet,
} from "@/lib/sets";
import type { PreviousPerformance } from "@/lib/previous-sets";
import type { SetDraft } from "@/lib/workout-draft";
import type { SetEntry, SetEntryExercise, SetRowState } from "@/lib/use-set-entry";

export interface TraineeExerciseData extends SetEntryExercise {
  name: string;
  muscleGroup: string | null;
  imageUrl: string | null;
  videoUrl: string | null;
  /** The exercise's permanent note from the library (null when it has none, or it's hidden in this program). */
  permanentNote: string | null;
  previous: PreviousPerformance | null;
  restSeconds: number | null;
  /** The trainer's note for this program. */
  instructions: string | null;
  /** Training blocks: how much the target went up since last time, e.g. "+2.5 ק״ג מהפעם הקודמת" (null: it didn't). */
  jump?: string | null;
}

function SetEntryRow({
  setIndex,
  planned,
  previous,
  values,
  placeholder,
  state,
  hasUnsaved,
  saving,
  editable,
  isNext,
  removable,
  onChange,
  onBlur,
  onClear,
  onRemove,
}: {
  setIndex: number;
  planned: PlannedSet | undefined;
  previous: LoggedSet | undefined;
  values: SetDraft;
  placeholder: { weight: string; reps: string; rpe: string };
  state: SetRowState;
  /** Something was typed here that isn't saved yet (it will be, by itself). */
  hasUnsaved: boolean;
  saving: boolean;
  editable: boolean;
  isNext: boolean;
  /** The last row beyond the plan — an extra set, which can be removed altogether. */
  removable: boolean;
  onChange: (next: Partial<Pick<SetDraft, "weight" | "reps" | "rpe">>) => void;
  onBlur: () => void;
  onClear: () => void;
  onRemove: () => void;
}) {
  // RPE is asked for only where the trainer set an RPE target, or one was
  // already recorded — it's optional noise otherwise.
  const showRpe = planned?.rpe != null || values.rpe.trim() !== "";
  const saved = state === "logged" || state === "logged-short";
  const canClear = saved || hasUnsaved;

  return (
    <div
      className={cn(
        "rounded-xl border p-2.5 transition-colors",
        state === "logged" && "border-success/30 bg-success/5",
        (state === "logged-short" || state === "pending") && "border-warning/40 bg-warning/5",
        (state === "changed" || (state === "open" && hasUnsaved)) && "border-primary/50 bg-card",
        state === "open" && !hasUnsaved && (isNext ? "border-primary bg-card ring-2 ring-primary-deep" : "border-border bg-card"),
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
            value={values.weight}
            placeholder={placeholder.weight}
            onChange={(e) => onChange({ weight: e.target.value })}
            onBlur={onBlur}
            className="h-10 w-16 rounded-md px-1.5 text-center text-base"
          />
        </label>
        <label className="flex flex-col items-center gap-0.5">
          <span className="text-[10px] text-muted-foreground">חזרות</span>
          <Input
            inputMode="numeric"
            aria-label={`חזרות בסט ${setIndex}`}
            disabled={!editable}
            value={values.reps}
            placeholder={placeholder.reps}
            onChange={(e) => onChange({ reps: e.target.value })}
            onBlur={onBlur}
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
              value={values.rpe}
              placeholder={placeholder.rpe}
              onChange={(e) => onChange({ rpe: e.target.value })}
              onBlur={onBlur}
              className="h-10 w-11 rounded-md px-1 text-center text-base"
            />
          </label>
        )}
        {/* No ✓: a row saves itself. What's left is undoing — emptying a
            row, or removing an extra set added by mistake. */}
        <div className="mt-3 flex h-11 w-9 shrink-0 items-center justify-center">
          {editable && (removable || canClear) && (
            <button
              type="button"
              onClick={removable ? onRemove : onClear}
              disabled={saving}
              aria-label={removable ? `הסר סט ${setIndex}` : `נקה סט ${setIndex}`}
              title={removable ? "הסר את הסט" : "נקה את הסט"}
              className="flex h-9 w-9 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-hover hover:text-foreground disabled:opacity-50"
            >
              {removable ? <Trash2 className="h-4 w-4" /> : <X className="h-4 w-4" />}
            </button>
          )}
        </div>
      </div>
      {saving ? (
        <p className="mt-1 flex items-center gap-1 text-[11px] text-muted-foreground">
          <Loader2 className="h-3 w-3 animate-spin" />
          שומר…
        </p>
      ) : state === "pending" ? (
        <p className="mt-1 text-[11px] text-warning-foreground">ממתין לחיבור — יישלח שוב אוטומטית</p>
      ) : hasUnsaved ? (
        <p className="mt-1 text-[11px] text-muted-foreground">יישמר אוטומטית</p>
      ) : state === "logged-short" ? (
        <p className="mt-1 text-[11px] text-warning-foreground">נשמר · פחות מהיעד</p>
      ) : state === "logged" ? (
        <p className="mt-1 text-[11px] text-success">נשמר ✓</p>
      ) : null}
    </div>
  );
}

/**
 * The exercise popup opened from a trainee's workout card: the trainer's
 * guidance (the exercise's permanent note, the note for this program, rest),
 * the exercise's image and demo video, and one row per set — the set's own
 * target, what the trainee did on this exercise last time, and the fields
 * for what they actually do now. Built for filling a workout in quickly,
 * usually afterwards: every row shows its target, a row is saved by itself
 * once something is typed in it, and "סמן כבוצע" saves every untouched row
 * as its target in one go — so only what was different needs typing. All
 * of the entry state lives in useSetEntry (src/lib/use-set-entry.ts,
 * autoSave), owned by the workout panel.
 */
export function TraineeExerciseModal({
  exercise,
  entry,
  done,
  doneBusy,
  editable,
  onToggleDone,
  onClose,
}: {
  exercise: TraineeExerciseData;
  entry: SetEntry;
  done: boolean;
  /** "done" (or taking it back) is being saved. */
  doneBusy: boolean;
  editable: boolean;
  onToggleDone: (next: boolean) => void;
  onClose: () => void;
}) {
  const image = getExerciseImage({
    name: exercise.name,
    muscle_group: exercise.muscleGroup,
    media_url: exercise.imageUrl,
  });

  const indexes = entry.indexesFor(exercise);
  const previousByIndex = new Map((exercise.previous?.sets ?? []).map((s) => [s.setIndex, s]));
  const nextOpen = indexes.find((i) => entry.stateFor(exercise, i) === "open");
  const error = entry.errors[exercise.id] ?? null;
  const removableIndex = entry.removableIndexFor(exercise);

  return (
    <Modal open onClose={onClose} title={exercise.name} className="max-w-lg">
      <div className="space-y-4">
        <div className="flex justify-center">
          <div className="flex h-40 w-40 items-center justify-center overflow-hidden rounded-xl bg-primary-tint">
            {image ? (
              // eslint-disable-next-line @next/next/no-img-element -- media_url can be any external host
              <img src={image} alt={exercise.name} className="h-full w-full object-cover" />
            ) : (
              <Dumbbell className="h-1/3 w-1/3 text-primary-text" />
            )}
          </div>
        </div>

        {exercise.muscleGroup && (
          <p className="text-center text-base text-muted-foreground">{exercise.muscleGroup}</p>
        )}

        {exercise.jump && (
          <p className="flex items-center justify-center gap-1 text-sm font-medium text-success">
            <ArrowUp className="h-4 w-4" />
            {exercise.jump}
          </p>
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
              {editable ? "סטים · משנים רק מה שהיה שונה, השאר כמתוכנן" : "סטים"}
            </p>
            <p className="text-sm font-medium">
              {entry.loggedCountFor(exercise)}/{indexes.length}
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
              planned={entry.plannedFor(exercise, setIndex)}
              previous={previousByIndex.get(setIndex)}
              values={entry.valuesFor(exercise.id, setIndex)}
              placeholder={entry.placeholderFor(exercise, setIndex)}
              state={entry.stateFor(exercise, setIndex)}
              hasUnsaved={!!entry.draft[exercise.id]?.sets[setIndex] && entry.stateFor(exercise, setIndex) !== "pending"}
              saving={entry.isSaving(exercise.id, setIndex)}
              editable={editable}
              isNext={setIndex === nextOpen}
              removable={setIndex === removableIndex}
              onChange={(next) => entry.changeSet(exercise.id, setIndex, next)}
              onBlur={() => entry.blurSet(exercise.id, setIndex)}
              onClear={() => entry.clearSet(exercise, setIndex)}
              onRemove={() => void entry.removeExtraSet(exercise)}
            />
          ))}

          {error && <p className="text-sm text-destructive">{error}</p>}

          {editable && (
            <button
              type="button"
              onClick={() => entry.addExtraSet(exercise.id)}
              className="flex w-full items-center justify-center gap-1.5 rounded-md border border-dashed border-border py-2 text-sm text-muted-foreground transition-colors hover:bg-hover hover:text-foreground"
            >
              <Plus className="h-4 w-4" />
              סט נוסף
            </button>
          )}
        </div>

        <div className="space-y-1">
          <Label className="text-sm">הערה לתרגיל (אופציונלי · נשמרת בהגשת האימון)</Label>
          <Input
            value={entry.noteFor(exercise)}
            disabled={!editable}
            maxLength={1000}
            onChange={(e) => entry.setNote(exercise.id, e.target.value)}
            placeholder="איך הרגשת, שינויים וכו׳"
          />
        </div>

        <div className="space-y-2">
          <Button
            type="button"
            variant={done ? "outline" : "default"}
            onClick={() => onToggleDone(!done)}
            disabled={!editable || doneBusy}
            className="w-full"
          >
            {doneBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
            {done ? "בוצע ✓ (לחיצה לביטול הסימון)" : "סמן כבוצע · כל השאר כמתוכנן"}
          </Button>
          <Button type="button" variant="outline" onClick={onClose} className="w-full">
            סגור
          </Button>
        </div>
      </div>
    </Modal>
  );
}
