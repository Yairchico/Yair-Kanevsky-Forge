import { createClient } from "@/lib/supabase/server";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { TraineeWeekView } from "./trainee-week-view";

/** Server-side data fetch for the trainer's read-only view of a trainee's week. */
export async function TraineeWeekSection({ traineeId }: { traineeId: string }) {
  const supabase = await createClient();

  const { data: program } = await supabase
    .from("programs")
    .select("id, title")
    .eq("trainee_id", traineeId)
    .eq("status", "published")
    .order("published_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!program) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>השבוע שלו</CardTitle>
          <CardDescription>אין עדיין תוכנית מפורסמת.</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  const { data: days } = await supabase
    .from("program_days")
    .select("id, day_index, label")
    .eq("program_id", program.id)
    .order("day_index");

  const dayIds = (days ?? []).map((d) => d.id);
  const { data: workouts } = await supabase
    .from("workouts")
    .select("id, program_day_id")
    .in("program_day_id", dayIds.length ? dayIds : ["00000000-0000-0000-0000-000000000000"]);

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
      .select("workout_id")
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
  const submittedWorkoutIds = new Set(
    (workoutCompletions ?? []).map((c) => c.workout_id),
  );
  const doneExerciseIds = new Set(
    (exerciseCompletions ?? []).map((c) => c.workout_exercise_id),
  );

  const days_ = (days ?? []).map((d) => {
    const workout = (workouts ?? []).find((w) => w.program_day_id === d.id);
    const dayExercises = (workoutExercises ?? [])
      .filter((we) => we.workout_id === workout?.id)
      .map((we) => {
        const exercise = exerciseById.get(we.exercise_id);
        return {
          id: we.id,
          name: exercise?.name ?? "תרגיל לא ידוע",
          muscleGroup: exercise?.muscle_group ?? null,
          done: doneExerciseIds.has(we.id),
        };
      });

    return {
      id: d.id,
      dayIndex: d.day_index,
      label: d.label ?? "",
      submitted: workout ? submittedWorkoutIds.has(workout.id) : false,
      exercises: dayExercises,
    };
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>השבוע שלו — {program.title}</CardTitle>
        <CardDescription>
          מה שהמתאמן סימן וממה שהוגש (קריאה בלבד)
        </CardDescription>
      </CardHeader>
      <CardContent>
        <TraineeWeekView days={days_} />
      </CardContent>
    </Card>
  );
}
