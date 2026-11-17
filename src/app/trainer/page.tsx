import Link from "next/link";
import { ArrowLeft, BookmarkCheck, CalendarCheck, Dumbbell, Play, Users } from "lucide-react";
import { getRequestAuth } from "@/lib/viewer";
import { AppShell } from "@/components/app-shell";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getWeekStart, toDateKey, dayName, israelNow } from "@/lib/week";
import { formatShortDateTime } from "@/lib/format";
import { loadFreeSessionList } from "@/lib/free-session-data";
import { isSessionStale } from "@/lib/free-sessions";
import { cn } from "@/lib/utils";

export default async function TrainerHomePage() {
  const { supabase, viewer } = await getRequestAuth();

  const currentWeekKey = toDateKey(getWeekStart(israelNow()));

  // The latest submissions, then — one more round trip — the day name of
  // each one's workout (everything else about it is on workout_completions
  // itself). Its own chain, so it doesn't wait for the slower free-session
  // list loading next to it.
  async function loadRecentCompletions() {
    const { data: recentCompletions } = await supabase
      .from("workout_completions")
      .select("workout_id, trainee_id, completed_at, source")
      .order("completed_at", { ascending: false })
      .limit(6);
    const completionWorkoutIds = (recentCompletions ?? []).map((c) => c.workout_id);
    const { data: completionWorkouts } = await supabase
      .from("workouts")
      .select("id, day_of_week")
      .in(
        "id",
        completionWorkoutIds.length ? completionWorkoutIds : ["00000000-0000-0000-0000-000000000000"],
      );
    return { recentCompletions, completionWorkouts };
  }

  // Who is asking is verified in the same wait as the data itself (nothing
  // below depends on the answer; RLS decides what each query returns).
  const [
    me,
    { data: trainees },
    { count: exerciseCount },
    { data: currentWeekPrograms },
    { recentCompletions, completionWorkouts },
    freeSessionList,
  ] = await Promise.all([
    viewer,
    supabase.from("profiles").select("id, full_name").eq("role", "trainee"),
    supabase.from("exercises").select("id", { count: "exact", head: true }),
    supabase
      .from("programs")
      .select("trainee_id, status")
      .eq("week_start_date", currentWeekKey)
      .is("deleted_at", null),
    loadRecentCompletions(),
    // Free sessions (migration 0016) — the trainer and the read-only viewer see all of them.
    loadFreeSessionList(supabase, { limit: 12 }),
  ]);

  const isReadOnly = me?.isSuperadmin === true;
  // Sessions in which nothing was performed aren't listed anywhere.
  const freeSessions = freeSessionList.filter((session) => session.setCount > 0);

  const traineeCount = trainees?.length ?? 0;
  const traineeNameById = new Map((trainees ?? []).map((t) => [t.id, t.full_name]));
  const publishedThisWeekCount = new Set(
    (currentWeekPrograms ?? [])
      .filter((p) => p.status === "published")
      .map((p) => p.trainee_id),
  ).size;

  const dayOfWeekByWorkoutId = new Map((completionWorkouts ?? []).map((w) => [w.id, w.day_of_week]));

  // "פעילות אחרונה": submitted workouts and finished free sessions, together by time.
  const activity = [
    ...(recentCompletions ?? []).map((c) => ({
      key: `${c.workout_id}-${c.trainee_id}`,
      href: `/trainer/trainees/${c.trainee_id}`,
      at: c.completed_at,
      who: traineeNameById.get(c.trainee_id) ?? "מתאמן",
      what: dayName(dayOfWeekByWorkoutId.get(c.workout_id) ?? 0),
      tag: c.source === "trainer_session" ? "אימון אישי" : null,
    })),
    ...freeSessions
      .filter((session) => session.finishedAt != null || isSessionStale(session.startedAt))
      .map((session) => ({
        key: `free-${session.id}`,
        href: `/trainer/session/free/${session.id}`,
        at: session.startedAt,
        who:
          (session.traineeId ? traineeNameById.get(session.traineeId) : null) ??
          (session.guestLabel?.trim() || "ללא שם"),
        what: "אימון חופשי",
        tag: null,
      })),
  ]
    .sort((a, b) => (a.at < b.at ? 1 : -1))
    .slice(0, 6);

  return (
    <AppShell title="אזור מאמן" username={me?.username} readOnly={isReadOnly}>
      {!isReadOnly && (
        <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
          <Link href="/trainer/session">
            <Card className="h-full border-primary bg-primary text-primary-foreground transition-opacity hover:opacity-95">
              <CardContent className="flex items-center gap-4 p-5">
                <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-primary-foreground/15">
                  <Play className="h-6 w-6" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-lg font-bold">התחל אימון אישי</p>
                  <p className="text-sm opacity-90">מתאמן מולך? תעד משקלים וחזרות בזמן אמת</p>
                </div>
                <ArrowLeft className="h-5 w-5 shrink-0" />
              </CardContent>
            </Card>
          </Link>
          <Link href="/trainer/session/templates">
            <Card className="h-full transition-shadow hover:shadow-sm">
              <CardContent className="flex h-full items-center gap-3 p-5">
                <BookmarkCheck className="h-5 w-5 shrink-0 text-primary-text" />
                <p className="font-semibold">אימונים שמורים</p>
              </CardContent>
            </Card>
          </Link>
        </div>
      )}

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
              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-primary-tint text-primary-text">
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
              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-primary-tint text-primary-text">
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
            <CalendarCheck className="h-4 w-4 text-primary-text" />
            פעילות אחרונה
          </CardTitle>
          <CardDescription>אימונים שהוגשו או תועדו לאחרונה, מכל המתאמנים</CardDescription>
        </CardHeader>
        <CardContent className="space-y-1">
          {activity.length === 0 ? (
            <p className="text-sm text-muted-foreground">אין עדיין אימונים שהוגשו.</p>
          ) : (
            activity.map((item) => (
              <Link
                key={item.key}
                href={item.href}
                className="flex items-center justify-between gap-2 rounded-md p-2 text-sm transition-colors hover:bg-hover"
              >
                <span className="truncate font-medium">
                  {item.who}
                  <span className="font-normal text-muted-foreground"> · {item.what}</span>
                  {item.tag && (
                    <span className="ms-2 rounded-full bg-primary-tint px-2 py-0.5 text-[11px] font-medium text-primary-text">
                      {item.tag}
                    </span>
                  )}
                </span>
                <span className="shrink-0 text-xs text-muted-foreground">{formatShortDateTime(item.at)}</span>
              </Link>
            ))
          )}
        </CardContent>
      </Card>

      {freeSessions.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">אימונים חופשיים</CardTitle>
            <CardDescription>ללא מתאמן, או ששויכו למתאמן</CardDescription>
          </CardHeader>
          <CardContent className="space-y-1">
            {freeSessions.slice(0, 8).map((session) => {
              const assignedTo = session.traineeId ? traineeNameById.get(session.traineeId) : null;
              return (
                <Link
                  key={session.id}
                  href={`/trainer/session/free/${session.id}`}
                  className="flex items-center justify-between gap-2 rounded-md p-2 text-sm transition-colors hover:bg-hover"
                >
                  <span className="flex min-w-0 items-center gap-2">
                    <span className="truncate font-medium">
                      {assignedTo ?? (session.guestLabel?.trim() || "ללא שם")}
                    </span>
                    <span
                      className={cn(
                        "shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium",
                        assignedTo ? "bg-success/15 text-success" : "bg-secondary text-secondary-foreground",
                      )}
                    >
                      {assignedTo ? "שויך" : "לא משויך"}
                    </span>
                    {!session.finishedAt && (
                      <span className="shrink-0 rounded-full bg-warning/20 px-2 py-0.5 text-[11px] font-medium text-warning-foreground">
                        לא הסתיים
                      </span>
                    )}
                  </span>
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {formatShortDateTime(session.startedAt)}
                  </span>
                </Link>
              );
            })}
          </CardContent>
        </Card>
      )}
    </AppShell>
  );
}
