"use client";

import { useState } from "react";
import { ChevronLeft, ChevronRight, PackageOpen } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { formatWeekLabel, formatWeekRange, parseDateKey } from "@/lib/week";
import { TraineeWorkoutTabs, type WorkoutData } from "./trainee-workout-tabs";

export interface WeekSlot {
  weekStartDate: string;
  /** null when the trainer hasn't published a program for this week at all. */
  program: { title: string; workouts: WorkoutData[] } | null;
}

/**
 * Wraps TraineeWorkoutTabs with a way to move between weeks — up to a
 * month back and a month forward (see WEEK_OFFSETS in
 * src/app/trainee/workouts/page.tsx, which fetches every week in that
 * range up front so switching is a local state change, not a server
 * round trip). The pager sits ABOVE the week's content and stays there —
 * putting it below meant its vertical position shifted every time the
 * content above it changed height (a full workout list vs. a short "no
 * program" card), which felt like the page was jumping around.
 *
 * Opens on `initialWeek` if given and present in `weeks` (the home
 * screen's "לצפייה בתוכנית" link passes the week it was showing, see
 * home-dashboard.tsx), otherwise the current week — the middle slot,
 * since `weeks` is always the fixed, complete ±4-week range WEEK_OFFSETS
 * builds, ordered -4 to +4 with offset 0 (this week) exactly in the
 * middle.
 */
export function TraineeWeekBrowser({
  weeks,
  initialWeek,
}: {
  weeks: WeekSlot[];
  initialWeek?: string;
}) {
  const [activeIndex, setActiveIndex] = useState(() => {
    if (initialWeek) {
      const index = weeks.findIndex((w) => w.weekStartDate === initialWeek);
      if (index !== -1) return index;
    }
    return Math.floor(weeks.length / 2);
  });

  const activeWeek = weeks[activeIndex];
  if (!activeWeek) return null;

  const weekStart = parseDateKey(activeWeek.weekStartDate);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2 rounded-xl border border-border bg-card p-3">
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={activeIndex <= 0}
          onClick={() => setActiveIndex((i) => Math.max(0, i - 1))}
        >
          <ChevronRight className="h-4 w-4" />
          שבוע קודם
        </Button>

        <div className="text-center">
          <p className="text-sm font-medium">{formatWeekLabel(weekStart)}</p>
          <p className="text-xs text-muted-foreground">{formatWeekRange(weekStart)}</p>
        </div>

        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={activeIndex >= weeks.length - 1}
          onClick={() => setActiveIndex((i) => Math.min(weeks.length - 1, i + 1))}
        >
          שבוע הבא
          <ChevronLeft className="h-4 w-4" />
        </Button>
      </div>

      {activeWeek.program ? (
        <>
          <p className="text-base font-semibold">{activeWeek.program.title}</p>
          <TraineeWorkoutTabs key={activeWeek.weekStartDate} workouts={activeWeek.program.workouts} />
        </>
      ) : (
        <Card>
          <CardContent className="flex flex-col items-center gap-2 p-10 text-center">
            <PackageOpen className="h-8 w-8 text-muted-foreground/50" />
            <p className="text-base font-medium">אין תוכנית מפורסמת לשבוע הזה</p>
            <p className="text-sm text-muted-foreground">
              כשהמאמן יפרסם תוכנית לשבוע הזה, היא תופיע כאן.
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
