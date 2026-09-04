import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { AppShell } from "@/components/app-shell";
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
      .select("id, title, status, trainee_id")
      .eq("id", programId)
      .single(),
  ]);

  if (!trainee || !program || program.trainee_id !== traineeId) notFound();

  const { data: days } = await supabase
    .from("program_days")
    .select("id, day_index, label")
    .eq("program_id", programId)
    .order("day_index");

  const dayIds = (days ?? []).map((d) => d.id);

  const { data: workouts } = await supabase
    .from("workouts")
    .select("id, program_day_id")
    .in("program_day_id", dayIds.length ? dayIds : ["00000000-0000-0000-0000-000000000000"]);

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
    .select("id, name, muscle_group, equipment")
    .order("name");

  const exerciseById = new Map((exercises ?? []).map((e) => [e.id, e]));

  const daysData = (days ?? []).map((d) => {
    const workout = (workouts ?? []).find((w) => w.program_day_id === d.id);
    const items = (workoutExercises ?? [])
      .filter((we) => we.workout_id === workout?.id)
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
      });

    return {
      id: d.id,
      dayIndex: d.day_index,
      label: d.label ?? "",
      workoutId: workout?.id ?? null,
      items,
    };
  });

  return (
    <AppShell title={program.title} backHref={`/trainer/trainees/${traineeId}`}>
      <ProgramBuilderClient
        traineeId={traineeId}
        programId={programId}
        traineeName={trainee.full_name}
        initialIsPublished={program.status === "published"}
        days={daysData}
        catalog={exercises ?? []}
      />
    </AppShell>
  );
}
