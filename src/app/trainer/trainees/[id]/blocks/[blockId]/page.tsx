import { notFound } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { rollForwardBlocks } from "@/lib/block-server";
import { RULE_COLUMNS, describeProgression, describeRule, ruleFromRow } from "@/lib/blocks";
import { selectInChunks } from "@/lib/previous-sets";
import { PLANNED_SET_COLUMNS, SET_LOG_COLUMNS, isSetTargetMet, summarizeSets, toPlannedSet, type PlannedSet } from "@/lib/sets";
import { createClient } from "@/lib/supabase/server";
import { isUuid } from "@/lib/utils";
import { isReadOnlyViewer } from "@/lib/viewer";
import { dayName, formatWeekRange, getWeekStart, israelNow, parseDateKey, toDateKey } from "@/lib/week";
import { BlockOverview, type BlockCell, type BlockRow, type BlockWeek } from "./block-overview";

/**
 * A training block at a glance (planning/PLAN.md feature 2): one row per
 * exercise slot, one column per week, each cell that week's targets with
 * the reason they are what they are — plus everything the trainer can do
 * to the block and to each of its weeks.
 */
export default async function BlockPage({
  params,
}: {
  params: Promise<{ id: string; blockId: string }>;
}) {
  const { id: traineeId, blockId } = await params;
  if (!isUuid(traineeId) || !isUuid(blockId)) notFound();

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const readOnly = user ? await isReadOnlyViewer(supabase, user.id) : false;

  // The weekly maintenance first, so what's read below is current. (A no-op
  // for the read-only viewer, who isn't allowed to run it.)
  if (!readOnly) await rollForwardBlocks(supabase, traineeId);

  const [{ data: trainee }, { data: block }] = await Promise.all([
    supabase.from("profiles").select("id, full_name").eq("id", traineeId).eq("role", "trainee").maybeSingle(),
    supabase
      .from("blocks")
      .select("id, trainee_id, title, weeks_count, status, default_deload_pct, auto_publish_next_week")
      .eq("id", blockId)
      .is("deleted_at", null)
      .maybeSingle(),
  ]);
  if (!trainee || !block || block.trainee_id !== traineeId) notFound();

  const { data: programs } = await supabase
    .from("programs")
    .select("id, week_start_date, status, block_week_index, is_deload, deload_pct")
    .eq("block_id", blockId)
    .is("deleted_at", null)
    .order("block_week_index");
  const programRows = programs ?? [];
  const programIds = programRows.map((p) => p.id);

  const workouts = await selectInChunks(programIds, (chunk) =>
    supabase
      .from("workouts")
      .select("id, program_id, day_of_week, order_index, slot_key")
      .in("program_id", chunk),
  );
  const workoutIds = workouts.map((w) => w.id);
  const [workoutExercises, completions] = await Promise.all([
    selectInChunks(workoutIds, (chunk) =>
      supabase
        .from("workout_exercises")
        .select(`id, workout_id, exercise_id, order_index, slot_key, progression_info, ${RULE_COLUMNS}`)
        .in("workout_id", chunk),
    ),
    selectInChunks(workoutIds, (chunk) =>
      supabase.from("workout_completions").select("workout_id").in("workout_id", chunk),
    ),
  ]);
  const workoutExerciseIds = workoutExercises.map((we) => we.id);
  const exerciseIds = [...new Set(workoutExercises.map((we) => we.exercise_id))];
  const [plannedRows, loggedRows, exercises] = await Promise.all([
    selectInChunks(workoutExerciseIds, (chunk) =>
      supabase.from("workout_exercise_sets").select(PLANNED_SET_COLUMNS).in("workout_exercise_id", chunk),
    ),
    selectInChunks(workoutExerciseIds, (chunk) =>
      supabase
        .from("set_logs")
        .select(SET_LOG_COLUMNS)
        .eq("trainee_id", traineeId)
        .eq("status", "done")
        .in("workout_exercise_id", chunk),
    ),
    selectInChunks(exerciseIds, (chunk) => supabase.from("exercises").select("id, name").in("id", chunk)),
  ]);

  const exerciseName = new Map(exercises.map((e) => [e.id, e.name]));
  const workoutById = new Map(workouts.map((w) => [w.id, w]));
  const programById = new Map(programRows.map((p) => [p.id, p]));
  const submittedWorkoutIds = new Set(completions.map((c) => c.workout_id));
  const plannedByWe = new Map<string, PlannedSet[]>();
  for (const row of plannedRows) {
    plannedByWe.set(row.workout_exercise_id, [...(plannedByWe.get(row.workout_exercise_id) ?? []), toPlannedSet(row)]);
  }
  const loggedByWe = new Map<string, typeof loggedRows>();
  for (const row of loggedRows) {
    loggedByWe.set(row.workout_exercise_id, [...(loggedByWe.get(row.workout_exercise_id) ?? []), row]);
  }

  const currentWeekKey = toDateKey(getWeekStart(israelNow()));

  // ---- one row per exercise slot, in the order of the first week it appears in
  const rowsBySlot = new Map<string, BlockRow & { sort: [number, number, number, number] }>();
  const startedProgramIds = new Set<string>();
  for (const we of workoutExercises) {
    const workout = workoutById.get(we.workout_id);
    const program = workout ? programById.get(workout.program_id) : undefined;
    if (!workout || !program || program.block_week_index == null) continue;

    const sets = (plannedByWe.get(we.id) ?? []).sort((a, b) => a.setIndex - b.setIndex);
    const logs = loggedByWe.get(we.id) ?? [];
    const working = sets.filter((s) => s.setType !== "warmup");
    const met = working.filter((s) => {
      const log = logs.find((l) => l.set_index === s.setIndex);
      return log ? isSetTargetMet(s, { reps: log.reps, weightKg: log.weight_kg == null ? null : Number(log.weight_kg) }) : false;
    }).length;
    if (logs.length > 0 || submittedWorkoutIds.has(workout.id)) startedProgramIds.add(program.id);

    const explanation = describeProgression(we.progression_info);
    const cell: BlockCell = {
      summary: summarizeSets(sets),
      explanation: explanation?.text ?? null,
      tone: explanation?.tone ?? null,
      outcome: we.progression_info?.outcome ?? null,
      hasOverride: sets.some((s) => s.isManualOverride),
      performed:
        logs.length > 0
          ? { met, total: working.length }
          : submittedWorkoutIds.has(workout.id)
            ? { met: 0, total: working.length }
            : null,
    };

    const existing = rowsBySlot.get(we.slot_key);
    const sort: [number, number, number, number] = [
      program.block_week_index,
      workout.day_of_week,
      workout.order_index,
      we.order_index,
    ];
    if (!existing) {
      rowsBySlot.set(we.slot_key, {
        slotKey: we.slot_key,
        exerciseName: exerciseName.get(we.exercise_id) ?? "תרגיל לא ידוע",
        workoutLabel: dayName(workout.day_of_week),
        rule: describeRule(ruleFromRow(we)),
        stalled: false,
        cells: { [program.block_week_index]: cell },
        sort,
      });
    } else {
      existing.cells[program.block_week_index] = cell;
      // The label, name and rule shown are the latest week's (a swap "sticks").
      const latest = Math.max(...Object.keys(existing.cells).map(Number));
      if (program.block_week_index === latest) {
        existing.exerciseName = exerciseName.get(we.exercise_id) ?? existing.exerciseName;
        existing.rule = describeRule(ruleFromRow(we));
      }
      if (sort[0] < existing.sort[0]) existing.sort = sort;
    }
  }

  const rows: BlockRow[] = [...rowsBySlot.values()]
    .sort((a, b) => {
      for (let i = 0; i < 4; i += 1) if (a.sort[i] !== b.sort[i]) return a.sort[i] - b.sort[i];
      return 0;
    })
    .map((sorted) => {
      const row: BlockRow = {
        slotKey: sorted.slotKey,
        exerciseName: sorted.exerciseName,
        workoutLabel: sorted.workoutLabel,
        rule: sorted.rule,
        stalled: false,
        cells: sorted.cells,
      };
      // "תקוע": the last two decided weeks both repeated the target.
      const decided = Object.entries(row.cells)
        .map(([index, cell]) => ({ index: Number(index), outcome: cell.outcome }))
        .filter((c) => c.outcome === "advanced" || c.outcome === "repeated" || c.outcome === "skipped")
        .sort((a, b) => a.index - b.index);
      const lastTwo = decided.slice(-2);
      return { ...row, stalled: lastTwo.length === 2 && lastTwo.every((c) => c.outcome === "repeated") };
    });

  const weeks: BlockWeek[] = programRows
    .filter((p) => p.block_week_index != null)
    .map((p) => ({
      programId: p.id,
      index: p.block_week_index as number,
      range: formatWeekRange(parseDateKey(p.week_start_date)),
      status: p.status,
      isDeload: p.is_deload,
      deloadPct: p.deload_pct,
      isCurrent: p.week_start_date === currentWeekKey,
      isPast: p.week_start_date < currentWeekKey,
      started: startedProgramIds.has(p.id),
      exerciseCount: workoutExercises.filter((we) => workoutById.get(we.workout_id)?.program_id === p.id).length,
    }));

  return (
    <AppShell title={`${block.title} — ${trainee.full_name}`} backHref={`/trainer/trainees/${traineeId}`} readOnly={readOnly}>
      <BlockOverview
        readOnly={readOnly}
        traineeId={traineeId}
        traineeName={trainee.full_name}
        block={{
          id: block.id,
          title: block.title,
          weeksCount: block.weeks_count,
          status: block.status,
          defaultDeloadPct: block.default_deload_pct,
          autoPublish: block.auto_publish_next_week,
        }}
        weeks={weeks}
        rows={rows}
      />
    </AppShell>
  );
}
