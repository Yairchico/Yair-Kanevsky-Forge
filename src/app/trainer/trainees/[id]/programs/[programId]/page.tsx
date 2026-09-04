import { notFound } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { AppShell } from "@/components/app-shell";
import { cn } from "@/lib/utils";
import { PublishToggle } from "./publish-toggle";
import { DayBuilder } from "./day-builder";

export default async function ProgramBuilderPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string; programId: string }>;
  searchParams: Promise<{ day?: string }>;
}) {
  const { id: traineeId, programId } = await params;
  const { day } = await searchParams;
  const dayIndex = Number(day ?? "0") || 0;

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

  const currentDay = (days ?? []).find((d) => d.day_index === dayIndex) ?? days?.[0];
  const currentWorkout = (workouts ?? []).find(
    (w) => w.program_day_id === currentDay?.id,
  );
  const currentItems = (workoutExercises ?? [])
    .filter((we) => we.workout_id === currentWorkout?.id)
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

  const isPublished = program.status === "published";

  return (
    <AppShell title={program.title} backHref={`/trainer/trainees/${traineeId}`}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <span
            className={cn(
              "rounded-full px-2.5 py-1 text-xs font-medium",
              isPublished
                ? "bg-success/15 text-success"
                : "bg-warning/20 text-warning-foreground",
            )}
          >
            {isPublished ? "פורסם" : "טיוטה"}
          </span>
          <span className="text-sm text-muted-foreground">
            תוכנית עבור {trainee.full_name}
          </span>
        </div>
        <PublishToggle
          traineeId={traineeId}
          programId={programId}
          isPublished={isPublished}
        />
      </div>

      <div className="flex gap-2 overflow-x-auto pb-1">
        {(days ?? []).map((d) => (
          <Link
            key={d.id}
            href={`/trainer/trainees/${traineeId}/programs/${programId}?day=${d.day_index}`}
            className={cn(
              "shrink-0 rounded-full px-3 py-1.5 text-sm font-medium transition-colors",
              d.day_index === dayIndex
                ? "bg-primary text-primary-foreground"
                : "bg-secondary text-secondary-foreground hover:bg-muted",
            )}
          >
            {d.label}
          </Link>
        ))}
      </div>

      {currentDay && (
        <DayBuilder
          key={currentDay.id}
          traineeId={traineeId}
          programId={programId}
          programDayId={currentDay.id}
          initialWorkoutId={currentWorkout?.id ?? null}
          initialItems={currentItems}
          catalog={exercises ?? []}
        />
      )}
    </AppShell>
  );
}
