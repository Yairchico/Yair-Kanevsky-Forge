import Link from "next/link";
import {
  CalendarClock,
  ChevronLeft,
  Dumbbell,
  Flame,
  History as HistoryIcon,
  PartyPopper,
  TrendingUp,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { addDays, dayName, parseDateKey } from "@/lib/week";

export interface CurrentWeekWorkout {
  id: string;
  dayOfWeek: number;
  orderIndex: number;
  submitted: boolean;
  exerciseCount: number;
  doneCount: number;
}

export interface CurrentWeekSummary {
  programTitle: string;
  weekStartDate: string;
  workouts: CurrentWeekWorkout[];
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
 * The trainee home screen's content: a greeting, this week's progress +
 * a preview of what's next (both link into /trainee/workouts rather than
 * jumping state directly — this is a separate screen now, not a strip
 * above the workout tabs), a couple of light motivational stats (a
 * completion streak, a 30-day count), a glance at the last thing actually
 * submitted, and two clear paths onward (the workouts themselves, and the
 * history log). No per-exercise detail lives here on purpose — that's the
 * workouts screen's job; this one is meant to be readable in a glance.
 */
export function HomeDashboard({
  traineeName,
  currentWeek,
  streakWeeks,
  monthlyWorkoutCount,
  lastWorkout,
}: {
  traineeName: string | null;
  currentWeek: CurrentWeekSummary | null;
  streakWeeks: number;
  monthlyWorkoutCount: number;
  lastWorkout: { label: string; dateLabel: string } | null;
}) {
  const now = new Date();
  const todayLabel = now.toLocaleDateString("he-IL", {
    weekday: "long",
    day: "numeric",
    month: "long",
  });

  const workouts = currentWeek?.workouts ?? [];
  const totalWorkouts = workouts.length;
  const doneWorkouts = workouts.filter((w) => w.submitted).length;
  const totalExercises = workouts.reduce((sum, w) => sum + w.exerciseCount, 0);
  const doneExercises = workouts.reduce((sum, w) => sum + w.doneCount, 0);
  const workoutPct = totalWorkouts > 0 ? Math.round((doneWorkouts / totalWorkouts) * 100) : 0;
  const exercisePct = totalExercises > 0 ? Math.round((doneExercises / totalExercises) * 100) : 0;

  const nextWorkout = [...workouts]
    .filter((w) => !w.submitted)
    .sort((a, b) => a.dayOfWeek - b.dayOfWeek || a.orderIndex - b.orderIndex)[0];

  function workoutLabel(w: CurrentWeekWorkout): string {
    const sameDayCount = workouts.filter((x) => x.dayOfWeek === w.dayOfWeek).length;
    return sameDayCount > 1 ? `${dayName(w.dayOfWeek)} · אימון ${w.orderIndex + 1}` : dayName(w.dayOfWeek);
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold">
          {greeting(now.getHours())}
          {traineeName ? `, ${traineeName}` : ""}
        </h1>
        <p className="text-base text-muted-foreground">{todayLabel}</p>
      </div>

      {!currentWeek ? (
        <Card>
          <CardContent className="p-6 text-base text-muted-foreground">
            עדיין אין תוכנית מפורסמת לשבוע הזה. כשהמאמן יפרסם עבורך תוכנית, היא תופיע כאן.
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          <Card>
            <CardContent className="space-y-3 p-4">
              <p className="text-sm font-semibold text-muted-foreground">התקדמות השבוע</p>

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
              <p className="text-sm font-semibold text-muted-foreground">האימון הבא</p>

              {nextWorkout ? (
                <Link
                  href="/trainee/workouts"
                  className="group -m-1 flex items-center gap-2.5 rounded-lg p-1 transition-colors hover:bg-muted"
                >
                  <CalendarClock className="h-6 w-6 shrink-0 text-primary" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-base font-medium">{workoutLabel(nextWorkout)}</p>
                    <p className="text-sm text-muted-foreground">
                      {formatDayDate(addDays(parseDateKey(currentWeek.weekStartDate), nextWorkout.dayOfWeek))}
                    </p>
                  </div>
                  <ChevronLeft className="h-5 w-5 shrink-0 text-muted-foreground transition-transform group-hover:-translate-x-0.5" />
                </Link>
              ) : (
                <div className="flex items-center gap-2.5 text-success">
                  <PartyPopper className="h-6 w-6 shrink-0" />
                  <p className="text-base font-medium">כל האימונים הוגשו השבוע!</p>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      )}

      <div className="grid grid-cols-2 gap-3">
        <Card>
          <CardContent className="flex items-center gap-3 p-4">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-warning/20 text-warning-foreground">
              <Flame className="h-5 w-5" />
            </div>
            <div className="min-w-0">
              <p className="text-xl font-bold leading-none">{streakWeeks}</p>
              <p className="truncate text-sm text-muted-foreground">
                {streakWeeks === 1 ? "שבוע רצוף" : "שבועות רצופים"}
              </p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-center gap-3 p-4">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-primary/15 text-primary">
              <TrendingUp className="h-5 w-5" />
            </div>
            <div className="min-w-0">
              <p className="text-xl font-bold leading-none">{monthlyWorkoutCount}</p>
              <p className="truncate text-sm text-muted-foreground">אימונים ב-30 יום</p>
            </div>
          </CardContent>
        </Card>
      </div>

      {lastWorkout && (
        <Card>
          <CardContent className="flex items-center justify-between gap-3 p-4">
            <div className="min-w-0">
              <p className="text-sm font-semibold text-muted-foreground">האימון האחרון שהוגש</p>
              <p className="truncate text-base font-medium">{lastWorkout.label}</p>
            </div>
            <span className="shrink-0 text-sm text-muted-foreground">{lastWorkout.dateLabel}</span>
          </CardContent>
        </Card>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        <Link href="/trainee/workouts" className="group">
          <Card className="h-full transition-shadow group-hover:shadow-sm">
            <CardContent className="flex items-center gap-3 p-4">
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-primary/15 text-primary">
                <Dumbbell className="h-5 w-5" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-base font-medium">האימונים שלי</p>
                <p className="text-sm text-muted-foreground">אימוני השבוע הנוכחי</p>
              </div>
              <ChevronLeft className="h-5 w-5 shrink-0 text-muted-foreground" />
            </CardContent>
          </Card>
        </Link>
        <Link href="/trainee/history" className="group">
          <Card className="h-full transition-shadow group-hover:shadow-sm">
            <CardContent className="flex items-center gap-3 p-4">
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-secondary text-secondary-foreground">
                <HistoryIcon className="h-5 w-5" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-base font-medium">היסטוריה</p>
                <p className="text-sm text-muted-foreground">אימונים שהוגשו</p>
              </div>
              <ChevronLeft className="h-5 w-5 shrink-0 text-muted-foreground" />
            </CardContent>
          </Card>
        </Link>
      </div>
    </div>
  );
}
