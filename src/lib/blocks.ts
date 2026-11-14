/**
 * Training blocks (migration 0017): pure helpers shared by the trainer's
 * block screens, the program builder and the trainee's screens. The
 * progression itself is computed in the database
 * (block_recompute_internal); what's here is validation of what the
 * trainer types and wording for what the database decided.
 */

import type { ProgressionRule } from "@/lib/exercise-editor-types";
import { DEFAULT_PROGRESSION } from "@/lib/exercise-editor-types";
import { formatKg } from "@/lib/sets";
import type { Database, ProgressionInfo } from "@/lib/supabase/types";

type WorkoutExerciseRow = Database["public"]["Tables"]["workout_exercises"]["Row"];

export const MAX_BLOCK_WEEKS = 16;
export const MIN_DELOAD_PCT = 30;
export const MAX_DELOAD_PCT = 100;
export const DEFAULT_DELOAD_PCT = 60;

/** Columns to select for a ProgressionRule — keep in sync with ruleFromRow. */
export const RULE_COLUMNS =
  "progression_type, weight_step_unit, weight_step_kg, weight_step_pct, reps_step, reps_cap, progression_basis, rounding_kg";

type RuleColumns = Pick<
  WorkoutExerciseRow,
  | "progression_type"
  | "weight_step_unit"
  | "weight_step_kg"
  | "weight_step_pct"
  | "reps_step"
  | "reps_cap"
  | "progression_basis"
  | "rounding_kg"
>;

