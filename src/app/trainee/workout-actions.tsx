"use client";

import { useActionState, useState, useTransition } from "react";
import { Check, ClipboardPlus } from "lucide-react";
import {
  logExercisePerformance,
  submitWorkout,
  toggleExerciseCompletion,
  type LogPerformanceState,
} from "./actions";
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

/** Submits the whole workout — optimistic. The trainer then sees it as "הוגש". */
export function SubmitWorkoutButton({
  workoutId,
  submitted: initialSubmitted,
}: {
  workoutId: string;
  submitted: boolean;
}) {
  const [submitted, setSubmitted] = useState(initialSubmitted);
  const [pending, startTransition] = useTransition();

  function toggle() {
    const next = !submitted;
    setSubmitted(next);
    startTransition(() => {
      void submitWorkout(workoutId, next);
    });
  }

  return (
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
  );
}

const initialLogState: LogPerformanceState = {};

/**
 * Basic performance entry, opt-in per exercise: what was actually done
 * (weight/reps/RPE), separate from the planned values. Collapsed by
 * default so checking a box off stays a one-tap action.
 */
export function PerformanceLogForm({
  workoutExerciseId,
}: {
  workoutExerciseId: string;
}) {
  const [open, setOpen] = useState(false);
  const action = logExercisePerformance.bind(null, workoutExerciseId);
  const [state, formAction, pending] = useActionState(action, initialLogState);

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
      >
        <ClipboardPlus className="h-3.5 w-3.5" />
        הזן ביצוע בפועל
      </button>
    );
  }

  return (
    <form action={formAction} className="space-y-2 rounded-lg border border-border bg-muted/40 p-2.5">
      <div className="flex flex-wrap gap-2">
        <div className="w-20 space-y-0.5">
          <Label className="text-[10px] text-muted-foreground">משקל בפועל</Label>
          <Input name="actual_weight" className="h-8 px-2 text-sm" placeholder='ק"ג' />
        </div>
        <div className="w-20 space-y-0.5">
          <Label className="text-[10px] text-muted-foreground">חזרות בפועל</Label>
          <Input name="actual_reps" className="h-8 px-2 text-sm" placeholder="10" />
        </div>
        <div className="w-16 space-y-0.5">
          <Label className="text-[10px] text-muted-foreground">RPE</Label>
          <Input
            name="rpe_actual"
            type="number"
            min={1}
            max={10}
            step={0.5}
            className="h-8 px-2 text-sm"
          />
        </div>
      </div>
      <Input name="notes" className="h-8 px-2 text-sm" placeholder="הערה (אופציונלי)" />
      {state.error && <p className="text-xs text-destructive">{state.error}</p>}
      {state.success && <p className="text-xs text-success">נשמר ✓</p>}
      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={pending}>
          {pending ? "שומר…" : "שמור"}
        </Button>
        <Button type="button" size="sm" variant="outline" onClick={() => setOpen(false)}>
          סגור
        </Button>
      </div>
    </form>
  );
}
