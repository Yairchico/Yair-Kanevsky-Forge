import { createClient } from "@/lib/supabase/server";
import { rollForwardBlocks } from "@/lib/block-server";
import { traineeJumpLabel } from "@/lib/blocks";
import { AppShell } from "@/components/app-shell";
import { Card, CardContent } from "@/components/ui/card";
import { addDays, getWeekStart, toDateKey, israelNow } from "@/lib/week";
import { TraineeWeekBrowser, type WeekSlot } from "../trainee-week-browser";
import {
  PLANNED_SET_COLUMNS,
  SET_LOG_COLUMNS,
  toLoggedSet,
  toPlannedSet,
  type LoggedSet,
  type PlannedSet,
} from "@/lib/sets";
import { getPreviousPerformance, selectInChunks } from "@/lib/previous-sets";
import { playableVideoUrl } from "@/lib/video";

/** ±4 weeks around the current one — "up to a month forward and back". */
const WEEK_OFFSETS = [-4, -3, -2, -1, 0, 1, 2, 3, 4];

/**
 * The trainee's workouts — split out from the home screen (/trainee,
 * home-dashboard.tsx), which is now just a summary with a link in here.
 * Fetches every week in the ±4-week window in one round trip (same
 * "fetch it all up front, switch client-side" approach the within-week
 * workout tabs already use — see trainee-workout-tabs.tsx) rather than a
 * server request per week switched to; a week with no published program
 * still gets its own slot, just an empty one (TraineeWeekBrowser shows a
 * "no program" message for it instead of a workout list).
 */
