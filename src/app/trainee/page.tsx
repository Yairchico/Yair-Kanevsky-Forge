import { createClient } from "@/lib/supabase/server";
import { AppShell } from "@/components/app-shell";
import { Card, CardContent } from "@/components/ui/card";
import { addDays, getWeekStart, toDateKey } from "@/lib/week";
import { formatShortDateTime } from "@/lib/format";
import { HomeDashboard, type CurrentWeekSummary } from "./home-dashboard";

/**
 * The trainee's home screen: a light "how am I doing" summary, not the
 * workouts themselves (those moved to /trainee/workouts, see that page and
 * trainee-workout-tabs.tsx) — this page owns none of the per-exercise data,
 * only counts and dates, so its query stays cheap regardless of how much
 * detail a program's exercises carry.
 */
export default async function TraineeHomePage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return (
      <AppShell title="בית">
        <Card>
          <CardContent className="p-6 text-base text-muted-foreground">
            שגיאת התחברות.
          </CardContent>
        </Card>
      </AppShell>
    );
  }

  const currentWeekStart = getWeekStart(new Date());
  const currentWeekKey = toDateKey(currentWeekStart);
  const eightWeeksAgoKey = toDateKey(addDays(currentWeekStart, -8 * 7));

  const [{ data: profile }, { data: programs }] = await Promise.all([
    supabase.from("profiles").select("username, full_name").eq("id", user.id).single(),
    supabase
      .from("programs")
      .select("id, title, week_start_date")
      .eq("trainee_id", user.id)
      .eq("status", "published")
      .is("deleted_at", null)
      .gte("week_start_date", eightWeeksAgoKey)
      .order("week_start_date", { ascending: false }),
  ]);

  const allPrograms = programs ?? [];
  const programIds = allPrograms.map((p) => p.id);
  const noRows = ["00000000-0000-0000-0000-000000000000"];

  const { data: workouts } = await supabase
    .from("workouts")
    .select("id, program_id, day_of_week, order_index")
    .in("program_id", programIds.length ? programIds : noRows)
    .order("day_of_week")
    .order("order_index");

  const workoutIds = (workouts ?? []).map((w) => w.id);

  const [{ data: workoutExercises }, { data: completions }, { data: exerciseCompletions }] =
    await Promise.all([
      supabase
        .from("workout_exercises")
        .select("id, workout_id")
        .in("workout_id", workoutIds.length ? workoutIds : noRows),
      supabase
        .from("workout_completions")
        .select("workout_id, completed_at")
        .eq("trainee_id", user.id)
        .in("workout_id", workoutIds.length ? workoutIds : noRows),
      supabase
        .from("workout_exercise_completions")
        .select("workout_exercise_id")
        .eq("trainee_id", user.id),
    ]);

  const programById = new Map(allPrograms.map((p) => [p.id, p]));
  const submittedAtByWorkoutId = new Map(
    (completions ?? []).map((c) => [c.workout_id, c.completed_at]),
  );
  const doneExerciseIds = new Set((exerciseCompletions ?? []).map((c) => c.workout_exercise_id));
  const exerciseIdsByWorkoutId = new Map<string, string[]>();
  for (const we of workoutExercises ?? []) {
    const list = exerciseIdsByWorkoutId.get(we.workout_id) ?? [];
    list.push(we.id);
    exerciseIdsByWorkoutId.set(we.workout_id, list);
  }

  // One entry per program (= per week), each carrying its own workouts —
  // built once, then used for the current week's card, the completion
  // streak, and (implicitly) the monthly count below.
  const weeks = allPrograms.map((program) => {
    const programWorkouts = (workouts ?? [])
      .filter((w) => w.program_id === program.id)
      .map((w) => {
        const exIds = exerciseIdsByWorkoutId.get(w.id) ?? [];
        return {
          id: w.id,
          dayOfWeek: w.day_of_week,
          orderIndex: w.order_index,
          submitted: submittedAtByWorkoutId.has(w.id),
          exerciseCount: exIds.length,
          doneCount: exIds.filter((id) => doneExerciseIds.has(id)).length,
        };
      });
    return {
      weekStartDate: program.week_start_date,
      title: program.title,
      workouts: programWorkouts,
      allDone: programWorkouts.length > 0 && programWorkouts.every((w) => w.submitted),
    };
  });

  const currentWeek = weeks.find((w) => w.weekStartDate === currentWeekKey);
  const currentWeekSummary: CurrentWeekSummary | null = currentWeek
    ? { programTitle: currentWeek.title, weekStartDate: currentWeek.weekStartDate, workouts: currentWeek.workouts }
    : null;

  // Consecutive fully-submitted weeks counting back from the week right
  // before this one (the current week is still in progress, so it's never
  // part of the streak yet) — a week has to be exactly 7 days before the
  // last to keep the streak alive, so a week with no published program at
  // all breaks it too, not just one with unfinished workouts.
  const weekByKey = new Map(weeks.map((w) => [w.weekStartDate, w]));
  let streakWeeks = 0;
  let cursor = addDays(currentWeekStart, -7);
  while (true) {
    const week = weekByKey.get(toDateKey(cursor));
    if (!week?.allDone) break;
    streakWeeks++;
    cursor = addDays(cursor, -7);
  }

  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
  const monthlyWorkoutCount = (completions ?? []).filter(
    (c) => new Date(c.completed_at) >= thirtyDaysAgo,
  ).length;

  const workoutById = new Map((workouts ?? []).map((w) => [w.id, w]));
  const lastCompletion = (completions ?? []).reduce<{ workout_id: string; completed_at: string } | null>(
    (latest, c) => (!latest || c.completed_at > latest.completed_at ? c : latest),
    null,
  );
  const lastWorkout = (() => {
    if (!lastCompletion) return null;
    const workout = workoutById.get(lastCompletion.workout_id);
    if (!workout) return null;
    const program = programById.get(workout.program_id);
    return {
      label: program ? program.title : "אימון",
      dateLabel: formatShortDateTime(lastCompletion.completed_at),
    };
  })();

  return (
    <AppShell title="בית" username={profile?.username}>
      <HomeDashboard
        traineeName={profile?.full_name?.split(" ")[0] ?? null}
        currentWeek={currentWeekSummary}
        streakWeeks={streakWeeks}
        monthlyWorkoutCount={monthlyWorkoutCount}
        lastWorkout={lastWorkout}
      />
    </AppShell>
  );
}
