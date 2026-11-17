"use client";

import type { ReactNode } from "react";
import { Pin, Plus } from "lucide-react";
import { ExerciseVideo } from "@/components/exercise-video";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import type { PreviousPerformance } from "@/lib/previous-sets";
import type { SetEntry, SetEntryExercise } from "@/lib/use-set-entry";
import { SessionSetRow } from "./session-set-row";

export interface SessionExerciseData extends SetEntryExercise {
  exerciseId: string;
  name: string;
  muscleGroup: string | null;
  videoUrl: string | null;
  /** The exercise's permanent note from the library. */
  permanentNote: string | null;
  /** The note for this program / saved workout. */
  instructions: string | null;
  restSeconds: number | null;
  previous: PreviousPerformance | null;
}

/**
 * Everything about the exercise currently on screen in a trainer session:
 * its name and notes, the demo video, one SessionSetRow per set, "+ another
 * set", and a note typed during the session. Shared by the session with a
 * trainee and the free session; what differs between them (where sets are
 * saved, replacing/removing an exercise) is passed in.
 */
export function SessionExercisePanel({
  exercise,
  entry,
  editable = true,
  subtitle,
  actions,
  noteLabel = "הערה לתרגיל",
}: {
  exercise: SessionExerciseData;
  entry: SetEntry;
  editable?: boolean;
  /** Extra text after the muscle group (e.g. the block's progression rule). */
  subtitle?: string | null;
  /** Buttons next to the title (free session: replace / remove). */
  actions?: ReactNode;
  noteLabel?: string;
}) {
  const indexes = entry.indexesFor(exercise);
  const previousByIndex = new Map((exercise.previous?.sets ?? []).map((s) => [s.setIndex, s]));
  const nextOpen = indexes.find((i) => entry.stateFor(exercise, i) === "open");
  const error = entry.errors[exercise.id] ?? null;
  const details = [
    exercise.muscleGroup,
    exercise.restSeconds != null ? `מנוחה ${exercise.restSeconds} שנ׳` : null,
    subtitle,
  ].filter(Boolean);

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold leading-tight">{exercise.name}</h1>
          {details.length > 0 && <p className="text-sm text-muted-foreground">{details.join(" · ")}</p>}
        </div>
        {actions && <div className="flex shrink-0 gap-2">{actions}</div>}
      </div>

      {exercise.videoUrl && <ExerciseVideo url={exercise.videoUrl} title={exercise.name} />}

      {(exercise.permanentNote || exercise.instructions) && (
        <div className="space-y-2 rounded-xl bg-muted/60 p-3 text-sm">
          <p className="flex items-center gap-1.5 font-semibold text-muted-foreground">
            <Pin className="h-3.5 w-3.5" />
            דגשים
          </p>
          {exercise.permanentNote && <p className="leading-relaxed whitespace-pre-line">{exercise.permanentNote}</p>}
          {exercise.instructions && (
            <p className={cn("leading-relaxed whitespace-pre-line", exercise.permanentNote && "border-t border-border pt-2")}>
              {exercise.instructions}
            </p>
          )}
        </div>
      )}

      <div className="space-y-2.5">
        {indexes.map((setIndex) => (
          <SessionSetRow
            key={setIndex}
            setIndex={setIndex}
            planned={entry.plannedFor(exercise, setIndex)}
            previous={previousByIndex.get(setIndex)}
            values={entry.valuesFor(exercise.id, setIndex)}
            placeholder={entry.placeholderFor(exercise, setIndex)}
            state={entry.stateFor(exercise, setIndex)}
            saving={entry.isSaving(exercise.id, setIndex)}
            editable={editable}
            isNext={setIndex === nextOpen}
            onChange={(next) => entry.changeSet(exercise.id, setIndex, next)}
            onStep={(field, delta) => entry.stepSet(exercise, setIndex, field, delta)}
            onConfirm={() => entry.confirmSet(exercise, setIndex)}
          />
        ))}

        {error && <p className="text-sm text-destructive">{error}</p>}

        {editable && (
          <button
            type="button"
            onClick={() => entry.addExtraSet(exercise.id)}
            className="flex w-full items-center justify-center gap-1.5 rounded-md border border-dashed border-border py-2.5 text-sm text-muted-foreground transition-colors hover:bg-hover hover:text-foreground"
          >
            <Plus className="h-4 w-4" />
            סט נוסף
          </button>
        )}
      </div>

      <div className="space-y-1">
        <Label className="text-sm">{noteLabel}</Label>
        <Input
          value={entry.noteFor(exercise)}
          disabled={!editable}
          maxLength={1000}
          onChange={(e) => entry.setNote(exercise.id, e.target.value)}
          placeholder="לדוגמה: כאב קל בכתף בסט האחרון"
        />
      </div>
    </div>
  );
}
