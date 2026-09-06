import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { addDays, getWeekStart, toDateKey } from "@/lib/week";
import { NewProgramForm } from "./new-program-form";

export default async function NewProgramPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();

  const { data: trainee } = await supabase
    .from("profiles")
    .select("id, full_name")
    .eq("id", id)
    .eq("role", "trainee")
    .single();

  if (!trainee) notFound();

  // Candidates for "שכפול שבוע": the trainee's own past weeks, up to about
  // a month back. Fetched fully (workouts + exercises), not just a list,
  // so the trainer can preview a week's contents client-side with no extra
  // round trip when they expand one.
  const currentWeekStart = getWeekStart(new Date());
  const monthAgoKey = toDateKey(addDays(currentWeekStart, -35));
  const currentWeekKey = toDateKey(currentWeekStart);
  const noRows = ["00000000-0000-0000-0000-000000000000"];

  const { data: pastPrograms } = await supabase
    .from("programs")
    .select("id, title, week_start_date, status")
    .eq("trainee_id", id)
    .gte("week_start_date", monthAgoKey)
    .lt("week_start_date", currentWeekKey)
    .is("deleted_at", null)
    .order("week_start_date", { ascending: false });

  const pastProgramIds = (pastPrograms ?? []).map((p) => p.id);

  const { data: pastWorkouts } = await supabase
    .from("workouts")
    .select("id, program_id, day_of_week, order_index")
    .in("program_id", pastProgramIds.length ? pastProgramIds : noRows)
    .order("day_of_week")
    .order("order_index");

  const pastWorkoutIds = (pastWorkouts ?? []).map((w) => w.id);

  const [{ data: pastExercises }, { data: exerciseCatalog }] = await Promise.all([
    supabase
      .from("workout_exercises")
      .select(
        "id, workout_id, exercise_id, order_index, sets, reps, weight, rpe, rest_seconds, instructions",
      )
      .in("workout_id", pastWorkoutIds.length ? pastWorkoutIds : noRows)
      .order("order_index"),
    supabase.from("exercises").select("id, name"),
  ]);

  const exerciseNameById = new Map((exerciseCatalog ?? []).map((e) => [e.id, e.name]));

  const duplicateCandidates = (pastPrograms ?? []).map((program) => ({
    programId: program.id,
    title: program.title,
    weekStartDate: program.week_start_date,
    status: program.status,
    workouts: (pastWorkouts ?? [])
      .filter((w) => w.program_id === program.id)
      .map((w) => ({
        id: w.id,
        dayOfWeek: w.day_of_week,
        orderIndex: w.order_index,
        exercises: (pastExercises ?? [])
          .filter((we) => we.workout_id === w.id)
          .map((we) => ({
            id: we.id,
            name: exerciseNameById.get(we.exercise_id) ?? "תרגיל לא ידוע",
            sets: we.sets,
            reps: we.reps,
            weight: we.weight,
            rpe: we.rpe,
            restSeconds: we.rest_seconds,
            instructions: we.instructions,
          })),
      })),
  }));

  return (
    <NewProgramForm
      traineeId={trainee.id}
      traineeName={trainee.full_name}
      duplicateCandidates={duplicateCandidates}
    />
  );
}
