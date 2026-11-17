"use client";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { DEFAULT_DELOAD_PCT, MAX_BLOCK_WEEKS, MAX_DELOAD_PCT, MIN_DELOAD_PCT } from "@/lib/blocks";
import { cn } from "@/lib/utils";

export interface BlockFieldValues {
  title: string;
  weeksCount: number;
  deloadWeeks: number[];
  deloadPct: number;
}

export const DEFAULT_BLOCK_FIELDS: BlockFieldValues = {
  title: "",
  weeksCount: 6,
  deloadWeeks: [],
  deloadPct: DEFAULT_DELOAD_PCT,
};

/**
 * The fields every "create a block" form has: name, length, which weeks are
 * deloads and at what percentage. Controlled (the form survives a rejected
 * submit with everything still filled in) and mirrored into real inputs so
 * a plain form action receives them.
 */
export function BlockFields({
  idPrefix,
  values,
  onChange,
}: {
  idPrefix: string;
  values: BlockFieldValues;
  onChange: (next: BlockFieldValues) => void;
}) {
  const weeks = Array.from({ length: Math.max(0, values.weeksCount - 1) }, (_, i) => i + 2);

  function setWeeksCount(raw: string) {
    const n = Math.max(1, Math.min(MAX_BLOCK_WEEKS, Math.round(Number(raw)) || 1));
    onChange({ ...values, weeksCount: n, deloadWeeks: values.deloadWeeks.filter((w) => w <= n) });
  }

  function toggleDeload(week: number) {
    onChange({
      ...values,
      deloadWeeks: values.deloadWeeks.includes(week)
        ? values.deloadWeeks.filter((w) => w !== week)
        : [...values.deloadWeeks, week].sort((a, b) => a - b),
    });
  }

  return (
    <>
      <div className="space-y-1.5">
        <Label htmlFor={`${idPrefix}-title`}>שם הבלוק</Label>
        <Input
          id={`${idPrefix}-title`}
          name="title"
          required
          maxLength={120}
          placeholder="לדוגמה: בלוק כוח 1"
          value={values.title}
          onChange={(e) => onChange({ ...values, title: e.target.value })}
        />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor={`${idPrefix}-weeks`}>מספר שבועות</Label>
        <Input
          id={`${idPrefix}-weeks`}
          name="weeks_count"
          type="number"
          inputMode="numeric"
          min={1}
          max={MAX_BLOCK_WEEKS}
          className="w-28"
          value={values.weeksCount}
          onChange={(e) => setWeeksCount(e.target.value)}
        />
        <p className="text-xs text-muted-foreground">עד {MAX_BLOCK_WEEKS} שבועות.</p>
      </div>

      {weeks.length > 0 && (
        <div className="space-y-1.5">
          <Label>שבועות דילואד (אופציונלי)</Label>
          <div className="flex flex-wrap gap-1.5">
            {weeks.map((week) => {
              const selected = values.deloadWeeks.includes(week);
              return (
                <button
                  key={week}
                  type="button"
                  aria-pressed={selected}
                  onClick={() => toggleDeload(week)}
                  className={cn(
                    "rounded-full border px-3 py-1.5 text-sm font-medium transition-colors",
                    selected
                      ? "border-primary bg-primary text-primary-foreground"
                      : "border-border bg-card hover:bg-hover",
                  )}
                >
                  שבוע {week}
                </button>
              );
            })}
          </div>
          {values.deloadWeeks.map((week) => (
            <input key={week} type="hidden" name="deload_weeks" value={week} />
          ))}
          <p className="text-xs text-muted-foreground">
            בשבוע דילואד המשקלים יורדים לאחוז מהשבוע שלפניו, והשבוע שאחריו ממשיך מאיפה שהפסקתם. אפשר להוסיף או
            להסיר דילואד גם אחר כך.
          </p>
        </div>
      )}

      <div className="space-y-1.5">
        <Label htmlFor={`${idPrefix}-pct`}>משקל בדילואד (% מהשבוע הקודם)</Label>
        <Input
          id={`${idPrefix}-pct`}
          name="deload_pct"
          type="number"
          inputMode="numeric"
          min={MIN_DELOAD_PCT}
          max={MAX_DELOAD_PCT}
          className="w-28"
          value={values.deloadPct}
          onChange={(e) => onChange({ ...values, deloadPct: Math.round(Number(e.target.value)) || 0 })}
        />
      </div>
    </>
  );
}
