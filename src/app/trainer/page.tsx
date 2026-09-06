import Link from "next/link";
import { ArrowLeft, CalendarCheck, Dumbbell, Users } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { AppShell } from "@/components/app-shell";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getWeekStart, toDateKey, dayName } from "@/lib/week";
import { formatShortDateTime } from "@/lib/format";

export default async function TrainerHomePage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const currentWeekKey = toDateKey(getWeekStart(new Date()));

  const [
    { data: profile },
    { data: trainees },
    { count: exerciseCount },
    { data: currentWeekPrograms },
    { data: recentCompletions },
  ] = await Promise.all([
    user
      ? supabase.from("profiles").select("username").eq("id", user.id).single()
      : Promise.resolve({ data: null }),
    supabase.from("profiles").select("id, full_name").eq("role", "trainee"),
    supabase.from("exercises").select("id", { count: "exact", head: true }),
    supabase
      .from("programs")
      .select("trainee_id, status")
      .eq("week_start_date", currentWeekKey)
      .is("deleted_at", null),
    supabase
      .from("workout_completions")
      .select("workout_id, trainee_id, completed_at")
      .order("completed_at", { ascending: false })
      .limit(6),
  ]);

  const traineeCount = trainees?.length ?? 0;
  const traineeNameById = new Map((trainees ?? []).map((t) => [t.id, t.full_name]));
  const publishedThisWeekCount = new Set(
    (currentWeekPrograms ?? [])
      .filter((p) => p.status === "published")
      .map((p) => p.trainee_id),
  ).size;

  // One more round trip, only for the day name on each recent submission —
  // everything else about it (trainee name, when) is already on
  // workout_completions itself.
  const completionWorkoutIds = (recentCompletions ?? []).map((c) => c.workout_id);
  const { data: completionWorkouts } = await supabase
    .from("workouts")
    .select("id, day_of_week")
    .in(
      "id",
      completionWorkoutIds.length ? completionWorkoutIds : ["00000000-0000-0000-0000-000000000000"],
    );
  const dayOfWeekByWorkoutId = new Map((completionWorkouts ?? []).map((w) => [w.id, w.day_of_week]));

  return (
    <AppShell title="אזור מאמן" username={profile?.username}>
      <div className="grid gap-3 sm:grid-cols-3">
        <Card>
          <CardContent className="p-4">
            <p className="text-2xl font-bold">{traineeCount}</p>
            <p className="text-sm text-muted-foreground">מתאמנים</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-2xl font-bold">{exerciseCount ?? 0}</p>
            <p className="text-sm text-muted-foreground">תרגילים בספרייה</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-2xl font-bold">
              {publishedThisWeekCount}
              <span className="text-base font-normal text-muted-foreground">
                {" "}
                / {traineeCount}
              </span>
            </p>
            <p className="text-sm text-muted-foreground">תוכניות פורסמו השבוע</p>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Link href="/trainer/trainees">
          <Card className="h-full transition-shadow hover:shadow-sm">
            <CardContent className="flex items-center gap-4 p-5">
              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
                <Users className="h-6 w-6" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="font-semibold">מתאמנים</p>
                <p className="text-sm text-muted-foreground">
                  {traineeCount} מתאמנים · הוספה, עריכה ותוכניות
                </p>
              </div>
              <ArrowLeft className="h-4 w-4 shrink-0 text-muted-foreground" />
            </CardContent>
          </Card>
        </Link>

        <Link href="/trainer/exercises">
          <Card className="h-full transition-shadow hover:shadow-sm">
            <CardContent className="flex items-center gap-4 p-5">
              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
                <Dumbbell className="h-6 w-6" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="font-semibold">ספריית תרגילים</p>
                <p className="text-sm text-muted-foreground">
                  {exerciseCount ?? 0} תרגילים · חיפוש והוספת תרגיל
                </p>
              </div>
              <ArrowLeft className="h-4 w-4 shrink-0 text-muted-foreground" />
            </CardContent>
          </Card>
        </Link>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <CalendarCheck className="h-4 w-4 text-primary" />
            פעילות אחרונה
          </CardTitle>
          <CardDescription>אימונים שהוגשו לאחרונה, מכל המתאמנים</CardDescription>
        </CardHeader>
        <CardContent className="space-y-1">
          {!recentCompletions?.length ? (
            <p className="text-sm text-muted-foreground">אין עדיין אימונים שהוגשו.</p>
          ) : (
            recentCompletions.map((c) => (
              <Link
                key={`${c.workout_id}-${c.trainee_id}`}
                href={`/trainer/trainees/${c.trainee_id}`}
                className="flex items-center justify-between gap-2 rounded-md p-2 text-sm transition-colors hover:bg-muted"
              >
                <span className="truncate font-medium">
                  {traineeNameById.get(c.trainee_id) ?? "מתאמן"}
                  <span className="font-normal text-muted-foreground">
                    {" "}
                    · {dayName(dayOfWeekByWorkoutId.get(c.workout_id) ?? 0)}
                  </span>
                </span>
                <span className="shrink-0 text-xs text-muted-foreground">
                  {formatShortDateTime(c.completed_at)}
                </span>
              </Link>
            ))
          )}
        </CardContent>
      </Card>
    </AppShell>
  );
}
