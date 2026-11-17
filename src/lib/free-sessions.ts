/**
 * Free sessions (migration 0016): a trainer-led session that isn't part of
 * anyone's weekly plan. Pure helpers shared by the session screens, the
 * history pages and the Server Actions — safe on both server and client.
 */

import type { Database } from "@/lib/supabase/types";
import type { LoggedSet, PlannedSet } from "@/lib/sets";

type FreeSetRow = Database["public"]["Tables"]["free_session_sets"]["Row"];

/** Columns to select for a free-session set — keep in sync with the two mappers below. */
export const FREE_SET_COLUMNS =
  "id, session_exercise_id, set_index, set_type, target_reps_min, target_reps_max, target_reps_note, target_weight_kg, target_weight_note, target_rpe, weight_kg, reps, rpe, logged_at";

export type FreeSetColumns = Pick<
  FreeSetRow,
  | "id"
  | "session_exercise_id"
  | "set_index"
  | "set_type"
  | "target_reps_min"
  | "target_reps_max"
  | "target_reps_note"
  | "target_weight_kg"
  | "target_weight_note"
  | "target_rpe"
  | "weight_kg"
  | "reps"
  | "rpe"
  | "logged_at"
>;

// numeric columns can come back from PostgREST as strings ("82.50") — normalize.
function num(value: number | string | null | undefined): number | null {
  if (value == null || value === "") return null;
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

export function freeSetHasTarget(row: Pick<FreeSetRow, "target_reps_min" | "target_reps_note">): boolean {
  return row.target_reps_min != null || Boolean(row.target_reps_note?.trim());
}

/** The row's target (copied from a saved workout when the session started), if it has one. */
export function freeSetToPlanned(row: FreeSetColumns): PlannedSet | null {
  if (!freeSetHasTarget(row)) return null;
  return {
    id: row.id,
    setIndex: row.set_index,
    setType: row.set_type,
    repsMin: num(row.target_reps_min),
    repsMax: num(row.target_reps_max),
    repsNote: row.target_reps_note,
    weightKg: num(row.target_weight_kg),
    weightNote: row.target_weight_note,
    rpe: num(row.target_rpe),
  };
}

/** What was performed on the row, if anything was. */
export function freeSetToLogged(row: FreeSetColumns): LoggedSet | null {
  if (!row.logged_at) return null;
  return {
    setIndex: row.set_index,
    weightKg: num(row.weight_kg),
    reps: num(row.reps),
    rpe: num(row.rpe),
    source: "trainer_session",
    loggedAt: row.logged_at,
  };
}

/** How long an unfinished session still counts as "in progress" before lists show it as abandoned. */
export const OPEN_SESSION_HOURS = 24;

export function isSessionStale(startedAt: string, now: number = Date.now()): boolean {
  return now - Date.parse(startedAt) > OPEN_SESSION_HOURS * 60 * 60 * 1000;
}

/** "אורח", a trainee's name, or a neutral fallback — what a free session is called in lists. */
export function freeSessionTitle(session: { guest_label: string | null }, traineeName: string | null): string {
  return traineeName ?? session.guest_label?.trim() ?? "";
}

/** Whole minutes between two timestamps, or null when it isn't meaningful (unfinished, or absurdly long). */
export function sessionDurationMinutes(startedAt: string, finishedAt: string | null): number | null {
  if (!finishedAt) return null;
  const minutes = Math.round((Date.parse(finishedAt) - Date.parse(startedAt)) / 60000);
  return minutes > 0 && minutes <= 6 * 60 ? minutes : null;
}
