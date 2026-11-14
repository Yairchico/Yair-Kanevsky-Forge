import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { AppShell } from "@/components/app-shell";
import { isReadOnlyViewer } from "@/lib/viewer";
import { formatWeekLabel, formatWeekRange, parseDateKey } from "@/lib/week";
import { ProgramBuilderClient } from "./program-builder-client";
import { PLANNED_SET_COLUMNS, toPlannedSet } from "@/lib/sets";

export default async function ProgramBuilderPage({
  params,
}: {
  params: Promise<{ id: string; programId: string }>;
}) {
  const { id: traineeId, programId } = await params;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const readOnly = user ? await isReadOnlyViewer(supabase, user.id) : false;

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

  const noRows = ["00000000-0000-0000-0000-000000000000"];

  const [{ data: workoutExercises }, { data: exercises }] = await Promise.all([
    supabase
      .from("workout_exercises")
      .select("id, workout_id, exercise_id, order_index, rest_seconds, instructions, hide_library_note")
      .in("workout_id", workoutIds.length ? workoutIds : noRows)
      .order("order_index"),
    supabase
      .from("exercises")
      .select("id, name, muscle_group, equipment, media_url, instructions")
      .order("name"),
  ]);

  const workoutExerciseIds = (workoutExercises ?? []).map((we) => we.id);
  const { data: plannedSets } = await supabase
    .from("workout_exercise_sets")
    .select(PLANNED_SET_COLUMNS)
    .in("workout_exercise_id", workoutExerciseIds.length ? workoutExerciseIds : noRows)
    .order("set_index");
  const setsByWorkoutExerciseId = new Map<string, ReturnType<typeof toPlannedSet>[]>();
  for (const row of plannedSets ?? []) {
    const list = setsByWorkoutExerciseId.get(row.workout_exercise_id) ?? [];
    list.push(toPlannedSet(row));
    setsByWorkoutExerciseId.set(row.workout_exercise_id, list);
  }

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
          exerciseId: we.exercise_id,
          exerciseName: exercise?.name ?? "תרגיל לא ידוע",
          muscleGroup: exercise?.muscle_group ?? null,
          libraryNote: exercise?.instructions ?? null,
          fields: {
            rest_seconds: we.rest_seconds,
            instructions: we.instructions,
            hide_library_note: we.hide_library_note,
          },
          sets: setsByWorkoutExerciseId.get(we.id) ?? [],
        };
      }),
  }));

  const weekStart = parseDateKey(program.week_start_date);
  const weekLabel = `${formatWeekLabel(weekStart)} · ${formatWeekRange(weekStart)}`;

  return (
    <AppShell
      title={`${program.title} — ${weekLabel}`}
      backHref={`/trainer/trainees/${traineeId}`}
      readOnly={readOnly}
    >
      <ProgramBuilderClient
        traineeId={traineeId}
        programId={programId}
        traineeName={trainee.full_name}
        initialIsPublished={program.status === "published"}
        workouts={workoutsData}
        catalog={exercises ?? []}
        readOnly={readOnly}
      />
    </AppShell>
  );
}
