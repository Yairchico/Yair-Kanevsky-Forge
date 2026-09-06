import { createClient } from "@/lib/supabase/server";
import { AppShell } from "@/components/app-shell";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getWeekStart, toDateKey } from "@/lib/week";
import { TraineeWorkoutTabs } from "./trainee-workout-tabs";

export default async function TraineeHomePage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return (
      <AppShell title="השבוע שלי">
        <Card>
          <CardContent className="p-6 text-sm text-muted-foreground">
            שגיאת התחברות.
          </CardContent>
        </Card>
      </AppShell>
    );
  }

  const currentWeekKey = toDateKey(getWeekStart(new Date()));

  // Independent of each other (both only need user.id) — run together
  // instead of one after another.
  const [{ data: profile }, { data: program }] = await Promise.all([
    supabase.from("profiles").select("username").eq("id", user.id).single(),
    supabase
      .from("programs")
      .select("id, title")
      .eq("trainee_id", user.id)
      .eq("status", "published")
      .eq("week_start_date", currentWeekKey)
      .maybeSingle(),
  ]);

  if (!program) {
    return (
      <AppShell title="השבוע שלי" username={profile?.username}>
        <Card>
          <CardHeader>
            <CardTitle>עדיין אין תוכנית מפורסמת לשבוע הזה</CardTitle>
            <CardDescription>
              כשהמאמן יפרסם עבורך תוכנית לשבוע הנוכחי, היא תופיע כאן.
            </CardDescription>
          </CardHeader>
        </Card>
      </AppShell>
    );
  }

  const { data: workouts } = await supabase
    .from("workouts")
    .select("id, day_of_week, order_index")
    .eq("program_id", program.id)
    .order("day_of_week")
    .order("order_index");

  const workoutIds = (workouts ?? []).map((w) => w.id);
  const noRows = ["00000000-0000-0000-0000-000000000000"];

  // Everything below only depends on workoutIds — fetched together so all
  // "אימון N" tabs and their exercises are ready in one round trip, which
  // is what makes switching between them a local state change afterward
  // instead of a fresh server request per tab (see trainee-workout-tabs.tsx).
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
    supabase.from("exercises").select("id, name, muscle_group, media_url"),
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
  const doneExerciseIds = new Set(
    (exerciseCompletions ?? []).map((c) => c.workout_exercise_id),
  );
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

  const workoutsData = (workouts ?? []).map((w) => ({
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

  return (
    <AppShell title={program.title} username={profile?.username}>
      <TraineeWorkoutTabs workouts={workoutsData} />
    </AppShell>
  );
}
