"use client";

import { useState, useTransition } from "react";
import { Check } from "lucide-react";
import {
  submitWorkout,
  toggleExerciseCompletion,
  type PerformanceEntry,
} from "./actions";
import type { WorkoutExerciseDraft } from "@/lib/workout-draft";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

/** Per-exercise "done" checkbox — optimistic, independent of workout submission. */
export function ExerciseCheckbox({
  workoutExerciseId,
  completed: initialCompleted,
}: {
  workoutExerciseId: string;
  completed: boolean;
}) {
  const [completed, setCompleted] = useState(initialCompleted);
  const [, startTransition] = useTransition();

  function toggle() {
    const next = !completed;
    setCompleted(next);
    startTransition(() => {
      void toggleExerciseCompletion(workoutExerciseId, next);
    });
  }

  return (
    <button
      type="button"
      onClick={toggle}
      aria-pressed={completed}
      aria-label={completed ? "בטל סימון בוצע" : "סמן כבוצע"}
      className={cn(
        "flex h-8 w-8 shrink-0 items-center justify-center rounded-full border-2 transition-colors",
        completed
          ? "border-success bg-success text-success-foreground"
          : "border-border text-transparent hover:border-primary",
      )}
    >
      <Check className="h-4 w-4" />
    </button>
  );
}

/**
 * Always-visible entry fields for one exercise — no per-exercise save
 * button. Whatever's typed here lives in the parent's draft state (and,
 * from there, localStorage — see src/lib/workout-draft.ts) until the whole
 * workout is submitted via SubmitWorkoutButton below.
 */
export function PerformanceEntryFields({
  value,
  onChange,
}: {
  value: WorkoutExerciseDraft;
  onChange: (next: WorkoutExerciseDraft) => void;
}) {
  return (
    <div className="mt-2 space-y-1.5 rounded-lg border border-dashed border-border bg-muted/30 p-2.5">
      <p className="text-[10px] text-muted-foreground">בפועל (יישמר בהגשת האימון)</p>
      <div className="flex flex-wrap gap-2">
        <div className="w-20 space-y-0.5">
          <Label className="text-[10px] text-muted-foreground">משקל (ק&quot;ג)</Label>
          <Input
            value={value.weight}
            onChange={(e) => onChange({ ...value, weight: e.target.value })}
            className="h-8 px-2 text-sm"
            placeholder="20"
          />
        </div>
        <div className="w-20 space-y-0.5">
          <Label className="text-[10px] text-muted-foreground">חזרות</Label>
          <Input
            value={value.reps}
            onChange={(e) => onChange({ ...value, reps: e.target.value })}
            className="h-8 px-2 text-sm"
            placeholder="10"
          />
        </div>
        <div className="w-16 space-y-0.5">
          <Label className="text-[10px] text-muted-foreground">RPE</Label>
          <Input
            type="number"
            min={1}
            max={10}
            step={0.5}
            value={value.rpe}
            onChange={(e) => onChange({ ...value, rpe: e.target.value })}
            className="h-8 px-2 text-sm"
          />
        </div>
      </div>
      <Input
        value={value.notes}
        onChange={(e) => onChange({ ...value, notes: e.target.value })}
        className="h-8 px-2 text-sm"
        placeholder="הערה (אופציונלי)"
      />
    </div>
  );
}

/**
 * Submits the whole workout — optimistic. Reads entries() at click time
 * (a getter, not a prop value) so it always sees the latest draft even
 * though this button itself doesn't re-render on every keystroke.
 */
export function SubmitWorkoutButton({
  workoutId,
  submitted: initialSubmitted,
  getEntries,
}: {
  workoutId: string;
  submitted: boolean;
  getEntries: () => PerformanceEntry[];
}) {
  const [submitted, setSubmitted] = useState(initialSubmitted);
  const [error, setError] = useState<string | undefined>();
  const [pending, startTransition] = useTransition();

  function toggle() {
    const next = !submitted;
    setSubmitted(next);
    setError(undefined);
    startTransition(async () => {
      const result = await submitWorkout(workoutId, next, next ? getEntries() : []);
      if (result.error) {
        setSubmitted(!next);
        setError(result.error);
      }
    });
  }

  return (
    <div className="space-y-1.5">
      {error && <p className="text-xs text-destructive">{error}</p>}
      <Button
        type="button"
        variant={submitted ? "outline" : "default"}
        onClick={toggle}
        disabled={pending}
        className="w-full"
      >
        <Check className="h-4 w-4" />
        {submitted ? "האימון הוגש ✓ (לחץ לביטול)" : "הגש אימון"}
      </Button>
    </div>
  );
}
