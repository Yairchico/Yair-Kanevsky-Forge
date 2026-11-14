import Link from "next/link";
import { redirect } from "next/navigation";
import { AlertTriangle, BookmarkCheck, Check, Clock } from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { formatShortDateTime, countExercises, countSets } from "@/lib/format";
import { loadFreeSessionList } from "@/lib/free-session-data";
import { isSessionStale } from "@/lib/free-sessions";
import { selectInChunks } from "@/lib/previous-sets";
import { getTrainerContext } from "@/lib/require-trainer";
import { cn, isUuid } from "@/lib/utils";
import {
  addDays,
  dayName,
  formatWeekLabel,
  formatWeekRange,
  getWeekStart,
  israelNow,
  parseDateKey,
  toDateKey,
} from "@/lib/week";
import {
  StartFreeSessionForm,
  StartWorkoutButton,
  TemplateStartList,
  TraineePickList,
  type PickerTrainee,
} from "./session-picker";

const NO_ROWS = ["00000000-0000-0000-0000-000000000000"];

/**
 * Where a trainer-led session starts (planning/PLAN.md features 5, 5b,
 * 5c): pick a trainee and one of their planned workouts, start a free
 * session (for a trainee with nothing planned, or for nobody), or start
 * from a saved workout. Trainer only — everything here leads to a write,
 * so the read-only viewer is sent back to the home screen.
 */
