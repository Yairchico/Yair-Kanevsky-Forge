"use client";

import { useState } from "react";
import { TrendingUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { describeProgression, describeRule, validateRule } from "@/lib/blocks";
import type { ProgressionRule } from "@/lib/exercise-editor-types";
import type { ProgressionInfo } from "@/lib/supabase/types";
import { cn } from "@/lib/utils";

const TYPE_LABEL: Record<ProgressionRule["type"], string> = {
  none: "ללא קפיצה",
  weight: "משקל",
  reps: "חזרות",
  double: "כפולה: חזרות, ואז משקל",
};

const selectClass =
  "h-9 rounded-md border border-input bg-card px-2 text-sm outline-none focus-visible:border-ring disabled:opacity-50";

function toNumber(text: string): number | null {
  const n = Number(text.replace(",", "."));
  return text.trim() !== "" && Number.isFinite(n) ? n : null;
}

/**
 * Training blocks: how one exercise moves from this week to the next
 * ("+2.5 ק״ג", "+2.6%", "+חזרה", double progression), and — above it — why
 * THIS week's targets are what they are. One line when closed; a small
 * form when the trainer taps "שנה". Shown under an exercise row in the
 * program builder for a week that belongs to a block.
 */
export function ProgressionPanel({
  rule,
  info,
  readOnly = false,
  onSave,
}: {
  rule: ProgressionRule;
  /** What the block's computation decided for this week (null: nothing before it to compute from). */
  info: ProgressionInfo | null;
  readOnly?: boolean;
  onSave: (rule: ProgressionRule) => Promise<{ error?: string }>;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(() => toDraft(rule));
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const explanation = describeProgression(info);

  function toDraft(r: ProgressionRule) {
    return {
      type: r.type,
      unit: r.unit,
      stepKg: r.stepKg != null ? String(r.stepKg) : "2.5",
      stepPct: r.stepPct != null ? String(r.stepPct) : "2.5",
      repsStep: r.repsStep != null ? String(r.repsStep) : "1",
      repsCap: r.repsCap != null ? String(r.repsCap) : "",
      basis: r.basis,
      roundingKg: String(r.roundingKg),
    };
  }

  const usesWeight = draft.type === "weight" || draft.type === "double";
  const usesReps = draft.type === "reps" || draft.type === "double";

  async function handleSave() {
    const validated = validateRule({
      type: draft.type,
      unit: draft.unit,
      stepKg: toNumber(draft.stepKg),
      stepPct: toNumber(draft.stepPct),
      repsStep: toNumber(draft.repsStep),
      repsCap: toNumber(draft.repsCap),
      basis: draft.basis,
      roundingKg: toNumber(draft.roundingKg) ?? Number.NaN,
    });
    if ("error" in validated) {
      setError(validated.error);
      return;
    }
    setSaving(true);
    const result = await onSave(validated.rule);
    setSaving(false);
    if (result.error) {
      setError(result.error);
      return;
    }
    setError(null);
    setOpen(false);
  }

  return (
    <div className="mt-2 space-y-1.5 rounded-md border border-dashed border-border px-2.5 py-2 text-xs">
      {explanation && (
        <p
          className={cn(
            explanation.tone === "up" && "text-success",
            explanation.tone === "warn" && "text-warning-foreground",
            explanation.tone === "deload" && "text-primary-text",
            (explanation.tone === "neutral" || explanation.tone === "hold") && "text-muted-foreground",
          )}
        >
          השבוע: {explanation.text}
        </p>
      )}

      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="flex items-center gap-1.5">
          <TrendingUp className="h-3.5 w-3.5 text-primary-text" />
          <span className="text-muted-foreground">קפיצה לשבוע הבא:</span>
          <span className="font-medium">{describeRule(rule)}</span>
        </p>
        {!readOnly && !open && (
          <button
            type="button"
            className="font-medium text-primary-text underline-offset-2 hover:underline"
            onClick={() => {
              setDraft(toDraft(rule));
              setError(null);
              setOpen(true);
            }}
          >
            שנה
          </button>
        )}
      </div>

      {open && (
        <div className="space-y-2 border-t border-border pt-2">
          <div className="flex flex-wrap items-center gap-2">
            <select
              aria-label="סוג הקפיצה"
              className={selectClass}
              value={draft.type}
              onChange={(e) => setDraft({ ...draft, type: e.target.value as ProgressionRule["type"] })}
            >
              {(Object.keys(TYPE_LABEL) as ProgressionRule["type"][]).map((type) => (
                <option key={type} value={type}>
                  {TYPE_LABEL[type]}
                </option>
              ))}
            </select>

            {usesReps && (
              <label className="flex items-center gap-1">
                +
                <Input
                  aria-label="קפיצת חזרות"
                  inputMode="numeric"
                  className="h-9 w-14 px-2"
                  value={draft.repsStep}
                  onChange={(e) => setDraft({ ...draft, repsStep: e.target.value })}
                />
                חזרות
              </label>
            )}
            {draft.type === "double" && (
              <label className="flex items-center gap-1">
                עד
                <Input
                  aria-label="תקרת חזרות"
                  inputMode="numeric"
                  className="h-9 w-14 px-2"
                  value={draft.repsCap}
                  placeholder="12"
                  onChange={(e) => setDraft({ ...draft, repsCap: e.target.value })}
                />
                , ואז
              </label>
            )}
            {usesWeight && (
              <label className="flex items-center gap-1">
                +
                <Input
                  aria-label="קפיצת משקל"
                  inputMode="decimal"
                  className="h-9 w-16 px-2"
                  value={draft.unit === "pct" ? draft.stepPct : draft.stepKg}
                  onChange={(e) =>
                    setDraft(draft.unit === "pct" ? { ...draft, stepPct: e.target.value } : { ...draft, stepKg: e.target.value })
                  }
                />
                <select
                  aria-label="יחידת הקפיצה"
                  className={selectClass}
                  value={draft.unit}
                  onChange={(e) => setDraft({ ...draft, unit: e.target.value as ProgressionRule["unit"] })}
                >
                  <option value="kg">ק״ג</option>
                  <option value="pct">%</option>
                </select>
              </label>
            )}
          </div>

          {draft.type !== "none" && (
            <div className="flex flex-wrap items-center gap-2">
              <select
                aria-label="מתי קופצים"
                className={selectClass}
                value={draft.basis}
                onChange={(e) => setDraft({ ...draft, basis: e.target.value as ProgressionRule["basis"] })}
              >
                <option value="actual">רק אחרי שכל הסטים הושלמו</option>
                <option value="planned">כל שבוע, בכל מקרה</option>
              </select>
            </div>
          )}

          <label className="flex flex-wrap items-center gap-1 text-muted-foreground">
            עיגול משקל מחושב ל-
            <Input
              aria-label="עיגול המשקל"
              inputMode="decimal"
              className="h-9 w-16 px-2 text-foreground"
              value={draft.roundingKg}
              onChange={(e) => setDraft({ ...draft, roundingKg: e.target.value })}
            />
            ק״ג (קפיצה באחוזים ודילואד)
          </label>

          {draft.type === "double" && (
            <p className="text-muted-foreground">
              מוסיפים חזרות כל שבוע עד התקרה; כשמגיעים אליה, המשקל עולה והחזרות חוזרות לנקודת ההתחלה.
            </p>
          )}
          {usesWeight && draft.unit === "pct" && (
            <p className="text-muted-foreground">
              המשקל המוצג תמיד מעוגל, אבל החישוב ממשיך מהמשקל המדויק — כך שגם קפיצה קטנה נצברת משבוע לשבוע.
            </p>
          )}

          {error && <p className="text-destructive">{error}</p>}

          <div className="flex gap-2">
            <Button type="button" size="sm" onClick={() => void handleSave()} disabled={saving}>
              {saving ? "שומר…" : "שמור קפיצה"}
            </Button>
            <Button type="button" size="sm" variant="outline" onClick={() => setOpen(false)}>
              ביטול
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
