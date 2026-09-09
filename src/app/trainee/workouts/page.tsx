import { createClient } from "@/lib/supabase/server";
import { AppShell } from "@/components/app-shell";
import { Card, CardContent } from "@/components/ui/card";
import { addDays, getWeekStart, toDateKey } from "@/lib/week";
import { TraineeWeekBrowser, type WeekSlot } from "../trainee-week-browser";

/** ±4 weeks around the current one — "up to a month forward and back". */
const WEEK_OFFSETS = [-4, -3, -2, -1, 0, 1, 2, 3, 4];

/**
 * The trainee's workouts — split out from the home screen (/trainee,
 * home-dashboard.tsx), which is now just a summary with a link in here.
 * Fetches every week in the ±4-week window in one round trip (same
 * "fetch it all up front, switch client-side" approach the within-week
 * workout tabs already use — see trainee-workout-tabs.tsx) rather than a
 * server request per week switched to; a week with no published program
 * still gets its own slot, just an empty one (TraineeWeekBrowser shows a
 * "no program" message for it instead of a workout list).
 */
export default async function TraineeWorkoutsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return (
      <AppShell title="האימונים שלי" backHref="/trainee">
        <Card>
          <CardContent className="p-6 text-base text-muted-foreground">
            שגיאת התחברות.
          </CardContent>
        </Card>
      </AppShell>
    );
  }

  const currentWeekStart = getWeekStart(new Date());
  const weekKeys = WEEK_OFFSETS.map((offset) => toDateKey(addDays(currentWeekStart, offset * 7)));
  const noRows = ["00000000-0000-0000-0000-000000000000"];

  const [{ data: profile }, { data: programs }] = await Promise.all([
    supabase.from("profiles").select("username").eq("id", user.id).single(),
    supabase
      .from("programs")
      .select("id, title, week_start_date")
      .eq("trainee_id", user.id)
      .eq("status", "published")
      .is("deleted_at", null)
      .in("week_start_date", weekKeys),
  ]);

  const publishedPrograms = programs ?? [];
  const programIds = publishedPrograms.map((p) => p.id);

  const { data: workouts } = await supabase
    .from("workouts")
    .select("id, program_id, day_of_week, order_index")
    .in("program_id", programIds.length ? programIds : noRows)
    .order("day_of_week")
    .order("order_index");

  const workoutIds = (workouts ?? []).map((w) => w.id);

  // Everything below only depends on workoutIds — fetched together so
  // every week's workouts are ready in one round trip, which is what
  // makes switching between weeks (and, within a week, between its own
  // workout tabs) a local state change instead of a fresh server request.
  const [
    { data: workoutExercises },
    { data: exercises },
    { data: workoutCompletions },
    { data: exerciseCompletions },
    { data: recentLogs },
  ] = await Promise.all([
    supabase
      .from("workout_exercises")
      .select(
        "id, workout_id, exercise_id, order_index, sets, reps, weight, rpe, rest_seconds, instructions",
      )
      .in("workout_id", workoutIds.length ? workoutIds : noRows)
      .order("order_index"),
    supabase.from("exercises").select("id, name, muscle_group, media_url, instructions"),
    supabase
      .from("workout_completions")
      .select("workout_id, completed_at")
      .eq("trainee_id", user.id)
      .in("workout_id", workoutIds.length ? workoutIds : noRows),
    supabase
      .from("workout_exercise_completions")
      .select("workout_exercise_id")
      .eq("trainee_id", user.id),
    supabase
      .from("workout_logs")
      .select("workout_exercise_id, performed_at, actual_sets, rpe_actual, notes")
      .eq("trainee_id", user.id)
      .order("performed_at", { ascending: false })
      .limit(200),
  ]);

  const exerciseById = new Map((exercises ?? []).map((e) => [e.id, e]));
  const submittedAtByWorkoutId = new Map(
    (workoutCompletions ?? []).map((c) => [c.workout_id, c.completed_at]),
  );
  const doneExerciseIds = new Set((exerciseCompletions ?? []).map((c) => c.workout_exercise_id));
  // recentLogs is already ordered newest-first, so the first one seen per
  // workout_exercise_id is the latest.
  const latestLogByWorkoutExerciseId = new Map<
    string,
    { weight: string | null; reps: string | null; rpe: number | null; notes: string | null; performedAt: string }
  >();
  for (const log of recentLogs ?? []) {
    if (latestLogByWorkoutExerciseId.has(log.workout_exercise_id)) continue;
    const sets = log.actual_sets as { weight?: string | null; reps?: string | null } | null;
    latestLogByWorkoutExerciseId.set(log.workout_exercise_id, {
      weight: sets?.weight ?? null,
      reps: sets?.reps ?? null,
      rpe: log.rpe_actual,
      notes: log.notes,
      performedAt: log.performed_at,
    });
  }

  function workoutsForProgram(programId: string) {
    return (workouts ?? [])
      .filter((w) => w.program_id === programId)
      .map((w) => ({
        id: w.id,
        dayOfWeek: w.day_of_week,
        orderIndex: w.order_index,
        submitted: submittedAtByWorkoutId.has(w.id),
        exercises: (workoutExercises ?? [])
          .filter((we) => we.workout_id === w.id)
          .map((we) => {
            const exercise = exerciseById.get(we.exercise_id);
            return {
              id: we.id,
              name: exercise?.name ?? "תרגיל לא ידוע",
              muscleGroup: exercise?.muscle_group ?? null,
              imageUrl: exercise?.media_url ?? null,
              exerciseDescription: exercise?.instructions ?? null,
              sets: we.sets,
              reps: we.reps,
              weight: we.weight,
              rpe: we.rpe,
              restSeconds: we.rest_seconds,
              instructions: we.instructions,
              done: doneExerciseIds.has(we.id),
              initialLog: latestLogByWorkoutExerciseId.get(we.id) ?? null,
            };
          }),
      }));
  }

  const programByWeekKey = new Map(publishedPrograms.map((p) => [p.week_start_date, p]));
  const weeks: WeekSlot[] = weekKeys.map((weekKey) => {
    const program = programByWeekKey.get(weekKey);
    return {
      weekStartDate: weekKey,
      program: program ? { title: program.title, workouts: workoutsForProgram(program.id) } : null,
    };
  });

  return (
    <AppShell title="האימונים שלי" backHref="/trainee" username={profile?.username}>
      <TraineeWeekBrowser weeks={weeks} />
    </AppShell>
  );
}