// numeric columns can come back from PostgREST as strings ("2.50") — normalize.
function num(value: number | string | null | undefined): number | null {
  if (value == null || value === "") return null;
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

export function ruleFromRow(row: RuleColumns): ProgressionRule {
  return {
    type: row.progression_type,
    unit: row.weight_step_unit,
    stepKg: num(row.weight_step_kg),
    stepPct: num(row.weight_step_pct),
    repsStep: num(row.reps_step),
    repsCap: num(row.reps_cap),
    basis: row.progression_basis,
    roundingKg: num(row.rounding_kg) ?? DEFAULT_PROGRESSION.roundingKg,
  };
}

/**
 * Real validation of a rule as the trainer set it (the table's CHECK
 * constraints are the backstop). Returns the rule with everything the
 * chosen type doesn't use cleared, so a stale number never lingers.
 */
export function validateRule(rule: ProgressionRule): { rule: ProgressionRule } | { error: string } {
  const type = rule.type;
  if (!["none", "weight", "reps", "double"].includes(type)) return { error: "סוג קפיצה לא תקין" };
  const unit = rule.unit === "pct" ? "pct" : "kg";
  const basis = rule.basis === "planned" ? "planned" : "actual";

  const rounding = rule.roundingKg;
  if (!Number.isFinite(rounding) || rounding <= 0 || rounding > 20) {
    return { error: "עיגול המשקל חייב להיות בין 0.25 ל-20 ק״ג" };
  }

  const usesWeight = type === "weight" || type === "double";
  const usesReps = type === "reps" || type === "double";
  let stepKg: number | null = null;
  let stepPct: number | null = null;
  let repsStep: number | null = null;
  let repsCap: number | null = null;

  if (usesWeight) {
    if (unit === "kg") {
      if (rule.stepKg == null || !Number.isFinite(rule.stepKg) || rule.stepKg <= 0 || rule.stepKg > 100) {
        return { error: "יש להזין קפיצת משקל בק״ג (גדולה מ-0, עד 100)" };
      }
      stepKg = Math.round(rule.stepKg * 100) / 100;
    } else {
      if (rule.stepPct == null || !Number.isFinite(rule.stepPct) || rule.stepPct <= 0 || rule.stepPct > 25) {
        return { error: "יש להזין קפיצת משקל באחוזים (גדולה מ-0, עד 25%)" };
      }
      stepPct = Math.round(rule.stepPct * 100) / 100;
    }
  }
  if (usesReps) {
    if (rule.repsStep == null || !Number.isInteger(rule.repsStep) || rule.repsStep < 1 || rule.repsStep > 20) {
      return { error: "יש להזין קפיצת חזרות (מספר שלם, 1 עד 20)" };
    }
    repsStep = rule.repsStep;
  }
  if (type === "double") {
    if (rule.repsCap == null || !Number.isInteger(rule.repsCap) || rule.repsCap < 1 || rule.repsCap > 200) {
      return { error: "בקפיצה כפולה יש להזין עד כמה חזרות מעלים לפני שמוסיפים משקל" };
    }
    repsCap = rule.repsCap;
  }

  return {
    rule: {
      type,
      unit: usesWeight ? unit : "kg",
      stepKg,
      stepPct,
      repsStep,
      repsCap,
      basis: type === "none" ? "actual" : basis,
      roundingKg: Math.round(rounding * 100) / 100,
    },
  };
}

function weightStepLabel(rule: ProgressionRule): string {
  if (rule.unit === "pct" && rule.stepPct != null) return `+${formatKg(rule.stepPct)}%`;
  if (rule.stepKg != null) return `+${formatKg(rule.stepKg)} ק״ג`;
  return "";
}

function repsStepLabel(step: number | null): string {
  if (step == null) return "";
  return step === 1 ? "+חזרה אחת" : `+${step} חזרות`;
}

/** One line for an exercise's rule, e.g. "+2.5 ק״ג כל שבוע". */
export function describeRule(rule: ProgressionRule | undefined): string {
  if (!rule || rule.type === "none") return "ללא קפיצה";
  const basis = rule.basis === "planned" ? " (בכל מקרה)" : "";
  if (rule.type === "weight") return `${weightStepLabel(rule)} כל שבוע${basis}`;
  if (rule.type === "reps") return `${repsStepLabel(rule.repsStep)} כל שבוע${basis}`;
  return `${repsStepLabel(rule.repsStep)} עד ${rule.repsCap}, ואז ${weightStepLabel(rule)}${basis}`;
}

function deltaLabel(info: ProgressionInfo): string {
  const parts: string[] = [];
  if (info.delta_kg) parts.push(`${info.delta_kg > 0 ? "+" : "−"}${formatKg(Math.abs(Number(info.delta_kg)))} ק״ג`);
  if (info.delta_reps) {
    const n = Math.abs(Number(info.delta_reps));
    parts.push(`${info.delta_reps > 0 ? "+" : "−"}${n === 1 ? "חזרה אחת" : `${n} חזרות`}`);
  }
  return parts.join(", ");
}

export type ProgressionTone = "up" | "hold" | "warn" | "deload" | "neutral";

/**
 * Why a block week's targets for one exercise are what they are — the
 * explanation the trainer sees next to a computed target ("a number that
 * changes by itself must always say why").
 */
export function describeProgression(info: ProgressionInfo | null | undefined): { text: string; tone: ProgressionTone } | null {
  if (!info) return null;
  const from = `שבוע ${info.base_week}`;
  const exact =
    info.exact_kg != null ? ` · מדויק ${formatKg(Number(info.exact_kg))} ק״ג, מוצג מעוגל` : "";
  const delta = deltaLabel(info);

  switch (info.outcome) {
    case "advanced":
      if (info.reset_reps) return { text: `הגיע לתקרת החזרות ב${from}: ${delta || "קפיצת משקל"}${exact}`, tone: "up" };
      if (!delta) {
        return {
          text: `${from} הושלם · הקפיצה נצברת ותורגש בהמשך${exact}`,
          tone: "hold",
        };
      }
      return { text: `${delta} אחרי ${from}${exact}`, tone: "up" };
    case "projected":
      return {
        text: delta ? `תחזית: ${delta}, אם ${from} יושלם${exact}` : `תחזית, אם ${from} יושלם${exact}`,
        tone: "neutral",
      };
    case "repeated":
      return {
        text:
          info.completed != null && info.total != null
            ? `חוזרים על היעד: ב${from} הושלמו ${info.completed}/${info.total} סטים`
            : `חוזרים על היעד של ${from}`,
        tone: "warn",
      };
    case "skipped":
      return { text: `לא בוצע ב${from}, הקפיצה נדחתה`, tone: "warn" };
    case "deload":
      return { text: `דילואד: ${info.deload_pct ?? DEFAULT_DELOAD_PCT}% מ${from}`, tone: "deload" };
    case "none":
      return { text: `כמו ב${from} (ללא קפיצה)`, tone: "neutral" };
    default:
      return null;
  }
}

/**
 * What the trainee sees: only that the target went up, and by how much
 * (QUESTIONS.md Q2.6 — the full reasoning is for the trainer).
 */
export function traineeJumpLabel(info: ProgressionInfo | null | undefined): string | null {
  if (!info || (info.outcome !== "advanced" && info.outcome !== "projected")) return null;
  const increase = { ...info, delta_kg: (info.delta_kg ?? 0) > 0 ? info.delta_kg : undefined, delta_reps: (info.delta_reps ?? 0) > 0 ? info.delta_reps : undefined };
  const delta = deltaLabel(increase);
  return delta ? `${delta} מהפעם הקודמת` : null;
}

/** "בלוק כוח 1 · שבוע 3 מתוך 6" */
export function blockWeekLabel(title: string, weekIndex: number | null, weeksCount: number, isDeload = false): string {
  const week = weekIndex != null ? ` · שבוע ${weekIndex} מתוך ${weeksCount}` : "";
  return `${title}${week}${isDeload ? " · דילואד" : ""}`;
}

function formatErrorDate(message: string): string {
  const match = /(\d{4})-(\d{2})-(\d{2})/.exec(message);
  return match ? `${Number(match[3])}/${Number(match[2])}` : "";
}

/**
 * A readable Hebrew message for an error from one of the block functions
 * (migration 0017). BK001/BK002 carry the week's date in their message.
 */
export function blockErrorMessage(error: { code?: string; message?: string } | null, fallback: string): string {
  if (!error) return fallback;
  const date = formatErrorDate(error.message ?? "");
  if (error.code === "BK001") {
    return `בשבוע שמתחיל ב-${date} כבר יש תוכנית אחרת`;
  }
  if (error.code === "BK002") {
    return `השבוע שמתחיל ב-${date} כבר התחיל (יש בו ביצוע מתועד), ולכן אי אפשר לשנות אותו כך`;
  }
  if (error.code === "42501") return "אין הרשאה לבצע פעולה זו";
  if (error.code === "P0002") return "הבלוק או השבוע לא נמצאו";
  return fallback;
}
