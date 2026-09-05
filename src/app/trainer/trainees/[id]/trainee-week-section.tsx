import { createClient } from "@/lib/supabase/server";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { addDays, getWeekStart, toDateKey } from "@/lib/week";
import { TraineeWeekView } from "./trainee-week-view";

/**
 * Server-side data fetch for the trainer's read-only view of a trainee's
 * weeks — the current week plus past weeks (at least one back, per the
 * request), each showing its workouts ("אימון 1/2/...") with per-exercise
 * completion and, once submitted, when.
 */
export async function TraineeWeekSection({ traineeId }: { traineeId: string }) {
  const supabase = await createClient();

  const eightWeeksAgo = toDateKey(addDays(getWeekStart(new Date()), -8 * 7));

  const { data: programs } = await supabase
    .from("programs")
    .select("id, title, status, week_start_date")
    .eq("trainee_id", traineeId)
    .gte("week_start_date", eightWeeksAgo)
    .order("week_start_date", { ascending: false });

  if (!programs?.length) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>התוכנית השבועית</CardTitle>
          <CardDescription>אין עדיין תוכניות.</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  const programIds = programs.map((p) => p.id);
  const { data: workouts } = await supabase
    .from("workouts")
    .select("id, program_id, order_index")
    .in("program_id", programIds)
    .order("order_index");

  const workoutIds = (workouts ?? []).map((w) => w.id);
  const [
    { data: workoutExercises },
    { data: exercises },
    { data: workoutCompletions },
    { data: exerciseCompletions },
  ] = await Promise.all([
    supabase
      .from("workout_exercises")
      .select("id, workout_id, exercise_id, order_index")
      .in(
        "workout_id",
        workoutIds.length ? workoutIds : ["00000000-0000-0000-0000-000000000000"],
      )
      .order("order_index"),
    supabase.from("exercises").select("id, name, muscle_group"),
    supabase
      .from("workout_completions")
      .select("workout_id, completed_at")
      .eq("trainee_id", traineeId)
      .in(
        "workout_id",
        workoutIds.length ? workoutIds : ["00000000-0000-0000-0000-000000000000"],
      ),
    supabase
      .from("workout_exercise_completions")
      .select("workout_exercise_id")
      .eq("trainee_id", traineeId),
  ]);

  const exerciseById = new Map((exercises ?? []).map((e) => [e.id, e]));
  const submissionByWorkoutId = new Map(
    (workoutCompletions ?? []).map((c) => [c.workout_id, c.completed_at]),
  );
  const doneExerciseIds = new Set(
    (exerciseCompletions ?? []).map((c) => c.workout_exercise_id),
  );

  const weeks = programs.map((program) => ({
    programId: program.id,
    title: program.title,
    status: program.status,
    weekStartDate: program.week_start_date,
    workouts: (workouts ?? [])
      .filter((w) => w.program_id === program.id)
      .map((w) => ({
        id: w.id,
        submittedAt: submissionByWorkoutId.get(w.id) ?? null,
        exercises: (workoutExercises ?? [])
          .filter((we) => we.workout_id === w.id)
          .map((we) => {
            const exercise = exerciseById.get(we.exercise_id);
            return {
              id: we.id,
              name: exercise?.name ?? "תרגיל לא ידוע",
              muscleGroup: exercise?.muscle_group ?? null,
              done: doneExerciseIds.has(we.id),
            };
          }),
      })),
  }));

  return (
    <Card>
      <CardHeader>
        <CardTitle>התוכנית השבועית</CardTitle>
        <CardDescription>
          מה שהמתאמן סימן וממה שהוגש (קריאה בלבד)
        </CardDescription>
      </CardHeader>
      <CardContent>
        <TraineeWeekView weeks={weeks} />
      </CardContent>
    </Card>
  );
}