export default async function SessionPickerPage({
  searchParams,
}: {
  searchParams: Promise<{ trainee?: string; week?: string; mode?: string }>;
}) {
  const params = await searchParams;
  const ctx = await getTrainerContext();
  if (!ctx) redirect("/trainer");
  const { supabase } = ctx;

  const mode = params.mode === "free" ? "free" : "trainee";
  const now = israelNow();
  const currentWeekStart = getWeekStart(now);
  const currentWeekKey = toDateKey(currentWeekStart);
  const todayIndex = now.getDay();

  const [{ data: traineeRows }, { data: weekPrograms }, { data: templateRows }, freeSessions] = await Promise.all([
    supabase
      .from("profiles")
      .select("id, full_name")
      .eq("role", "trainee")
      .eq("is_superadmin", false)
      .eq("status", "active")
      .order("full_name"),
    supabase
      .from("programs")
      .select("id, trainee_id, status")
      .eq("week_start_date", currentWeekKey)
      .is("deleted_at", null),
    supabase
      .from("session_templates")
      .select("id, title")
      .is("deleted_at", null)
      .order("updated_at", { ascending: false }),
    loadFreeSessionList(supabase, { limit: 20 }),
  ]);

  const trainees = traineeRows ?? [];
  const traineeOptions = trainees.map((t) => ({ id: t.id, name: t.full_name }));
  const traineeNameById = new Map(trainees.map((t) => [t.id, t.full_name]));
  const selectedTrainee =
    mode === "trainee" && isUuid(params.trainee) ? (trainees.find((t) => t.id === params.trainee) ?? null) : null;

  const templateExercises = await selectInChunks(
    (templateRows ?? []).map((t) => t.id),
    (chunk) => supabase.from("session_template_exercises").select("template_id").in("template_id", chunk),
  );
  const templates = (templateRows ?? []).map((t) => ({
    id: t.id,
    title: t.title,
    exerciseCount: templateExercises.filter((e) => e.template_id === t.id).length,
  }));

  // Still worth offering "continue": opened in the last day, or left open with sets in it.
  const openSessions = freeSessions.filter(
    (s) => !s.finishedAt && (s.setCount > 0 || !isSessionStale(s.startedAt)),
  );

  // ---- step 1: every trainee, with what this week looks like for them
  let pickList: PickerTrainee[] = [];
  if (mode === "trainee" && !selectedTrainee) {
    const programs = weekPrograms ?? [];
    const { data: weekWorkouts } = await supabase
      .from("workouts")
      .select("id, program_id")
      .in("program_id", programs.length ? programs.map((p) => p.id) : NO_ROWS);
    const workoutIds = (weekWorkouts ?? []).map((w) => w.id);
    const completions = await selectInChunks(workoutIds, (chunk) =>
      supabase.from("workout_completions").select("workout_id").in("workout_id", chunk),
    );
    const doneWorkoutIds = new Set(completions.map((c) => c.workout_id));
    const programByTrainee = new Map(programs.map((p) => [p.trainee_id, p]));

    pickList = trainees.map((t) => {
      const program = programByTrainee.get(t.id);
      if (!program) return { id: t.id, name: t.full_name, subtitle: "אין תוכנית לשבוע הזה" };
      const workouts = (weekWorkouts ?? []).filter((w) => w.program_id === program.id);
      const done = workouts.filter((w) => doneWorkoutIds.has(w.id)).length;
      return {
        id: t.id,
        name: t.full_name,
        subtitle:
          workouts.length === 0
            ? "התוכנית של השבוע ריקה"
            : `${done}/${workouts.length} אימונים בוצעו${program.status === "draft" ? " · טיוטה" : ""}`,
      };
    });
  }

  // ---- step 2: the selected trainee's workouts for the chosen week
  let weekView: {
    weekKey: string;
    program: { id: string; title: string; status: "draft" | "published" } | null;
    workouts: {
      id: string;
      label: string;
      isToday: boolean;
      exerciseCount: number;
      exerciseNames: string[];
      submitted: boolean;
    }[];
    otherWeeks: { weekKey: string; title: string }[];
  } | null = null;

  if (selectedTrainee) {
    const { data: programs } = await supabase
      .from("programs")
      .select("id, title, status, week_start_date")
      .eq("trainee_id", selectedTrainee.id)
      .is("deleted_at", null)
      .gte("week_start_date", toDateKey(addDays(currentWeekStart, -4 * 7)))
      .lte("week_start_date", toDateKey(addDays(currentWeekStart, 4 * 7)))
      .order("week_start_date", { ascending: false });

    const weekKey =
      params.week && (programs ?? []).some((p) => p.week_start_date === params.week) ? params.week : currentWeekKey;
    const program = (programs ?? []).find((p) => p.week_start_date === weekKey) ?? null;

    const { data: workouts } = await supabase
      .from("workouts")
      .select("id, day_of_week, order_index")
      .eq("program_id", program?.id ?? NO_ROWS[0])
      .order("day_of_week")
      .order("order_index");
    const workoutIds = (workouts ?? []).map((w) => w.id);

    const [workoutExercises, { data: completions }] = await Promise.all([
      selectInChunks(workoutIds, (chunk) =>
        supabase
          .from("workout_exercises")
          .select("workout_id, exercise_id, order_index")
          .in("workout_id", chunk)
          .order("order_index"),
      ),
      supabase
        .from("workout_completions")
        .select("workout_id")
        .eq("trainee_id", selectedTrainee.id)
        .in("workout_id", workoutIds.length ? workoutIds : NO_ROWS),
    ]);
    const exerciseIds = [...new Set(workoutExercises.map((we) => we.exercise_id))];
    const { data: exercises } = await supabase
      .from("exercises")
      .select("id, name")
      .in("id", exerciseIds.length ? exerciseIds : NO_ROWS);
    const exerciseName = new Map((exercises ?? []).map((e) => [e.id, e.name]));
    const submittedIds = new Set((completions ?? []).map((c) => c.workout_id));

    weekView = {
      weekKey,
      program: program ? { id: program.id, title: program.title, status: program.status } : null,
      workouts: (workouts ?? []).map((w) => {
        const rows = workoutExercises
          .filter((we) => we.workout_id === w.id)
          .sort((a, b) => a.order_index - b.order_index);
        const sameDay = (workouts ?? []).filter((x) => x.day_of_week === w.day_of_week).length;
        return {
          id: w.id,
          label: sameDay > 1 ? `${dayName(w.day_of_week)} · אימון ${w.order_index + 1}` : dayName(w.day_of_week),
          isToday: weekKey === currentWeekKey && w.day_of_week === todayIndex,
          exerciseCount: rows.length,
          exerciseNames: rows.slice(0, 3).map((we) => exerciseName.get(we.exercise_id) ?? "תרגיל"),
          submitted: submittedIds.has(w.id),
        };
      }),
      otherWeeks: (programs ?? [])
        .filter((p) => p.week_start_date !== weekKey)
        .map((p) => ({ weekKey: p.week_start_date, title: p.title })),
    };
    // Today's workout first — it's almost always the one being done.
    weekView.workouts.sort((a, b) => Number(b.isToday) - Number(a.isToday));
  }

  const tabClass = (active: boolean) =>
    cn(
      "flex-1 rounded-lg px-3 py-2 text-center text-sm font-medium transition-colors",
      active ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted",
    );

  return (
    <AppShell title="אימון אישי" backHref="/trainer">
      <div className="mx-auto w-full max-w-2xl space-y-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h1 className="text-xl font-bold">אימון אישי</h1>
            <p className="text-sm text-muted-foreground">
              בחר מתאמן ואימון. עוברים בין התרגילים ידנית, ואין טיימרים.
            </p>
          </div>
          <Link
            href="/trainer/session/templates"
            className={cn(buttonVariants({ variant: "outline", size: "sm" }), "shrink-0")}
          >
            <BookmarkCheck className="h-4 w-4" />
            אימונים שמורים
          </Link>
        </div>

        <div className="flex gap-1 rounded-xl border border-border bg-card p-1">
          <Link href="/trainer/session" className={tabClass(mode === "trainee")}>
            עם מתאמן
          </Link>
          <Link href="/trainer/session?mode=free" className={tabClass(mode === "free")}>
            ללא מתאמן (אימון חופשי)
          </Link>
        </div>

        {openSessions.length > 0 && (
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">אימונים חופשיים פתוחים</CardTitle>
              <CardDescription>אימון שהתחיל ועדיין לא הסתיים</CardDescription>
            </CardHeader>
            <CardContent className="space-y-1">
              {openSessions.map((s) => (
                <Link
                  key={s.id}
                  href={`/trainer/session/free/${s.id}`}
                  className="flex items-center justify-between gap-2 rounded-md p-2 text-sm transition-colors hover:bg-muted"
                >
                  <span className="truncate font-medium">
                    {(s.traineeId ? traineeNameById.get(s.traineeId) : null) ?? (s.guestLabel?.trim() || "ללא שם")}
                    <span className="font-normal text-muted-foreground"> · {countSets(s.setCount)}</span>
                  </span>
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {formatShortDateTime(s.startedAt)} · המשך
                  </span>
                </Link>
              ))}
            </CardContent>
          </Card>
        )}

        {mode === "trainee" && !selectedTrainee && (
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">1. מתאמן</CardTitle>
            </CardHeader>
            <CardContent>
              <TraineePickList trainees={pickList} />
            </CardContent>
          </Card>
        )}

        {selectedTrainee && weekView && (
          <>
            <Card>
              <CardContent className="flex items-center justify-between gap-3 p-4">
                <div className="flex min-w-0 items-center gap-3">
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary/10 font-semibold text-primary">
                    {selectedTrainee.full_name.trim().charAt(0)}
                  </span>
                  <p className="truncate font-semibold">{selectedTrainee.full_name}</p>
                </div>
                <Link href="/trainer/session" className={buttonVariants({ variant: "outline", size: "sm" })}>
                  החלף מתאמן
                </Link>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">
                  2. אימון, {formatWeekLabel(parseDateKey(weekView.weekKey), currentWeekStart)}
                </CardTitle>
                <CardDescription>
                  {formatWeekRange(parseDateKey(weekView.weekKey))}
                  {weekView.program ? ` · ${weekView.program.title}` : ""}
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-2">
                {weekView.program?.status === "draft" && (
                  <p className="flex items-start gap-2 rounded-md border border-warning/50 bg-warning/10 p-3 text-sm">
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning-foreground" />
                    <span>
                      התוכנית של השבוע הזה עדיין <strong>בטיוטה</strong>. תחילת האימון תפרסם אותה, כדי שהמתאמן
                      יראה את האימון בהיסטוריה שלו.
                    </span>
                  </p>
                )}

                {!weekView.program ? (
                  <p className="text-sm text-muted-foreground">אין תוכנית לשבוע הזה.</p>
                ) : weekView.workouts.length === 0 ? (
                  <p className="text-sm text-muted-foreground">אין אימונים בתוכנית של השבוע הזה.</p>
                ) : (
                  weekView.workouts.map((w) => (
                    <div
                      key={w.id}
                      className={cn(
                        "flex items-center justify-between gap-3 rounded-xl border p-3",
                        w.isToday ? "border-primary bg-primary/5" : "border-border bg-card",
                      )}
                    >
                      <div className="min-w-0">
                        <p className="flex flex-wrap items-center gap-2 font-medium">
                          {w.label}
                          {w.isToday && (
                            <span className="rounded-full bg-primary px-2 py-0.5 text-[11px] font-semibold text-primary-foreground">
                              היום
                            </span>
                          )}
                          <span
                            className={cn(
                              "flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium",
                              w.submitted ? "bg-success/15 text-success" : "bg-secondary text-secondary-foreground",
                            )}
                          >
                            {w.submitted ? <Check className="h-3 w-3" /> : <Clock className="h-3 w-3" />}
                            {w.submitted ? "בוצע" : "לא בוצע"}
                          </span>
                        </p>
                        <p className="truncate text-xs text-muted-foreground">
                          {countExercises(w.exerciseCount)}
                          {w.exerciseNames.length > 0
                            ? ` · ${w.exerciseNames.join(", ")}${w.exerciseCount > w.exerciseNames.length ? "…" : ""}`
                            : ""}
                        </p>
                      </div>
                      <StartWorkoutButton
                        workoutId={w.id}
                        label={w.submitted ? "פתח" : "התחל"}
                        disabled={w.exerciseCount === 0}
                      />
                    </div>
                  ))
                )}

                {weekView.otherWeeks.length > 0 && (
                  <div className="space-y-1.5 pt-2">
                    <p className="text-xs font-medium text-muted-foreground">אימון משבוע אחר</p>
                    <div className="flex flex-wrap gap-1.5">
                      {weekView.otherWeeks.map((week) => (
                        <Link
                          key={week.weekKey}
                          href={`/trainer/session?trainee=${selectedTrainee.id}&week=${week.weekKey}`}
                          className="rounded-full border border-border px-3 py-1 text-xs transition-colors hover:bg-muted"
                        >
                          {formatWeekLabel(parseDateKey(week.weekKey), currentWeekStart)} ·{" "}
                          {formatWeekRange(parseDateKey(week.weekKey))}
                        </Link>
                      ))}
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">אימון שלא מהתוכנית</CardTitle>
                <CardDescription>
                  נשמר בהיסטוריה של {selectedTrainee.full_name}, בלי להשפיע על התוכנית השבועית
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <StartFreeSessionForm traineeId={selectedTrainee.id} />
                <div className="space-y-2">
                  <p className="text-sm font-medium">מתוך אימון שמור</p>
                  <TemplateStartList
                    templates={templates}
                    trainees={traineeOptions}
                    initialTraineeId={selectedTrainee.id}
                  />
                </div>
              </CardContent>
            </Card>
          </>
        )}

        {mode === "free" && (
          <>
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">אימון חופשי</CardTitle>
                <CardDescription>
                  לא משויך לאף מתאמן ולא לתוכנית: אורח, אימון ניסיון או אימון של המאמן. התרגילים נבחרים תוך כדי
                  האימון, ואפשר לשייך אותו למתאמן בסיום.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <StartFreeSessionForm />
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">מתוך אימון שמור</CardTitle>
                <CardDescription>תבנית שבנית מראש: התרגילים והיעדים ימולאו מראש</CardDescription>
              </CardHeader>
              <CardContent>
                <TemplateStartList templates={templates} trainees={traineeOptions} />
              </CardContent>
            </Card>
          </>
        )}
      </div>
    </AppShell>
  );
}
