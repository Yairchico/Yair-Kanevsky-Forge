"use client";

import { useState, useTransition } from "react";
import { Check } from "lucide-react";
import { submitWorkout, toggleExerciseCompletion } from "./actions";
import { Button } from "@/components/ui/button";
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
