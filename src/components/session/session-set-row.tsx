"use client";

import { Check, Minus, Plus, RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";
import { SET_TYPE_LABEL, formatLoggedSet, formatSetTarget, type LoggedSet, type PlannedSet } from "@/lib/sets";
import type { SetDraft } from "@/lib/workout-draft";
import type { SetRowState } from "@/lib/use-set-entry";

function Stepper({
  label,
  ariaLabel,
  value,
  placeholder,
  inputMode,
  disabled,
  onChange,
  onStep,
}: {
  label: string;
  ariaLabel: string;
  value: string;
  placeholder: string;
  inputMode: "decimal" | "numeric";
  disabled: boolean;
  onChange: (value: string) => void;
  onStep: (direction: 1 | -1) => void;
}) {
  const stepButton =
    "flex h-12 w-10 items-center justify-center border border-input bg-muted text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground active:scale-95 disabled:pointer-events-none disabled:opacity-40";
  return (
    <div className="flex flex-col items-center gap-0.5">
      <span className="text-[11px] text-muted-foreground">{label}</span>
      <div className="flex items-center">
        <button
          type="button"
          onClick={() => onStep(-1)}
          disabled={disabled}
          aria-label={`הפחת ${ariaLabel}`}
          className={cn(stepButton, "rounded-s-md")}
        >
          <Minus className="h-4 w-4" />
        </button>
        <input
          inputMode={inputMode}
          aria-label={ariaLabel}
          disabled={disabled}
          value={value}
          placeholder={placeholder}
          onChange={(e) => onChange(e.target.value)}
          className="h-12 w-16 border-y border-input bg-card text-center text-lg font-semibold outline-none placeholder:font-normal placeholder:text-subtle focus-visible:border-ring disabled:opacity-50"
        />
        <button
          type="button"
          onClick={() => onStep(1)}
          disabled={disabled}
          aria-label={`הוסף ${ariaLabel}`}
          className={cn(stepButton, "rounded-e-md")}
        >
          <Plus className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}

/**
 * One set on the trainer's session screens (with a trainee, or free): built
 * for a phone held in one hand next to a barbell — the target and what
 * happened last time on top, − / + steppers for weight and reps so nothing
 * has to be typed, and a large ✓ that saves the set immediately. An empty
 * field means "the grey number showing in it" (the target, or the previous
 * set). State comes from useSetEntry.
 */
export function SessionSetRow({
  setIndex,
  planned,
  previous,
  values,
  placeholder,
  state,
  saving,
  editable,
  isNext,
  weightStep = 2.5,
  onChange,
  onStep,
  onConfirm,
}: {
  setIndex: number;
  planned: PlannedSet | undefined;
  previous: LoggedSet | undefined;
  values: SetDraft;
  placeholder: { weight: string; reps: string };
  state: SetRowState;
  saving: boolean;
  editable: boolean;
  isNext: boolean;
  /** How much one tap of − / + changes the weight. */
  weightStep?: number;
  onChange: (next: Partial<Pick<SetDraft, "weight" | "reps">>) => void;
  onStep: (field: "weight" | "reps", delta: number) => void;
  onConfirm: () => void;
}) {
  const saved = state === "logged" || state === "logged-short";

  return (
    <div
      className={cn(
        "space-y-2 rounded-xl border p-3 transition-colors",
        state === "logged" && "border-success/40 bg-success/5",
        (state === "logged-short" || state === "pending") && "border-warning/40 bg-warning/5",
        state === "changed" && "border-primary/50 bg-card",
        state === "open" && (isNext ? "border-primary bg-card ring-2 ring-primary-deep" : "border-border bg-card"),
      )}
    >
      <div className="flex items-center gap-3">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary text-base font-bold text-primary-foreground">
          {setIndex}
        </div>
        <div className="min-w-0 flex-1">
          <p className="flex flex-wrap items-center gap-1.5 text-base font-semibold">
            <span dir="ltr">{planned ? formatSetTarget(planned) : `סט ${setIndex}`}</span>
            {planned?.setType === "warmup" && (
              <span className="rounded-full bg-secondary px-1.5 py-0.5 text-[10px] font-normal text-muted-foreground">
                {SET_TYPE_LABEL.warmup}
              </span>
            )}
            {planned?.rpe != null && (
              <span className="text-xs font-normal text-muted-foreground">RPE {planned.rpe}</span>
            )}
          </p>
          <p className="text-xs text-muted-foreground">
            {previous ? (
              <>
                בפעם הקודמת: <span dir="ltr">{formatLoggedSet(previous)}</span>
              </>
            ) : state === "logged" ? (
              "נשמר ✓"
            ) : state === "logged-short" ? (
              "נשמר · פחות מהיעד"
            ) : state === "pending" ? (
              "ממתין לחיבור — יישלח שוב אוטומטית"
            ) : state === "changed" ? (
              "לחצו ✓ כדי לשמור את השינוי"
            ) : (
              " "
            )}
          </p>
        </div>
        <button
          type="button"
          onClick={onConfirm}
          disabled={!editable || saving}
          aria-label={saved ? `ביטול סט ${setIndex}` : `אישור סט ${setIndex}`}
          aria-pressed={saved}
          className={cn(
            "flex h-14 w-14 shrink-0 items-center justify-center rounded-full border-2 transition-colors active:scale-95 disabled:opacity-50",
            state === "logged" && "border-success bg-success text-success-foreground",
            state === "logged-short" && "border-warning bg-warning/20 text-warning-foreground",
            state === "pending" && "border-warning bg-warning/15 text-warning-foreground",
            state === "changed" && "border-primary bg-primary text-primary-foreground",
            state === "open" && "border-primary/60 bg-card text-primary-text hover:bg-primary-tint",
          )}
        >
          {state === "pending" ? (
            <RefreshCw className={cn("h-6 w-6", saving && "animate-spin")} />
          ) : (
            <Check className="h-7 w-7" />
          )}
        </button>
      </div>

      <div className="flex items-end justify-center gap-3">
        <Stepper
          label='ק"ג'
          ariaLabel={`משקל בסט ${setIndex}`}
          value={values.weight}
          placeholder={placeholder.weight}
          inputMode="decimal"
          disabled={!editable}
          onChange={(weight) => onChange({ weight })}
          onStep={(direction) => onStep("weight", direction * weightStep)}
        />
        <span className="pb-3.5 text-muted-foreground">×</span>
        <Stepper
          label="חזרות"
          ariaLabel={`חזרות בסט ${setIndex}`}
          value={values.reps}
          placeholder={placeholder.reps}
          inputMode="numeric"
          disabled={!editable}
          onChange={(reps) => onChange({ reps })}
          onStep={(direction) => onStep("reps", direction)}
        />
      </div>

      {previous && state !== "open" && (
        <p
          className={cn(
            "text-center text-[11px]",
            state === "logged" ? "text-success" : state === "changed" ? "text-muted-foreground" : "text-warning-foreground",
          )}
        >
          {state === "logged"
            ? "נשמר ✓"
            : state === "logged-short"
              ? "נשמר · פחות מהיעד"
              : state === "pending"
                ? "ממתין לחיבור — יישלח שוב אוטומטית"
                : "לחצו ✓ כדי לשמור את השינוי"}
        </p>
      )}
    </div>
  );
}
