/**
 * Per-set helpers (migration 0013): parsing what the trainer types into a
 * set's reps/weight fields, and formatting planned/performed sets for
 * display. Pure functions — safe to import from both server and client
 * components (same reasoning as src/lib/format.ts).
 */

import type { Database, SetType } from "@/lib/supabase/types";

type PlannedSetRow = Database["public"]["Tables"]["workout_exercise_sets"]["Row"];
type SetLogRow = Database["public"]["Tables"]["set_logs"]["Row"];

export interface PlannedSet {
  id: string;
  setIndex: number;
  setType: SetType;
  repsMin: number | null;
  repsMax: number | null;
  repsNote: string | null;
  weightKg: number | null;
  weightNote: string | null;
  rpe: number | null;
  /** Training blocks: the trainer set this target by hand, so automatic progression leaves it alone. */
  isManualOverride?: boolean;
}

export interface LoggedSet {
  setIndex: number;
  weightKg: number | null;
  reps: number | null;
  rpe: number | null;
  source: SetLogRow["source"];
  loggedAt: string;
}

/** Columns to select for a PlannedSet — keep in sync with toPlannedSet. */
export const PLANNED_SET_COLUMNS =
  "id, workout_exercise_id, set_index, set_type, reps_min, reps_max, reps_note, weight_kg, weight_note, rpe, is_manual_override";

/** Columns to select for a LoggedSet — keep in sync with toLoggedSet. */
export const SET_LOG_COLUMNS = "workout_exercise_id, set_index, weight_kg, reps, rpe, source, logged_at";

