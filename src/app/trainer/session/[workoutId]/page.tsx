import { notFound, redirect } from "next/navigation";
import { getRequestAuth } from "@/lib/viewer";
import {
  PLANNED_SET_COLUMNS,
  SET_LOG_COLUMNS,
  toLoggedSet,
  toPlannedSet,
  type LoggedSet,
  type PlannedSet,
} from "@/lib/sets";
import { getPreviousPerformance } from "@/lib/previous-sets";
import { dayName, formatWeekLabel, parseDateKey } from "@/lib/week";
import { TraineeSessionRunner } from "./trainee-session-runner";
import { playableVideoUrl } from "@/lib/video";

/**
 * The live screen of a trainer-led session on one workout of a trainee's
 * weekly plan (planning/PLAN.md feature 5). Trainer only: the read-only
 * superadmin is sent back — there is nothing to look at here that the
 * trainee page doesn't already show, and everything on it is a write.
 */
export default async function TraineeSessionPage({
  params,
}: {
  params: Promise<{ workoutId: string }>;
}) {
  const { workoutId } = await params;
  const { supabase, viewer } = await getRequestAuth();
  const noRows = ["00000000-0000-0000-0000-000000000000"];

  // Three waits instead of nine. 1: everything that only needs the workout's id.
  const [me, { data: workout }, { data: workoutExercises }, { data: exercises }] = await Promise.all([
    viewer,
    supabase
      .from("workouts")
      .select("id, program_id, day_of_week, order_index")
      .eq("id", workoutId)
      .maybeSingle(),
    supabase
      .from("workout_exercises")
      .select("id, exercise_id, order_index, rest_seconds, instructions, hide_library_note")
      .eq("workout_id", workoutId)
      .order("order_index"),
    supabase.from("exercises").select("id, name, muscle_group, instructions, video_url, video_storage_path"),
  ]);
  if (me?.role !== "trainer") redirect("/trainer");
  if (!workout) notFound();

  const rows = workoutExercises ?? [];
  const ids = rows.map((we) => we.id);

  // 2: the program, and everything that hangs off the exercises. Performed
  // sets and notes of these exercises can only belong to the program's own
  // trainee (a database trigger enforces it), who isn't known yet here —
  // they're narrowed to that trainee right below, once the program is in.
  const [{ data: program }, { data: plannedRows }, { data: allLoggedRows }, { data: allNoteRows }] = await Promise.all([
    supabase
      .from("programs")
      .select("id, trainee_id, title, status, week_start_date, deleted_at")
      .eq("id", workout.program_id)
      .maybeSingle(),
    supabase
      .from("workout_exercise_sets")
      .select(PLANNED_SET_COLUMNS)
      .in("workout_exercise_id", ids.length ? ids : noRows),
    supabase
      .from("set_logs")
      .select(`trainee_id, ${SET_LOG_COLUMNS}`)
      .eq("status", "done")
      .in("workout_exercise_id", ids.length ? ids : noRows),
    supabase
      .from("workout_logs")
      .select("trainee_id, workout_exercise_id, notes")
      .in("workout_exercise_id", ids.length ? ids : noRows),
  ]);
  if (!program || program.deleted_at) notFound();
  const loggedRows = (allLoggedRows ?? []).filter((row) => row.trainee_id === program.trainee_id);
  const noteRows = (allNoteRows ?? []).filter((row) => row.trainee_id === program.trainee_id);

  // 3: what needs the trainee's id.
  const [{ data: trainee }, { data: siblings }, { data: completion }, previous] = await Promise.all([
    supabase.from("profiles").select("id, full_name").eq("id", program.trainee_id).maybeSingle(),
    supabase.from("workouts").select("id, day_of_week").eq("program_id", program.id),
    supabase
      .from("workout_completions")
      .select("completed_at, source, notes")
      .eq("workout_id", workoutId)
      .eq("trainee_id", program.trainee_id)
      .maybeSingle(),
    getPreviousPerformance(
      supabase,
      program.trainee_id,
      rows.map((we) => ({ key: we.id, exerciseId: we.exercise_id })),
    ),
  ]);
  if (!trainee) notFound();

  const exerciseById = new Map((exercises ?? []).map((e) => [e.id, e]));
  const plannedByWe = new Map<string, PlannedSet[]>();
  for (const row of plannedRows ?? []) {
    const list = plannedByWe.get(row.workout_exercise_id) ?? [];
    list.push(toPlannedSet(row));
    plannedByWe.set(row.workout_exercise_id, list);
  }
  const loggedByWe = new Map<string, LoggedSet[]>();
  for (const row of loggedRows ?? []) {
    const list = loggedByWe.get(row.workout_exercise_id) ?? [];
    list.push(toLoggedSet(row));
    loggedByWe.set(row.workout_exercise_id, list);
  }
  const noteByWe = new Map((noteRows ?? []).map((n) => [n.workout_exercise_id, n.notes]));

  const sameDayCount = (siblings ?? []).filter((w) => w.day_of_week === workout.day_of_week).length;
  const workoutLabel =
    sameDayCount > 1 ? `${dayName(workout.day_of_week)} · אימון ${workout.order_index + 1}` : dayName(workout.day_of_week);

  return (
    <TraineeSessionRunner
      workoutId={workout.id}
      traineeId={trainee.id}
      traineeName={trainee.full_name}
      workoutLabel={workoutLabel}
      programTitle={program.title}
      weekLabel={formatWeekLabel(parseDateKey(program.week_start_date))}
      isDraft={program.status === "draft"}
      alreadySubmitted={completion ? { bySelf: completion.source === "trainee" } : null}
      initialGeneralNote={completion?.notes ?? ""}
      exercises={rows.map((we) => {
        const exercise = exerciseById.get(we.exercise_id);
        return {
          id: we.id,
          exerciseId: we.exercise_id,
          name: exercise?.name ?? "תרגיל לא ידוע",
          muscleGroup: exercise?.muscle_group ?? null,
          videoUrl: exercise ? playableVideoUrl(exercise) : null,
          // The trainer always sees the permanent note, even where it's hidden from the trainee.
          permanentNote: exercise?.instructions ?? null,
          instructions: we.instructions,
          restSeconds: we.rest_seconds,
          plannedSets: (plannedByWe.get(we.id) ?? []).sort((a, b) => a.setIndex - b.setIndex),
          loggedSets: (loggedByWe.get(we.id) ?? []).sort((a, b) => a.setIndex - b.setIndex),
          initialNote: noteByWe.get(we.id) ?? null,
          previous: previous.get(we.id) ?? null,
        };
      })}
    />
  );
}
