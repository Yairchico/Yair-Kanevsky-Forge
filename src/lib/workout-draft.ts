/**
 * Client-only localStorage persistence for in-progress set entry — the
 * trainee's own workout screen, the trainer-led session and the free
 * session all use it through useSetEntry (src/lib/use-set-entry.ts), each
 * under its own storage key.
 *
 * Every set is saved to the server on its own the moment it's confirmed, so
 * what lives here is only what the server does NOT have yet:
 *
 *  - values typed into a set but not confirmed, so they survive a closed
 *    tab or a phone that switched apps;
 *  - sets whose save didn't reach the server (no reception in the gym):
 *    marked `pending` and retried automatically;
 *  - the per-exercise note, until the workout is submitted/finished.
 *
 * Once a set is saved its entry is removed again — the screen then shows
 * the server's copy. That's what keeps two people entering the same workout
 * (a trainee on their phone, the trainer running a session) from fighting
 * over a stale local copy. Not shared across devices.
 */

export interface SetDraft {
  weight: string;
  reps: string;
  rpe: string;
  /** The save couldn't reach the server and must be retried. */
  status?: "pending";
  /** When it went pending (ms since epoch) — a newer server copy wins over it. */
  at?: number;
  /**
   * logged_at of the server copy these values were typed over (null/absent
   * when the set wasn't saved yet). If the server's copy has changed since,
   * this edit is stale and is dropped.
   */
  basedOn?: string | null;
}

export interface ExerciseDraft {
  /** By set_index. Unsaved edits and pending saves only. */
  sets: Record<number, SetDraft>;
  /** Undefined = no local edit; the server's note is shown. */
  notes?: string;
  /** Extra set rows the user opened beyond the plan. */
  extraSets: number;
}

export type WorkoutDraft = Record<string, ExerciseDraft>;

export const EMPTY_SET_DRAFT: SetDraft = { weight: "", reps: "", rpe: "" };
export const EMPTY_EXERCISE_DRAFT: ExerciseDraft = { sets: {}, extraSets: 0 };

/** Storage keys. Versioned: an older shape under an older key is simply ignored, never misread. */
export const draftKeys = {
  trainee: (workoutId: string) => `trainee-workout-draft:v3:${workoutId}`,
  trainerSession: (workoutId: string) => `trainer-session-draft:v1:${workoutId}`,
  freeSession: (sessionId: string) => `free-session-draft:v1:${sessionId}`,
};

function isSetDraft(value: unknown): value is SetDraft {
  if (typeof value !== "object" || value === null) return false;
  const v = value as SetDraft;
  return typeof v.weight === "string" && typeof v.reps === "string" && typeof v.rpe === "string";
}

/**
 * Never throws — private-browsing/quota failures just mean no draft was
 * saved, and calling this during SSR (no `window`) just means "no draft
 * yet," which is also correct there. Anything that doesn't have the
 * expected shape is skipped.
 */
export function loadWorkoutDraft(key: string): WorkoutDraft {
  if (typeof window === "undefined") return {};
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return {};
    const draft: WorkoutDraft = {};
    for (const [id, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof value !== "object" || value === null) continue;
      const v = value as Partial<ExerciseDraft>;
      const sets: Record<number, SetDraft> = {};
      for (const [index, set] of Object.entries(v.sets ?? {})) {
        const i = Number(index);
        if (Number.isInteger(i) && i >= 1 && isSetDraft(set)) {
          sets[i] = {
            weight: set.weight,
            reps: set.reps,
            rpe: set.rpe,
            status: set.status === "pending" ? "pending" : undefined,
            at: typeof set.at === "number" ? set.at : undefined,
            basedOn: typeof set.basedOn === "string" ? set.basedOn : null,
          };
        }
      }
      draft[id] = {
        sets,
        notes: typeof v.notes === "string" ? v.notes : undefined,
        extraSets: typeof v.extraSets === "number" && v.extraSets > 0 ? Math.min(v.extraSets, 20) : 0,
      };
    }
    return draft;
  } catch {
    return {};
  }
}

function isEmptyDraft(draft: WorkoutDraft): boolean {
  return Object.values(draft).every(
    (ex) => Object.keys(ex.sets).length === 0 && ex.notes === undefined && ex.extraSets === 0,
  );
}

export function saveWorkoutDraft(key: string, draft: WorkoutDraft): void {
  if (typeof window === "undefined") return;
  try {
    if (isEmptyDraft(draft)) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(draft));
  } catch {
    // best-effort only — the entry stays in memory for the rest of this page view
  }
}

export function clearWorkoutDraft(key: string): void {
  try {
    localStorage.removeItem(key);
  } catch {
    // nothing to do
  }
}
