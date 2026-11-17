import { notFound, redirect } from "next/navigation";
import { PLANNED_SET_COLUMNS, summarizeSets, toPlannedSet, type PlannedSet } from "@/lib/sets";
import { selectInChunks } from "@/lib/previous-sets";
import { getRequestAuth } from "@/lib/viewer";
import { addDays, getWeekStart, toDateKey, israelNow } from "@/lib/week";
import { NewProgramForm } from "./new-program-form";

export default async function NewProgramPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const { supabase, viewer } = await getRequestAuth();

  // Candidates for "שכפול מתוכנית": the trainee's own past programs, up to
  // about a month back, PLUS the current week's own program (still
  // ongoing, but a perfectly good template for "make next week look like
  // this one") — hence lte, not lt, on week_start_date. Fetched fully
  // (workouts + exercises), not just a list, so the trainer can preview a
  // program's contents client-side with no extra round trip when they
  // expand one.
  const currentWeekStart = getWeekStart(israelNow());
  const monthAgoKey = toDateKey(addDays(currentWeekStart, -35));
  const currentWeekKey = toDateKey(currentWeekStart);
  const noRows = ["00000000-0000-0000-0000-000000000000"];
  // Which of the 3 selectable target weeks (this week, +1, +2 — same
  // offsets new-program-form.tsx's weekOptions uses) already have a
  // (non-deleted) program, so the form can flag them red instead of
  // letting a trainer walk into silently overwriting one.
  const weekOptionKeys = [0, 1, 2].map((offset) => toDateKey(addDays(currentWeekStart, offset * 7)));

  // One wait for everything that only needs the trainee's id.
  const [me, { data: trainee }, { data: pastPrograms }, { data: exerciseCatalog }, { data: existingAtOptionWeeks }] =
    await Promise.all([
      viewer,
      supabase
        .from("profiles")
        .select("id, full_name")
        .eq("id", id)
        .eq("role", "trainee")
        .single(),
      supabase
        .from("programs")
        .select("id, title, week_start_date, status")
        .eq("trainee_id", id)
        .gte("week_start_date", monthAgoKey)
        .lte("week_start_date", currentWeekKey)
        .is("deleted_at", null)
        .order("week_start_date", { ascending: false }),
      supabase.from("exercises").select("id, name"),
      supabase
        .from("programs")
        .select("id, title, week_start_date")
        .eq("trainee_id", id)
        .in("week_start_date", weekOptionKeys)
        .is("deleted_at", null),
    ]);
  // Creating a program is a pure mutation with no read-only equivalent —
  // redirects a superadmin away entirely rather than rendering a whole
  // flow (including "שכפול שבוע") that would just fail on submit.
  if (me?.isSuperadmin) redirect(`/trainer/trainees/${id}`);

  if (!trainee) notFound();

  const pastProgramIds = (pastPrograms ?? []).map((p) => p.id);

  const { data: pastWorkouts } = await supabase
    .from("workouts")
    .select("id, program_id, day_of_week, order_index")
    .in("program_id", pastProgramIds.length ? pastProgramIds : noRows)
    .order("day_of_week")
    .order("order_index");

  const pastWorkoutIds = (pastWorkouts ?? []).map((w) => w.id);

  const { data: pastExercises } = await supabase
    .from("workout_exercises")
    .select("id, workout_id, exercise_id, order_index, rest_seconds, instructions")
    .in("workout_id", pastWorkoutIds.length ? pastWorkoutIds : noRows)
    .order("order_index");

  const plannedRows = await selectInChunks(
    (pastExercises ?? []).map((we) => we.id),
    (chunk) =>
      supabase.from("workout_exercise_sets").select(PLANNED_SET_COLUMNS).in("workout_exercise_id", chunk),
  );
  const plannedByWe = new Map<string, PlannedSet[]>();
  for (const row of plannedRows) {
    const list = plannedByWe.get(row.workout_exercise_id) ?? [];
    list.push(toPlannedSet(row));
    plannedByWe.set(row.workout_exercise_id, list);
  }

  const exerciseNameById = new Map((exerciseCatalog ?? []).map((e) => [e.id, e.name]));

  const existingProgramByWeek = Object.fromEntries(
    (existingAtOptionWeeks ?? []).map((p) => [p.week_start_date, { id: p.id, title: p.title }]),
  );

  const duplicateCandidates = (pastPrograms ?? []).map((program) => ({
    programId: program.id,
    title: program.title,
    weekStartDate: program.week_start_date,
    status: program.status,
    isCurrentWeek: program.week_start_date === currentWeekKey,
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
            summary: summarizeSets(
              (plannedByWe.get(we.id) ?? []).sort((a, b) => a.setIndex - b.setIndex),
            ),
            restSeconds: we.rest_seconds,
            instructions: we.instructions,
          })),
      })),
  }));

  return (
    <NewProgramForm
      traineeId={trainee.id}
      traineeName={trainee.full_name}
      currentWeekKey={currentWeekKey}
      duplicateCandidates={duplicateCandidates}
      existingProgramByWeek={existingProgramByWeek}
    />
  );
}
