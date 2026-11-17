"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { ArrowLeft, ArrowRight, Check, CloudOff, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export interface SessionChip {
  id: string;
  label: string;
  /** Every planned/opened set of it is logged. */
  done: boolean;
}

/**
 * The chrome of a trainer session screen: a sticky header (who and what,
 * whether everything is saved, progress, one chip per exercise for jumping
 * around freely) and a fixed bottom bar with previous / finish / next. No
 * timers and nothing moves on its own — the trainer drives.
 */
export function SessionFrame({
  backHref,
  title,
  subtitle,
  chips,
  activeIndex,
  onSelect,
  onAddExercise,
  setsLogged,
  setsTotal,
  pendingCount,
  onRetryPending,
  onFinish,
  finishLabel = "סיים אימון",
  children,
}: {
  backHref: string;
  title: string;
  subtitle: string;
  chips: SessionChip[];
  activeIndex: number;
  onSelect: (index: number) => void;
  /** Free sessions: a trailing "+ exercise" chip. */
  onAddExercise?: () => void;
  setsLogged: number;
  /** Planned sets; null when nothing is planned (a free session built on the fly). */
  setsTotal: number | null;
  pendingCount: number;
  onRetryPending: () => void;
  onFinish: () => void;
  finishLabel?: string;
  children: ReactNode;
}) {
  const count = chips.length;
  const progress = count > 0 ? ((activeIndex + 1) / count) * 100 : 0;

  return (
    <div className="mx-auto flex min-h-full w-full max-w-3xl flex-1 flex-col pb-24">
      <header className="sticky top-0 z-20 space-y-2 border-b border-border bg-card px-4 py-3">
        <div className="flex items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <Link
              href={backHref}
              aria-label="יציאה מהאימון"
              onClick={(e) => {
                // Sets that haven't reached the server yet are only retried
                // from this screen — don't let them be left behind unnoticed.
                if (
                  pendingCount > 0 &&
                  !window.confirm("יש סטים שעדיין לא נשמרו (אין חיבור). הם יישלחו רק כשהמסך הזה פתוח. לצאת בכל זאת?")
                ) {
                  e.preventDefault();
                }
              }}
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-border bg-card shadow-xs transition-colors hover:bg-hover"
            >
              <ArrowRight className="h-6 w-6" />
            </Link>
            <div className="min-w-0">
              <p className="truncate font-semibold leading-tight">{title}</p>
              <p className="truncate text-xs text-muted-foreground">{subtitle}</p>
            </div>
          </div>
          {pendingCount > 0 ? (
            <button
              type="button"
              onClick={onRetryPending}
              className="flex shrink-0 items-center gap-1 rounded-full bg-warning/20 px-2.5 py-1 text-xs font-medium text-warning-foreground"
            >
              <CloudOff className="h-3.5 w-3.5" />
              {pendingCount} ממתינים · נסה שוב
            </button>
          ) : (
            <span className="flex shrink-0 items-center gap-1 rounded-full bg-success/15 px-2.5 py-1 text-xs font-medium text-success">
              <Check className="h-3.5 w-3.5" />
              הכל נשמר
            </span>
          )}
        </div>

        {count > 0 && (
          <div className="flex items-center gap-2 text-sm">
            <span className="shrink-0 font-medium">
              תרגיל {activeIndex + 1} מתוך {count}
            </span>
            <div className="h-2 flex-1 overflow-hidden rounded-full bg-muted">
              <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${progress}%` }} />
            </div>
            <span className="shrink-0 text-muted-foreground">
              {setsTotal != null ? `${setsLogged}/${setsTotal} סטים` : `${setsLogged} סטים`}
            </span>
          </div>
        )}

        <div className="flex gap-2 overflow-x-auto pb-1">
          {chips.map((chip, i) => (
            <button
              key={chip.id}
              type="button"
              onClick={() => onSelect(i)}
              aria-current={i === activeIndex ? "step" : undefined}
              className={cn(
                "flex shrink-0 items-center gap-1 rounded-full px-3 py-1.5 text-sm font-medium transition-colors",
                i === activeIndex
                  ? "bg-primary text-primary-foreground"
                  : chip.done
                    ? "bg-success/15 text-success"
                    : "bg-secondary text-secondary-foreground hover:bg-hover",
              )}
            >
              {chip.done && i !== activeIndex && <Check className="h-3.5 w-3.5" />}
              {i + 1} · {chip.label}
            </button>
          ))}
          {onAddExercise && (
            <button
              type="button"
              onClick={onAddExercise}
              className="flex shrink-0 items-center gap-1 rounded-full border border-dashed border-border px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:border-primary hover:text-primary-text"
            >
              <Plus className="h-3.5 w-3.5" />
              תרגיל
            </button>
          )}
        </div>
      </header>

      <main className="flex-1 space-y-4 p-4">{children}</main>

      <div className="fixed inset-x-0 bottom-0 z-20">
        <div className="mx-auto flex max-w-3xl gap-2 border-t border-border bg-card p-3">
          <Button
            type="button"
            variant="outline"
            size="lg"
            className="flex-1"
            disabled={activeIndex <= 0}
            onClick={() => onSelect(activeIndex - 1)}
          >
            <ArrowRight className="h-5 w-5" />
            הקודם
          </Button>
          <Button type="button" variant="outline" size="lg" onClick={onFinish}>
            {finishLabel}
          </Button>
          <Button
            type="button"
            size="lg"
            className="flex-1"
            disabled={activeIndex >= count - 1}
            onClick={() => onSelect(activeIndex + 1)}
          >
            הבא
            <ArrowLeft className="h-5 w-5" />
          </Button>
        </div>
      </div>
    </div>
  );
}
