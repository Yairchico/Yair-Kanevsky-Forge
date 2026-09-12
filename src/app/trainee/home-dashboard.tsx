"use client";

import { useState } from "react";
import Link from "next/link";
import {
  CalendarClock,
  ChevronLeft,
  ChevronRight,
  Dumbbell,
  Flame,
  History as HistoryIcon,
  PartyPopper,
  TrendingUp,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { buttonVariants } from "@/components/ui/button";
import { addDays, dayName, formatWeekLabel, formatWeekRange, parseDateKey } from "@/lib/week";

export interface BrowsableWeekWorkout {
  id: string;
  dayOfWeek: number;
  orderIndex: number;
  submitted: boolean;
  exerciseCount: number;
  doneCount: number;
}

export interface BrowsableWeek {
  weekStartDate: string;
  /** null when the trainer hasn't published a program for this week at all. */
  program: { title: string; workouts: BrowsableWeekWorkout[] } | null;
}

/** "9.9" — matches the short numeric style already used elsewhere (formatWeekRange). */
function formatDayDate(date: Date): string {
  return `${date.getDate()}.${date.getMonth() + 1}`;
}

function greeting(hour: number): string {
  if (hour < 5) return "לילה טוב";
  if (hour < 12) return "בוקר טוב";
  if (hour < 18) return "צהריים טובים";
  return "ערב טוב";
}

/**
 * The trainee home screen's content: a greeting, a week pager + that
 * week's summary (browsable up to a month either way — same ±4-week
 * range /trainee/workouts fetches, see WEEK_OFFSETS in both page.tsx
 * files), a couple of light motivational stats that stay put regardless
 * of which week is browsed (a completion streak, a 30-day count), and
 * two clear paths onward (the workouts screen, and the history log).
 *
 * The pager sits ABOVE the week-summary card on purpose, and that card's
 * own layout stays constant (a fixed two-column grid, or the "no program"
 * card, never a variable-height stack) — otherwise the prev/next buttons
 * would shift up and down as their content above changed size while
 * browsing, which is exactly what made the first version of this
 * uncomfortable to use.
 */
export function HomeDashboard({
  traineeName,
  currentWeekKey,
  weeks,
  streakWeeks,
  monthlyWorkoutCount,
}: {
  traineeName: string | null;
  currentWeekKey: string;
  weeks: BrowsableWeek[];
  streakWeeks: number;
  monthlyWorkoutCount: number;
}) {
  const [activeIndex, setActiveIndex] = useState(() => Math.floor(weeks.length / 2));

  const now = new Date();
  const todayLabel = now.toLocaleDateString("he-IL", {
    weekday: "long",
    day: "numeric",
    month: "long",
  });

  const activeWeek = weeks[activeIndex];
  const isCurrentWeek = activeWeek?.weekStartDate === currentWeekKey;
  const weekStart = activeWeek ? parseDateKey(activeWeek.weekStartDate) : null;

  const workouts = activeWeek?.program?.workouts ?? [];
  const totalWorkouts = workouts.length;
  const doneWorkouts = workouts.filter((w) => w.submitted).length;
  const totalExercises = workouts.reduce((sum, w) => sum + w.exerciseCount, 0);
  const doneExercises = workouts.reduce((sum, w) => sum + w.doneCount, 0);
  const workoutPct = totalWorkouts > 0 ? Math.round((doneWorkouts / totalWorkouts) * 100) : 0;
  const exercisePct = totalExercises > 0 ? Math.round((doneExercises / totalExercises) * 100) : 0;

  const nextWorkout = isCurrentWeek
    ? [...workouts]
        .filter((w) => !w.submitted)
        .sort((a, b) => a.dayOfWeek - b.dayOfWeek || a.orderIndex - b.orderIndex)[0]
    : undefined;

  function workoutLabel(w: BrowsableWeekWorkout): string {
    const sameDayCount = workouts.filter((x) => x.dayOfWeek === w.dayOfWeek).length;
    return sameDayCount > 1 ? `${dayName(w.dayOfWeek)} · אימון ${w.orderIndex + 1}` : dayName(w.dayOfWeek);
  }

  const viewProgramHref = activeWeek ? `/trainee/workouts?week=${activeWeek.weekStartDate}` : "/trainee/workouts";

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold">
          {greeting(now.getHours())}
          {traineeName ? `, ${traineeName}` : ""}
        </h1>
        <p className="text-base text-muted-foreground">{todayLabel}</p>
      </div>

      <div className="flex items-center justify-between gap-2 rounded-xl border border-border bg-card p-3">
        <button
          type="button"
          disabled={activeIndex <= 0}
          onClick={() => setActiveIndex((i) => Math.max(0, i - 1))}
          className="flex shrink-0 items-center gap-1 rounded-full px-3 py-1.5 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:pointer-events-none disabled:opacity-40"
        >
          <ChevronRight className="h-4 w-4" />
          שבוע קודם
        </button>

        <div className="text-center">
          <p className="text-sm font-medium">{weekStart && formatWeekLabel(weekStart)}</p>
          <p className="text-xs text-muted-foreground">{weekStart && formatWeekRange(weekStart)}</p>
        </div>

        <button
          type="button"
          disabled={activeIndex >= weeks.length - 1}
          onClick={() => setActiveIndex((i) => Math.min(weeks.length - 1, i + 1))}
          className="flex shrink-0 items-center gap-1 rounded-full px-3 py-1.5 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:pointer-events-none disabled:opacity-40"
        >
          שבוע הבא
          <ChevronLeft className="h-4 w-4" />
        </button>
      </div>

      {!activeWeek?.program ? (
        <Card>
          <CardContent className="p-6 text-base text-muted-foreground">
            אין תוכנית מפורסמת לשבוע זה.
            {isCurrentWeek && " כשהמאמן יפרסם עבורך תוכנית, היא תופיע כאן."}
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          <Card>
            <CardContent className="space-y-3 p-4">
              <p className="text-sm font-semibold text-muted-foreground">
                {isCurrentWeek ? "התקדמות השבוע" : "סיכום השבוע"}
              </p>

              <div className="space-y-1.5">
                <div className="flex items-center justify-between text-sm">
                  <span>אימונים</span>
                  <span className="font-medium">
                    {doneWorkouts}/{totalWorkouts}
                  </span>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full rounded-full bg-primary transition-[width]"
                    style={{ width: `${workoutPct}%` }}
                  />
                </div>
              </div>

              {totalExercises > 0 && (
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between text-sm">
                    <span>תרגילים</span>
                    <span className="font-medium">
                      {doneExercises}/{totalExercises}
                    </span>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-muted">
                    <div
                      className="h-full rounded-full bg-primary/60 transition-[width]"
                      style={{ width: `${exercisePct}%` }}
                    />
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardContent className="flex flex-col gap-2.5 p-4">
              <p className="text-sm font-semibold text-muted-foreground">
                {isCurrentWeek ? "האימון הבא" : "התוכנית לשבוע זה"}
              </p>

              {isCurrentWeek && nextWorkout ? (
                <Link
                  href={viewProgramHref}
                  className="group -m-1 flex items-center gap-2.5 rounded-lg p-1 transition-colors hover:bg-muted"
                >
                  <CalendarClock className="h-6 w-6 shrink-0 text-primary" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-base font-medium">{workoutLabel(nextWorkout)}</p>
                    <p className="text-sm text-muted-foreground">
                      {formatDayDate(addDays(weekStart!, nextWorkout.dayOfWeek))}
                    </p>
                  </div>
                  <ChevronLeft className="h-5 w-5 shrink-0 text-muted-foreground transition-transform group-hover:-translate-x-0.5" />
                </Link>
              ) : isCurrentWeek ? (
                <div className="flex items-center gap-2.5 text-success">
                  <PartyPopper className="h-6 w-6 shrink-0" />
                  <p className="text-base font-medium">כל האימונים הוגשו השבוע!</p>
                </div>
              ) : (
                <>
                  <p className="truncate text-base font-medium">{activeWeek.program.title}</p>
                  <p className="text-sm text-muted-foreground">
                    {totalWorkouts} {totalWorkouts === 1 ? "אימון מתוכנן" : "אימונים מתוכננים"}
                  </p>
                  <Link href={viewProgramHref} className={buttonVariants({ variant: "outline", size: "sm" })}>
                    לצפייה בתוכנית
                  </Link>
                </>
              )}
            </CardContent>
          </Card>
        </div>
      )}

      <div className="grid grid-cols-2 gap-3">
        <Card className="border-warning/30 bg-gradient-to-b from-warning/10 to-transparent">
          <CardContent className="flex min-h-[10.5rem] flex-col items-center justify-center gap-3 p-6 text-center">
            <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl bg-warning/20 text-warning-foreground">
              <Flame className="h-8 w-8" />
            </div>
            <div>
              <p className="text-4xl font-extrabold leading-none">{streakWeeks}</p>
              <p className="mt-1.5 text-sm font-medium text-muted-foreground">
                {streakWeeks === 1 ? "שבוע רצוף" : "שבועות רצופים"}
              </p>
            </div>
          </CardContent>
        </Card>
        <Card className="border-primary/30 bg-gradient-to-b from-primary/10 to-transparent">
          <CardContent className="flex min-h-[10.5rem] flex-col items-center justify-center gap-3 p-6 text-center">
            <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl bg-primary/15 text-primary">
              <TrendingUp className="h-8 w-8" />
            </div>
            <div>
              <p className="text-4xl font-extrabold leading-none">{monthlyWorkoutCount}</p>
              <p className="mt-1.5 text-sm font-medium text-muted-foreground">אימונים ב-30 יום</p>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <Link href="/trainee/workouts" className="group">
          <Card className="h-full transition-all group-hover:-translate-y-0.5 group-hover:shadow-md">
            <CardContent className="flex min-h-[11rem] flex-col items-center justify-center gap-3 p-6 text-center">
              <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl bg-primary/15 text-primary">
                <Dumbbell className="h-8 w-8" />
              </div>
              <div>
                <p className="text-base font-semibold">האימונים שלי</p>
                <p className="mt-1 text-sm text-muted-foreground">אימוני השבוע הנוכחי</p>
              </div>
              <ChevronLeft className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-hover:-translate-x-0.5" />
            </CardContent>
          </Card>
        </Link>
        <Link href="/trainee/history" className="group">
          <Card className="h-full transition-all group-hover:-translate-y-0.5 group-hover:shadow-md">
            <CardContent className="flex min-h-[11rem] flex-col items-center justify-center gap-3 p-6 text-center">
              <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl bg-secondary text-secondary-foreground">
                <HistoryIcon className="h-8 w-8" />
              </div>
              <div>
                <p className="text-base font-semibold">היסטוריה</p>
                <p className="mt-1 text-sm text-muted-foreground">אימונים שהוגשו</p>
              </div>
              <ChevronLeft className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-hover:-translate-x-0.5" />
            </CardContent>
          </Card>
        </Link>
      </div>
    </div>
  );
}