export default async function TraineeWorkoutsPage({
  searchParams,
}: {
  searchParams: Promise<{ week?: string }>;
}) {
  const { week: requestedWeek } = await searchParams;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return (
      <AppShell title="האימונים שלי" backHref="/trainee">
        <Card>
          <CardContent className="p-6 text-base text-muted-foreground">
            שגיאת התחברות.
          </CardContent>
        </Card>
      </AppShell>
    );
  }

  const currentWeekStart = getWeekStart(israelNow());
  const weekKeys = WEEK_OFFSETS.map((offset) => toDateKey(addDays(currentWeekStart, offset * 7)));
  const noRows = ["00000000-0000-0000-0000-000000000000"];

  // Training blocks: the once-a-week maintenance first (it may publish this
  // week's program or re-derive its targets), so what's read below is current.
  await rollForwardBlocks(supabase, user.id);

  const [{ data: profile }, { data: programs }, { data: blocks }] = await Promise.all([
    supabase.from("profiles").select("username").eq("id", user.id).single(),
    supabase
      .from("programs")
      .select("id, title, week_start_date, block_id, block_week_index, is_deload")
      .eq("trainee_id", user.id)
      .eq("status", "published")
      .is("deleted_at", null)
      .in("week_start_date", weekKeys),
    // RLS: only this trainee's own blocks.
    supabase.from("blocks").select("id, weeks_count").is("deleted_at", null),
  ]);
  const blockWeeks = new Map((blocks ?? []).map((b) => [b.id, b.weeks_count]));

  const publishedPrograms = programs ?? [];
  const programIds = publishedPrograms.map((p) => p.id);
  const previousWeekKey = toDateKey(addDays(currentWeekStart, -7));

  const { data: workouts } = await supabase
    .from("workouts")
    .select("id, program_id, day_of_week, order_index")
    .in("program_id", programIds.length ? programIds : noRows)
    .order("day_of_week")
    .order("order_index");

  const workoutIds = (workouts ?? []).map((w) => w.id);

  // Everything below only depends on workoutIds — fetched together so
  // every week's workouts are ready in one round trip, which is what
  // makes switching between weeks (and, within a week, between its own
  // workout tabs) a local state change instead of a fresh server request.
  const [
    { data: workoutExercises },
    { data: exercises },
    { data: workoutCompletions },
    { data: exerciseCompletions },
  ] = await Promise.all([
    supabase
      .from("workout_exercises")
      .select("id, workout_id, exercise_id, order_index, rest_seconds, instructions, hide_library_note, progression_info")
      .in("workout_id", workoutIds.length ? workoutIds : noRows)
      .order("order_index"),
    supabase.from("exercises").select("id, name, muscle_group, media_url, instructions, video_url, video_storage_path"),
    supabase
      .from("workout_completions")
      .select("workout_id, completed_at")
      .eq("trainee_id", user.id)
      .in("workout_id", workoutIds.length ? workoutIds : noRows),
    supabase
      .from("workout_exercise_completions")
      .select("workout_exercise_id")
      .eq("trainee_id", user.id),
  ]);

  // Per-set plan + what's already been logged (migration 0013), the
  // exercise-level notes, and "last time" for every exercise in the window.
  const workoutExerciseIds = (workoutExercises ?? []).map((we) => we.id);
  const [plannedRows, loggedRows, noteRows, previousByWorkoutExerciseId] = await Promise.all([
    selectInChunks(workoutExerciseIds, (chunk) =>
      supabase.from("workout_exercise_sets").select(PLANNED_SET_COLUMNS).in("workout_exercise_id", chunk),
    ),
    selectInChunks(workoutExerciseIds, (chunk) =>
      supabase
        .from("set_logs")
        .select(SET_LOG_COLUMNS)
        .eq("trainee_id", user.id)
        .eq("status", "done")
        .in("workout_exercise_id", chunk),
    ),
    selectInChunks(workoutExerciseIds, (chunk) =>
      supabase
        .from("workout_logs")
        .select("workout_exercise_id, notes")
        .eq("trainee_id", user.id)
        .in("workout_exercise_id", chunk),
    ),
    getPreviousPerformance(
      supabase,
      user.id,
      (workoutExercises ?? []).map((we) => ({ key: we.id, exerciseId: we.exercise_id })),
    ),
  ]);

  const exerciseById = new Map((exercises ?? []).map((e) => [e.id, e]));
  const submittedAtByWorkoutId = new Map(
    (workoutCompletions ?? []).map((c) => [c.workout_id, c.completed_at]),
  );
  const doneExerciseIds = new Set((exerciseCompletions ?? []).map((c) => c.workout_exercise_id));
  const plannedByWe = new Map<string, PlannedSet[]>();
  for (const row of plannedRows) {
    const list = plannedByWe.get(row.workout_exercise_id) ?? [];
    list.push(toPlannedSet(row));
    plannedByWe.set(row.workout_exercise_id, list);
  }
  const loggedByWe = new Map<string, LoggedSet[]>();
  for (const row of loggedRows) {
    const list = loggedByWe.get(row.workout_exercise_id) ?? [];
    list.push(toLoggedSet(row));
    loggedByWe.set(row.workout_exercise_id, list);
  }
  const noteByWe = new Map(noteRows.map((n) => [n.workout_exercise_id, n.notes]));
  const programById = new Map(publishedPrograms.map((p) => [p.id, p]));

  function workoutsForProgram(programId: string) {
    const editable = (programById.get(programId)?.week_start_date ?? "") >= previousWeekKey;
    return (workouts ?? [])
      .filter((w) => w.program_id === programId)
      .map((w) => ({
        id: w.id,
        dayOfWeek: w.day_of_week,
        orderIndex: w.order_index,
        submitted: submittedAtByWorkoutId.has(w.id),
        editable,
        exercises: (workoutExercises ?? [])
          .filter((we) => we.workout_id === w.id)
          .map((we) => {
            const exercise = exerciseById.get(we.exercise_id);
            return {
              id: we.id,
              name: exercise?.name ?? "תרגיל לא ידוע",
              muscleGroup: exercise?.muscle_group ?? null,
              imageUrl: exercise?.media_url ?? null,
              videoUrl: exercise ? playableVideoUrl(exercise) : null,
              // The exercise's permanent note, unless the trainer hid it for this program.
              permanentNote: we.hide_library_note ? null : (exercise?.instructions ?? null),
              plannedSets: (plannedByWe.get(we.id) ?? []).sort((a, b) => a.setIndex - b.setIndex),
              loggedSets: (loggedByWe.get(we.id) ?? []).sort((a, b) => a.setIndex - b.setIndex),
              previous: previousByWorkoutExerciseId.get(we.id) ?? null,
              restSeconds: we.rest_seconds,
              instructions: we.instructions,
              done: doneExerciseIds.has(we.id),
              initialNote: noteByWe.get(we.id) ?? null,
              // In a training block: only THAT the target went up, and by how much.
              jump: traineeJumpLabel(we.progression_info),
            };
          }),
      }));
  }

  const programByWeekKey = new Map(publishedPrograms.map((p) => [p.week_start_date, p]));
  const weeks: WeekSlot[] = weekKeys.map((weekKey) => {
    const program = programByWeekKey.get(weekKey);
    return {
      weekStartDate: weekKey,
      program: program
        ? {
            title: program.title,
            blockLabel:
              program.block_id && program.block_week_index != null && blockWeeks.has(program.block_id)
                ? `שבוע ${program.block_week_index} מתוך ${blockWeeks.get(program.block_id)}${program.is_deload ? " · שבוע דילואד" : ""}`
                : null,
            workouts: workoutsForProgram(program.id),
          }
        : null,
    };
  });

  return (
    <AppShell title="האימונים שלי" backHref="/trainee" username={profile?.username}>
      <TraineeWeekBrowser weeks={weeks} initialWeek={requestedWeek} />
    </AppShell>
  );
}
