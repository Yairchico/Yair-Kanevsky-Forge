/**
 * Client-only localStorage persistence for a trainee's in-progress entry,
 * keyed per workout. Since migration 0013 every set is saved to the server
 * on its own the moment the trainee confirms it (logSet), so this draft
 * holds two things:
 *
 *  - values typed into a set but not confirmed yet, so they survive a
 *    closed tab or a phone that switched apps;
 *  - sets whose save didn't reach the server (no reception in the gym):
 *    marked `pending` (or `pending-delete` for an un-confirm) and retried
 *    automatically — on the next page load, when the browser reports it's
 *    back online, and before the workout is submitted.
 *
 * Not shared across devices (that would need a server round trip on every
 * keystroke). The exercise-level note also lives here until "הגש אימון".
 */

export interface SetDraft {
  weight: string;
  reps: string;
  rpe: string;
  /** Set when a save/un-confirm couldn't reach the server and must be retried. */
  status?: "pending" | "pending-delete";
}

export interface ExerciseDraft {
  /** By set_index. */
  sets: Record<number, SetDraft>;
  notes: string;
  /** Extra sets the trainee added beyond the plan (rendered after the planned ones). */
  extraSets: number;
}

export type WorkoutDraft = Record<string, ExerciseDraft>;

export const EMPTY_SET_DRAFT: SetDraft = { weight: "", reps: "", rpe: "" };
export const EMPTY_EXERCISE_DRAFT: ExerciseDraft = { sets: {}, notes: "", extraSets: 0 };

// v2: the pre-0013 draft stored one {weight, reps, rpe, notes} per exercise.
// A new key means an old draft is simply ignored rather than misread.
function draftKey(workoutId: string): string {
  return `trainee-workout-draft:v2:${workoutId}`;
}

function isExerciseDraft(value: unknown): value is ExerciseDraft {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as ExerciseDraft).sets === "object" &&
    (value as ExerciseDraft).sets !== null
  );
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
    if (!parsed || typeof parsed !== "object") return {};
    const draft: WorkoutDraft = {};
    for (const [id, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (isExerciseDraft(value)) {
        draft[id] = {
          sets: value.sets,
          notes: typeof value.notes === "string" ? value.notes : "",
          extraSets: typeof value.extraSets === "number" ? value.extraSets : 0,
        };
      }
    }
    return draft;
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
