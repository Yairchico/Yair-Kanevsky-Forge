"use client";

import { useState, useTransition } from "react";
import { Check } from "lucide-react";
import { submitWorkout, type PerformanceEntry } from "./actions";
import { Button } from "@/components/ui/button";
import { WorkoutSubmittedModal } from "./workout-submitted-modal";

/**
 * Submits the whole workout — optimistic. Reads entries() at click time
 * (a getter, not a prop value) so it always sees the latest draft even
 * though this button itself doesn't re-render on every keystroke. A
 * successful false→true submit also pops WorkoutSubmittedModal — a
 * branded confirmation a trainee scrolled past this button could easily
 * miss otherwise.
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
  const [showSuccess, setShowSuccess] = useState(false);
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
      } else if (next) {
        setShowSuccess(true);
      }
    });
  }

  return (
    <div className="space-y-1.5">
      {error && <p className="text-sm text-destructive">{error}</p>}
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

      <WorkoutSubmittedModal open={showSuccess} onClose={() => setShowSuccess(false)} />
    </div>
  );
}
