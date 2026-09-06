import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { AppShell } from "@/components/app-shell";
import { formatWeekLabel, formatWeekRange, parseDateKey } from "@/lib/week";
import { ProgramBuilderClient } from "./program-builder-client";

export default async function ProgramBuilderPage({
  params,
}: {
  params: Promise<{ id: string; programId: string }>;
}) {
  const { id: traineeId, programId } = await params;

  const supabase = await createClient();

  const [{ data: trainee }, { data: program }] = await Promise.all([
    supabase
      .from("profiles")
      .select("id, full_name")
      .eq("id", traineeId)
      .eq("role", "trainee")
      .single(),
    supabase
      .from("programs")
      .select("id, title, status, trainee_id, week_start_date, deleted_at")
      .eq("id", programId)
      .single(),
  ]);

  if (!trainee || !program || program.trainee_id !== traineeId || program.deleted_at) notFound();

  const { data: workouts } = await supabase
    .from("workouts")
    .select("id, day_of_week, order_index")
    .eq("program_id", programId)
    .order("day_of_week")
    .order("order_index");

  const workoutIds = (workouts ?? []).map((w) => w.id);

  const { data: workoutExercises } = await supabase
    .from("workout_exercises")
    .select(
      "id, workout_id, exercise_id, order_index, sets, reps, weight, rpe, rest_seconds, instructions",
    )
    .in(
      "workout_id",
      workoutIds.length ? workoutIds : ["00000000-0000-0000-0000-000000000000"],
    )
    .order("order_index");

  const { data: exercises } = await supabase
    .from("exercises")
    .select("id, name, muscle_group, equipment, media_url")
    .order("name");

  const exerciseById = new Map((exercises ?? []).map((e) => [e.id, e]));

  const workoutsData = (workouts ?? []).map((w) => ({
    id: w.id,
    dayOfWeek: w.day_of_week,
    orderIndex: w.order_index,
    items: (workoutExercises ?? [])
      .filter((we) => we.workout_id === w.id)
      .map((we) => {
        const exercise = exerciseById.get(we.exercise_id);
        return {
          id: we.id,
          exerciseName: exercise?.name ?? "תרגיל לא ידוע",
          muscleGroup: exercise?.muscle_group ?? null,
          fields: {
            sets: we.sets,
            reps: we.reps,
            weight: we.weight,
            rpe: we.rpe,
            rest_seconds: we.rest_seconds,
            instructions: we.instructions,
          },
        };
      }),
  }));

  const weekStart = parseDateKey(program.week_start_date);
  const weekLabel = `${formatWeekLabel(weekStart)} · ${formatWeekRange(weekStart)}`;

  return (
    <AppShell
      title={`${program.title} — ${weekLabel}`}
      backHref={`/trainer/trainees/${traineeId}`}
    >
      <ProgramBuilderClient
        traineeId={traineeId}
        programId={programId}
        traineeName={trainee.full_name}
        initialIsPublished={program.status === "published"}
        workouts={workoutsData}
        catalog={exercises ?? []}
      />
    </AppShell>
  );
}
