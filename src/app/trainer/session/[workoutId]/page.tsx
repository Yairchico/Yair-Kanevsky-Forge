import { notFound, redirect } from "next/navigation";
import { getTrainerContext } from "@/lib/require-trainer";
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
  const ctx = await getTrainerContext();
  if (!ctx) redirect("/trainer");
  const { supabase } = ctx;

  const { data: workout } = await supabase
    .from("workouts")
    .select("id, program_id, day_of_week, order_index")
    .eq("id", workoutId)
    .maybeSingle();
  if (!workout) notFound();

  const { data: program } = await supabase
    .from("programs")
    .select("id, trainee_id, title, status, week_start_date, deleted_at")
    .eq("id", workout.program_id)
    .maybeSingle();
  if (!program || program.deleted_at) notFound();

  const [{ data: trainee }, { data: workoutExercises }, { data: siblings }, { data: completion }] =
    await Promise.all([
      supabase.from("profiles").select("id, full_name").eq("id", program.trainee_id).maybeSingle(),
      supabase
        .from("workout_exercises")
        .select("id, exercise_id, order_index, rest_seconds, instructions, hide_library_note")
        .eq("workout_id", workoutId)
        .order("order_index"),
      supabase.from("workouts").select("id, day_of_week").eq("program_id", program.id),
      supabase
        .from("workout_completions")
        .select("completed_at, source, notes")
        .eq("workout_id", workoutId)
        .eq("trainee_id", program.trainee_id)
        .maybeSingle(),
    ]);
  if (!trainee) notFound();

  const rows = workoutExercises ?? [];
  const ids = rows.map((we) => we.id);
  const noRows = ["00000000-0000-0000-0000-000000000000"];
  const exerciseIds = [...new Set(rows.map((we) => we.exercise_id))];

  const [{ data: exercises }, { data: plannedRows }, { data: loggedRows }, { data: noteRows }, previous] =
    await Promise.all([
      supabase
        .from("exercises")
        .select("id, name, muscle_group, instructions, video_url")
        .in("id", exerciseIds.length ? exerciseIds : noRows),
      supabase
        .from("workout_exercise_sets")
        .select(PLANNED_SET_COLUMNS)
        .in("workout_exercise_id", ids.length ? ids : noRows),
      supabase
        .from("set_logs")
        .select(SET_LOG_COLUMNS)
        .eq("trainee_id", program.trainee_id)
        .eq("status", "done")
        .in("workout_exercise_id", ids.length ? ids : noRows),
      supabase
        .from("workout_logs")
        .select("workout_exercise_id, notes")
        .eq("trainee_id", program.trainee_id)
        .in("workout_exercise_id", ids.length ? ids : noRows),
      getPreviousPerformance(
        supabase,
        program.trainee_id,
        rows.map((we) => ({ key: we.id, exerciseId: we.exercise_id })),
      ),
    ]);

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
          videoUrl: exercise?.video_url ?? null,
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
