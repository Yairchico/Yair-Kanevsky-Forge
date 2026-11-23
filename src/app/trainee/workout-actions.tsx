"use client";

import { useState, useTransition } from "react";
import { Check, ListChecks } from "lucide-react";
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
 *
 * "הכל בוצע כמתוכנן" (onCompleteAsPlanned, before the workout is submitted)
 * is the fast path for a trainee filling the workout in afterwards: every
 * set not entered yet is saved as its target, every exercise is marked
 * done and the workout is submitted — after one confirmation, since it
 * writes the whole workout at once.
 */
export function SubmitWorkoutButton({
  workoutId,
  submitted: initialSubmitted,
  disabled = false,
  getNotes,
  flushPending,
  onSubmitted,
  onCompleteAsPlanned,
}: {
  workoutId: string;
  submitted: boolean;
  disabled?: boolean;
  getNotes: () => ExerciseNoteEntry[];
  /** Retries unsaved sets; resolves to how many are still unsaved. */
  flushPending: () => Promise<number>;
  /** The notes reached the server with a successful submit. */
  onSubmitted?: () => void;
  /** Saves everything not entered yet as planned and submits; resolves to an error message, if any. */
  onCompleteAsPlanned?: () => Promise<{ error?: string }>;
}) {
  const [submitted, setSubmitted] = useState(initialSubmitted);
  // The server's answer can change under an open tab (the trainer finished
  // this workout in a session) — follow it when the page data refreshes.
  const [syncedProp, setSyncedProp] = useState(initialSubmitted);
  if (initialSubmitted !== syncedProp) {
    setSyncedProp(initialSubmitted);
    setSubmitted(initialSubmitted);
  }
  const [error, setError] = useState<string | undefined>();
  const [showSuccess, setShowSuccess] = useState(false);
  const [pending, startTransition] = useTransition();
  const [confirmingPlanned, setConfirmingPlanned] = useState(false);

  function completeAsPlanned() {
    if (!onCompleteAsPlanned) return;
    setError(undefined);
    startTransition(async () => {
      const stillPending = await flushPending();
      if (stillPending > 0) {
        setError("יש סטים שעדיין לא נשמרו (אין חיבור). נסו שוב כשהחיבור יחזור.");
        return;
      }
      const result = await onCompleteAsPlanned();
      setConfirmingPlanned(false);
      if (result.error) {
        setError(result.error);
        return;
      }
      setSubmitted(true);
      setShowSuccess(true);
    });
  }

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
          onSubmitted?.();
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
      {onCompleteAsPlanned && !submitted && !disabled && (
        confirmingPlanned ? (
          <div className="space-y-2 rounded-xl border border-primary-deep bg-primary-tint p-3">
            <p className="text-sm">כל סט שלא מילאת יישמר לפי התוכנית, כל התרגילים יסומנו כבוצעו והאימון יוגש.</p>
            <div className="flex gap-2">
              <Button type="button" onClick={completeAsPlanned} disabled={pending} className="flex-1">
                <Check className="h-4 w-4" />
                כן, הגש
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={() => setConfirmingPlanned(false)}
                disabled={pending}
                className="flex-1"
              >
                ביטול
              </Button>
            </div>
          </div>
        ) : (
          <Button type="button" onClick={() => setConfirmingPlanned(true)} disabled={pending} className="w-full">
            <ListChecks className="h-4 w-4" />
            הכל בוצע כמתוכנן
          </Button>
        )
      )}
      <Button
        type="button"
        variant={submitted || onCompleteAsPlanned ? "outline" : "default"}
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
