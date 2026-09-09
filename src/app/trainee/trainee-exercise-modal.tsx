"use client";

import { Check, Dumbbell } from "lucide-react";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatWeight } from "@/lib/format";
import { getExerciseImage } from "@/lib/exercise-image";
import type { WorkoutExerciseDraft } from "@/lib/workout-draft";

export interface TraineeExerciseData {
  id: string;
  name: string;
  muscleGroup: string | null;
  imageUrl: string | null;
  exerciseDescription: string | null;
  sets: number | null;
  reps: string | null;
  weight: string | null;
  rpe: number | null;
  restSeconds: number | null;
  instructions: string | null;
}

/**
 * The exercise-detail popup opened from a trainee's workout card: the
 * trainer's guidance for this exercise (sets/reps/weight/RPE/rest, plus any
 * per-workout instructions), the exercise's own image and general
 * description (if the trainer set one in the library), and the trainee's
 * own entry point for what they actually did — performance fields (draft,
 * see src/lib/workout-draft.ts — nothing here reaches the server until the
 * whole workout is submitted) and the independent, immediate "סמן כבוצע"
 * toggle. `onToast` surfaces a quick bottom-of-screen confirmation for
 * either action instead of the modal just silently closing.
 */
export function TraineeExerciseModal({
  exercise,
  done,
  draft,
  onDraftChange,
  onToggleDone,
  onClose,
  onToast,
}: {
  exercise: TraineeExerciseData;
  done: boolean;
  draft: WorkoutExerciseDraft;
  onDraftChange: (next: WorkoutExerciseDraft) => void;
  onToggleDone: (next: boolean) => void;
  onClose: () => void;
  onToast: (message: string) => void;
}) {
  const image = getExerciseImage({
    name: exercise.name,
    muscle_group: exercise.muscleGroup,
    media_url: exercise.imageUrl,
  });

  const plannedParts = [
    exercise.sets != null ? `${exercise.sets} סטים` : null,
    exercise.reps ? `${exercise.reps} חזרות` : null,
    formatWeight(exercise.weight),
    exercise.rpe != null ? `RPE ${exercise.rpe}` : null,
    exercise.restSeconds != null ? `${exercise.restSeconds} שנ׳ מנוחה` : null,
  ].filter((p): p is string => Boolean(p));

  function handleToggleDone() {
    const next = !done;
    onToggleDone(next);
    onToast(next ? "סומן כבוצע ✓" : "הסימון בוטל");
  }

  function handleSave() {
    onToast("הביצוע נשמר");
    onClose();
  }

  return (
    <Modal open onClose={onClose} title={exercise.name} className="max-w-lg">
      <div className="space-y-4">
        <div className="flex justify-center">
          <div className="flex h-44 w-44 items-center justify-center overflow-hidden rounded-xl bg-primary/10">
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

        {exercise.exerciseDescription && (
          <p className="text-base leading-relaxed">{exercise.exerciseDescription}</p>
        )}

        <div className="space-y-2 rounded-xl bg-muted/50 p-3.5">
          <p className="text-sm font-semibold text-muted-foreground">הנחיות ביצוע</p>
          {plannedParts.length > 0 ? (
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-base">
              {plannedParts.map((p) => (
                <span key={p} className="font-medium">
                  {p}
                </span>
              ))}
            </div>
          ) : (
            <p className="text-base text-muted-foreground">לא הוגדרו הנחיות לתרגיל זה.</p>
          )}
          {exercise.instructions && <p className="text-base leading-relaxed">{exercise.instructions}</p>}
        </div>

        <div className="space-y-2">
          <p className="text-sm font-semibold text-muted-foreground">בפועל (יישמר בהגשת האימון)</p>
          <div className="flex flex-wrap gap-2">
            <div className="w-24 space-y-1">
              <Label className="text-sm">משקל (ק&quot;ג)</Label>
              <Input
                value={draft.weight}
                onChange={(e) => onDraftChange({ ...draft, weight: e.target.value })}
                placeholder="20"
              />
            </div>
            <div className="w-24 space-y-1">
              <Label className="text-sm">חזרות</Label>
              <Input
                value={draft.reps}
                onChange={(e) => onDraftChange({ ...draft, reps: e.target.value })}
                placeholder="10"
              />
            </div>
            <div className="w-20 space-y-1">
              <Label className="text-sm">RPE</Label>
              <Input
                type="number"
                min={1}
                max={10}
                step={0.5}
                value={draft.rpe}
                onChange={(e) => onDraftChange({ ...draft, rpe: e.target.value })}
              />
            </div>
          </div>
          <div className="space-y-1">
            <Label className="text-sm">הערה (אופציונלי)</Label>
            <Input
              value={draft.notes}
              onChange={(e) => onDraftChange({ ...draft, notes: e.target.value })}
              placeholder="איך הרגשת, שינויים וכו׳"
            />
          </div>
        </div>

        <div className="space-y-2">
          <Button
            type="button"
            variant={done ? "outline" : "default"}
            onClick={handleToggleDone}
            className="w-full"
          >
            <Check className="h-4 w-4" />
            {done ? "בוצע ✓ (לחיצה לביטול הסימון)" : "סמן כבוצע"}
          </Button>
          <Button type="button" variant="outline" onClick={handleSave} className="w-full">
            שמור וסגור
          </Button>
        </div>
      </div>
    </Modal>
  );
}