// numeric columns can come back from PostgREST as strings ("82.50") — normalize.
function num(value: number | string | null | undefined): number | null {
  if (value == null || value === "") return null;
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

export function toPlannedSet(
  row: Pick<
    PlannedSetRow,
    "id" | "set_index" | "set_type" | "reps_min" | "reps_max" | "reps_note" | "weight_kg" | "weight_note" | "rpe"
  > & { is_manual_override?: boolean },
): PlannedSet {
  return {
    id: row.id,
    setIndex: row.set_index,
    setType: row.set_type,
    repsMin: num(row.reps_min),
    repsMax: num(row.reps_max),
    repsNote: row.reps_note,
    weightKg: num(row.weight_kg),
    weightNote: row.weight_note,
    rpe: num(row.rpe),
    isManualOverride: row.is_manual_override === true,
  };
}

/** The DB column values for a planned set (program sets and template sets share them). */
export interface PlannedSetValues {
  set_type: "warmup" | "working";
  reps_min: number | null;
  reps_max: number | null;
  reps_note: string | null;
  weight_kg: number | null;
  weight_note: string | null;
  rpe: number | null;
}

/**
 * Real validation of one set as the trainer typed it — not just the
 * inputs' HTML hints: a reps target is required (a number, a range like
 * 8-10, or a short note such as AMRAP), the weight is a number of kg or a
 * short note, and RPE is within 1-10. Used by every Server Action that
 * writes a planned set; the tables' CHECK constraints are the backstop.
 */
export function parseSetFieldsInput(fields: {
  set_type: string;
  reps: string;
  weight: string;
  rpe: number | null;
}): { values: PlannedSetValues } | { error: string } {
  const reps = parseRepsInput(fields.reps ?? "");
  if ("error" in reps) return { error: reps.error };
  const weight = parseWeightInput(fields.weight ?? "");
  if ("error" in weight) return { error: weight.error };
  if (fields.rpe != null && (!Number.isFinite(fields.rpe) || fields.rpe < 1 || fields.rpe > 10)) {
    return { error: "RPE חייב להיות בין 1 ל-10" };
  }
  return {
    values: {
      set_type: fields.set_type === "warmup" ? "warmup" : "working",
      reps_min: reps.repsMin,
      reps_max: reps.repsMax,
      reps_note: reps.repsNote,
      weight_kg: weight.weightKg,
      weight_note: weight.weightNote,
      rpe: fields.rpe,
    },
  };
}

/** A planned set's own values as DB columns — for copying a set somewhere else. */
export function plannedSetValues(set: PlannedSet): PlannedSetValues {
  return {
    set_type: set.setType === "warmup" ? "warmup" : "working",
    reps_min: set.repsMin,
    reps_max: set.repsMax,
    reps_note: set.repsNote,
    weight_kg: set.weightKg,
    weight_note: set.weightNote,
    rpe: set.rpe,
  };
}

/** The three sets a newly added exercise starts with: immediately valid, easy to adjust. */
export const DEFAULT_NEW_SETS: (PlannedSetValues & { set_index: number })[] = [1, 2, 3].map((n) => ({
  set_index: n,
  set_type: "working" as const,
  reps_min: 8,
  reps_max: 10,
  reps_note: null,
  weight_kg: null,
  weight_note: null,
  rpe: null,
}));

export function toLoggedSet(
  row: Pick<SetLogRow, "set_index" | "weight_kg" | "reps" | "rpe" | "source" | "logged_at">,
): LoggedSet {
  return {
    setIndex: row.set_index,
    weightKg: num(row.weight_kg),
    reps: num(row.reps),
    rpe: num(row.rpe),
    source: row.source,
    loggedAt: row.logged_at,
  };
}

// ---------------------------------------------------------------------------
// Parsing trainer input
// ---------------------------------------------------------------------------

const MAX_NOTE_LENGTH = 40;
const KG_PATTERN = /^(\d{1,4}(?:[.,]\d{1,2})?)\s*(?:ק"ג|ק״ג|קג|kg)?$/i;

export type ParsedReps =
  | { repsMin: number; repsMax: number | null; repsNote: null }
  | { repsMin: null; repsMax: null; repsNote: string };

/**
 * "8" -> 8 exactly, "8-10" -> range, anything else (AMRAP, "30 שנ׳", "12
 * לכל צד") -> kept verbatim as a note. Same rules as migration 0013's
 * backfill, so an old value and a newly-typed one behave identically.
 */
export function parseRepsInput(text: string): ParsedReps | { error: string } {
  const value = text.trim();
  if (!value) return { error: "יש למלא חזרות בכל סט" };

  const single = /^(\d{1,3})$/.exec(value);
  if (single) {
    const n = Number(single[1]);
    if (n <= 0) return { error: "מספר החזרות חייב להיות גדול מ-0" };
    return { repsMin: n, repsMax: n, repsNote: null };
  }

  const range = /^(\d{1,3})\s*[-–]\s*(\d{1,3})$/.exec(value);
  if (range) {
    const min = Number(range[1]);
    const max = Number(range[2]);
    if (min <= 0 || max < min) return { error: "טווח חזרות לא תקין (למשל 8-10)" };
    return { repsMin: min, repsMax: max, repsNote: null };
  }

  if (value.length > MAX_NOTE_LENGTH) return { error: "הטקסט בשדה החזרות ארוך מדי" };
  return { repsMin: null, repsMax: null, repsNote: value };
}

export type ParsedWeight = { weightKg: number | null; weightNote: string | null };

/** "80", "82.5", "82,5", "80 ק"ג" -> kg; empty -> none; anything else -> note ("משקל גוף"). */
export function parseWeightInput(text: string): ParsedWeight | { error: string } {
  const value = text.trim();
  if (!value) return { weightKg: null, weightNote: null };

  const match = KG_PATTERN.exec(value);
  if (match) {
    const kg = Number(match[1].replace(",", "."));
    if (!Number.isFinite(kg) || kg < 0 || kg >= 10000) return { error: "משקל לא תקין" };
    return { weightKg: kg, weightNote: null };
  }

  if (value.length > MAX_NOTE_LENGTH) return { error: "הטקסט בשדה המשקל ארוך מדי" };
  return { weightKg: null, weightNote: value };
}

/** Parses a performed-set number field (what the trainee or trainer typed). Empty -> null. */
export function parseLoggedNumber(
  text: string,
  kind: "weight" | "reps" | "rpe",
): { value: number | null } | { error: string } {
  const value = text.trim().replace(",", ".");
  if (!value) return { value: null };
  const n = Number(value);
  if (!Number.isFinite(n)) {
    return { error: kind === "weight" ? "משקל לא תקין" : kind === "reps" ? "מספר חזרות לא תקין" : "RPE לא תקין" };
  }
  if (kind === "weight" && (n < 0 || n >= 10000)) return { error: "משקל לא תקין" };
  if (kind === "reps" && (!Number.isInteger(n) || n < 0 || n > 999)) return { error: "מספר חזרות לא תקין" };
  if (kind === "rpe" && (n < 1 || n > 10)) return { error: "RPE חייב להיות בין 1 ל-10" };
  return { value: n };
}

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

/** 82.5 -> "82.5", 80 -> "80" (never "80.00"). */
export function formatKg(kg: number): string {
  return String(Math.round(kg * 100) / 100);
}

export function formatRepsTarget(set: Pick<PlannedSet, "repsMin" | "repsMax" | "repsNote">): string {
  if (set.repsMin == null) return set.repsNote ?? "";
  if (set.repsMax == null || set.repsMax === set.repsMin) return String(set.repsMin);
  return `${set.repsMin}-${set.repsMax}`;
}

/** What goes back into the trainer's weight input. */
export function weightInputValue(set: Pick<PlannedSet, "weightKg" | "weightNote">): string {
  return set.weightKg != null ? formatKg(set.weightKg) : (set.weightNote ?? "");
}

/** "82.5×5", "משקל גוף × 12", "8-10 חזרות". Numbers first, weight before reps. */
export function formatSetTarget(set: Pick<PlannedSet, "repsMin" | "repsMax" | "repsNote" | "weightKg" | "weightNote">): string {
  const reps = formatRepsTarget(set);
  if (set.weightKg != null) return `${formatKg(set.weightKg)}×${reps}`;
  if (set.weightNote) return `${set.weightNote} × ${reps}`;
  return set.repsMin != null ? `${reps} חזרות` : reps;
}

/** "82.5×5", "12 חזרות", "80 ק"ג" — a performed set. */
export function formatLoggedSet(log: Pick<LoggedSet, "weightKg" | "reps">): string {
  if (log.weightKg != null && log.reps != null) return `${formatKg(log.weightKg)}×${log.reps}`;
  if (log.reps != null) return `${log.reps} חזרות`;
  if (log.weightKg != null) return `${formatKg(log.weightKg)} ק"ג`;
  return "—";
}

/**
 * One-line summary of an exercise's planned sets, for compact places
 * (collapsed builder rows, previews): "4 × 8-10 · 80 ק"ג" when every
 * working set is the same, "4 סטים · 80→90 ק"ג" when the load changes.
 * Warm-up sets are counted separately ("+ 1 חימום") so the headline number
 * is the working volume.
 */
export function summarizeSets(sets: PlannedSet[]): string {
  if (sets.length === 0) return "אין סטים";
  const warmups = sets.filter((s) => s.setType === "warmup");
  const working = sets.filter((s) => s.setType !== "warmup");
  const main = working.length > 0 ? working : sets;

  const repsValues = [...new Set(main.map(formatRepsTarget))];
  const kgValues = main.map((s) => s.weightKg).filter((kg): kg is number => kg != null);
  const notes = [...new Set(main.map((s) => s.weightNote).filter((n): n is string => Boolean(n)))];
  const rpeValues = [...new Set(main.map((s) => s.rpe).filter((r): r is number => r != null))];

  const parts: string[] = [];
  parts.push(repsValues.length === 1 ? `${main.length} × ${repsValues[0]}` : `${main.length} סטים`);

  if (kgValues.length > 0) {
    const min = Math.min(...kgValues);
    const max = Math.max(...kgValues);
    parts.push(min === max ? `${formatKg(min)} ק"ג` : `${formatKg(min)}→${formatKg(max)} ק"ג`);
  } else if (notes.length === 1) {
    parts.push(notes[0]);
  }
  if (rpeValues.length === 1) parts.push(`RPE ${rpeValues[0]}`);
  if (working.length > 0 && warmups.length > 0) parts.push(`+ ${warmups.length} חימום`);

  return parts.join(" · ");
}

/** Did a performed set reach its target? Non-numeric targets can't be judged -> true. */
export function isSetTargetMet(
  planned: Pick<PlannedSet, "repsMin" | "weightKg"> | undefined,
  log: Pick<LoggedSet, "reps" | "weightKg">,
): boolean {
  if (!planned) return true;
  if (planned.repsMin != null && (log.reps == null || log.reps < planned.repsMin)) return false;
  if (planned.weightKg != null && log.weightKg != null && log.weightKg < planned.weightKg) return false;
  return true;
}

export const SET_TYPE_LABEL: Record<SetType, string> = {
  warmup: "חימום",
  working: "רגיל",
  backoff: "Back-off",
};

/**
 * The pre-0013 single {weight, reps} value of a workout_logs row, as the
 * trainee typed it ("80 ק"ג × 8", "משקל גוף × 12"). Shown verbatim, labelled
 * as coming from before sets were split — migration 0013 only carried over
 * the values that parsed as numbers, so this is the complete original.
 */
export function formatLegacyActual(actualSets: unknown): string | null {
  if (!actualSets || typeof actualSets !== "object") return null;
  const { weight, reps } = actualSets as { weight?: unknown; reps?: unknown };
  const w = typeof weight === "string" ? weight.trim() : "";
  const r = typeof reps === "string" ? reps.trim() : "";
  if (!w && !r) return null;
  const weightText = w ? (/ק"ג|ק״ג|קג|kg/i.test(w) || !/^\d/.test(w) ? w : `${w} ק"ג`) : "";
  if (weightText && r) return `${weightText} × ${r}`;
  return weightText || `${r} חזרות`;
}
