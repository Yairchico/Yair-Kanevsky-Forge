/**
 * Client-only localStorage persistence for a trainee's in-progress
 * performance entry, keyed per workout. Replaces the old per-exercise
 * "save" button: whatever is typed lives here until the whole workout is
 * submitted, and survives closing/reopening the browser in the meantime.
 *
 * Not shared across devices/sessions (that would need a server round
 * trip on every keystroke) — just enough so a trainee mid-workout who
 * switches apps or reloads doesn't lose what they already typed.
 */

export interface WorkoutExerciseDraft {
  weight: string;
  reps: string;
  rpe: string;
  notes: string;
}

export type WorkoutDraft = Record<string, WorkoutExerciseDraft>;

export const EMPTY_DRAFT_ENTRY: WorkoutExerciseDraft = {
  weight: "",
  reps: "",
  rpe: "",
  notes: "",
};

function draftKey(workoutId: string): string {
  return `trainee-workout-draft:${workoutId}`;
}

/**
 * Never throws — private-browsing/quota failures just mean no draft was
 * saved, and calling this during SSR (no `window`) just means "no draft
 * yet," which is also correct there.
 */
export function loadWorkoutDraft(workoutId: string): WorkoutDraft {
  if (typeof window === "undefined") return {};
  try {
    const raw = localStorage.getItem(draftKey(workoutId));
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? (parsed as WorkoutDraft) : {};
  } catch {
    return {};
  }
}

export function saveWorkoutDraft(workoutId: string, draft: WorkoutDraft): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(draftKey(workoutId), JSON.stringify(draft));
  } catch {
    // best-effort only — the entry stays in memory for the rest of this page view
  }
}

export function clearWorkoutDraft(workoutId: string): void {
  try {
    localStorage.removeItem(draftKey(workoutId));
  } catch {
    // nothing to do
  }
}
