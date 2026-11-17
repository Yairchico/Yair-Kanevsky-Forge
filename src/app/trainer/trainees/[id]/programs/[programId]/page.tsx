import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { AppShell } from "@/components/app-shell";
import { isReadOnlyViewer } from "@/lib/viewer";
import { formatWeekLabel, formatWeekRange, parseDateKey } from "@/lib/week";
import { ProgramBuilderClient, type BuilderBlock } from "./program-builder-client";
import { PLANNED_SET_COLUMNS, toPlannedSet } from "@/lib/sets";
import { RULE_COLUMNS, ruleFromRow } from "@/lib/blocks";
import { selectInChunks } from "@/lib/previous-sets";

type Supabase = Awaited<ReturnType<typeof createClient>>;

/**
 * One string per program that is equal for two programs exactly when they
 * have the same structure in the sense of a training block: the same
 * workouts (slot, day), the same exercises in them (slot, exercise, order)
 * and the same sets by number and type — everything except the targets,
 * which are supposed to differ from week to week.
 */
async function structureSignatures(supabase: Supabase, programIds: string[]): Promise<Map<string, string>> {
  const workouts = await selectInChunks(programIds, (chunk) =>
    supabase.from("workouts").select("id, program_id, slot_key, day_of_week, order_index").in("program_id", chunk),
  );
  const workoutExercises = await selectInChunks(
    workouts.map((w) => w.id),
    (chunk) =>
      supabase
        .from("workout_exercises")
        .select("id, workout_id, slot_key, exercise_id, order_index")
        .in("workout_id", chunk),
  );
  const sets = await selectInChunks(
    workoutExercises.map((we) => we.id),
    (chunk) =>
      supabase.from("workout_exercise_sets").select("workout_exercise_id, set_index, set_type").in("workout_exercise_id", chunk),
  );

  const setsByExercise = new Map<string, string[]>();
  for (const set of sets) {
    const list = setsByExercise.get(set.workout_exercise_id) ?? [];
    list.push(`${set.set_index}${set.set_type === "warmup" ? "w" : "r"}`);
    setsByExercise.set(set.workout_exercise_id, list);
  }
  const workoutById = new Map(workouts.map((w) => [w.id, w]));
  const parts = new Map<string, string[]>(programIds.map((id) => [id, []]));
  for (const w of workouts) {
    parts.get(w.program_id)?.push(`W:${w.slot_key}:${w.day_of_week}:${w.order_index}`);
  }
  for (const we of workoutExercises) {
    const workout = workoutById.get(we.workout_id);
    if (!workout) continue;
    parts
      .get(workout.program_id)
      ?.push(
        `E:${workout.slot_key}:${we.slot_key}:${we.exercise_id}:${we.order_index}:${(setsByExercise.get(we.id) ?? []).sort().join(",")}`,
      );
  }
  return new Map([...parts.entries()].map(([id, list]) => [id, list.sort().join("|")]));
}

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
      .select("id, title, status, trainee_id, week_start_date, deleted_at, block_id, block_week_index, is_deload, deload_pct")
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
      .select(
        `id, workout_id, exercise_id, order_index, rest_seconds, instructions, hide_library_note, slot_key, progression_info, ${RULE_COLUMNS}`,
      )
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
          progression: ruleFromRow(we),
          // Its targets are computed from an earlier week of the block.
          computed: we.progression_info != null,
        };
      }),
  }));

  // ---- training block (migration 0017): which week this is, and whether
  // the weeks after it still have this week's structure.
  let blockInfo: BuilderBlock | null = null;
  if (program.block_id && program.block_week_index != null) {
    const [{ data: block }, { data: laterPrograms }] = await Promise.all([
      supabase
        .from("blocks")
        .select("id, title, weeks_count, status, default_deload_pct")
        .eq("id", program.block_id)
        .is("deleted_at", null)
        .maybeSingle(),
      supabase
        .from("programs")
        .select("id")
        .eq("block_id", program.block_id)
        .is("deleted_at", null)
        .gt("block_week_index", program.block_week_index),
    ]);
    if (block) {
      const laterIds = (laterPrograms ?? []).map((p) => p.id);
      const signatures = await structureSignatures(supabase, [programId, ...laterIds]);
      const own = signatures.get(programId) ?? "";
      blockInfo = {
        id: block.id,
        title: block.title,
        weeksCount: block.weeks_count,
        weekIndex: program.block_week_index,
        isDeload: program.is_deload,
        deloadPct: program.deload_pct ?? block.default_deload_pct,
        active: block.status === "active",
        hasLaterWeeks: laterIds.length > 0,
        laterDiffer: laterIds.some((id) => (signatures.get(id) ?? "") !== own),
      };
    }
  }
  const progressionInfo = Object.fromEntries((workoutExercises ?? []).map((we) => [we.id, we.progression_info]));

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
        block={blockInfo}
        progressionInfo={progressionInfo}
        readOnly={readOnly}
      />
    </AppShell>
  );
}
