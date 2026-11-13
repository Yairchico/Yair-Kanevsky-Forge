"use client";

import { useState, useTransition } from "react";
import { Check } from "lucide-react";
import { submitWorkout, type ExerciseNoteEntry } from "./actions";
import { Button } from "@/components/ui/button";
import { WorkoutSubmittedModal } from "./workout-submitted-modal";

/**
 * Submits the whole workout — optimistic. The sets themselves are already
 * saved one by one (logSet); before submitting, any set still waiting to
 * be saved (no reception earlier) is retried first, and if some still
 * can't reach the server the submission waits rather than marking a
 * workout done whose numbers aren't all there. Reads the notes via a
 * getter at click time so it always sees the latest draft. A successful
 * false→true submit also pops WorkoutSubmittedModal — a branded
 * confirmation a trainee scrolled past this button could easily miss.
 */
export function SubmitWorkoutButton({
  workoutId,
  submitted: initialSubmitted,
  disabled = false,
  getNotes,
  flushPending,
}: {
  workoutId: string;
  submitted: boolean;
  disabled?: boolean;
  getNotes: () => ExerciseNoteEntry[];
  /** Retries unsaved sets; resolves to how many are still unsaved. */
  flushPending: () => Promise<number>;
}) {
  const [submitted, setSubmitted] = useState(initialSubmitted);
  const [error, setError] = useState<string | undefined>();
  const [showSuccess, setShowSuccess] = useState(false);
  const [pending, startTransition] = useTransition();

  function toggle() {
    const next = !submitted;
    setError(undefined);
    startTransition(async () => {
      if (next) {
        const stillPending = await flushPending();
        if (stillPending > 0) {
          setError("יש סטים שעדיין לא נשמרו (אין חיבור). נסו שוב כשהחיבור יחזור.");
          return;
        }
      }
      setSubmitted(next);
      try {
        const result = await submitWorkout(workoutId, next, next ? getNotes() : []);
        if (result.error) {
          setSubmitted(!next);
          setError(result.error);
        } else if (next) {
          setShowSuccess(true);
        }
      } catch {
        setSubmitted(!next);
        setError("אין חיבור — נסו שוב בעוד רגע");
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
        disabled={pending || disabled}
        className="w-full"
      >
        <Check className="h-4 w-4" />
        {submitted ? "האימון הוגש ✓ (לחץ לביטול)" : "הגש אימון"}
      </Button>

      <WorkoutSubmittedModal open={showSuccess} onClose={() => setShowSuccess(false)} />
    </div>
  );
}
