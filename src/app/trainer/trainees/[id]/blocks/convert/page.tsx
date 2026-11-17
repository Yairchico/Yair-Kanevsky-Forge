import { notFound, redirect } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { selectInChunks } from "@/lib/previous-sets";
import { getTrainerContext } from "@/lib/require-trainer";
import { isUuid } from "@/lib/utils";
import { addDays, formatWeekLabel, formatWeekRange, getWeekStart, israelNow, parseDateKey, toDateKey } from "@/lib/week";
import { ConvertBlockForm, type ConvertCandidate } from "./convert-block-form";

/**
 * "המר שבועות קיימים לבלוק" (planning/PLAN.md Q2.8). Trainer only — it's a
 * pure mutation, so the read-only viewer is sent back to the trainee's page.
 */
export default async function ConvertToBlockPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: traineeId } = await params;
  if (!isUuid(traineeId)) notFound();
  const ctx = await getTrainerContext();
  if (!ctx) redirect(`/trainer/trainees/${traineeId}`);
  const { supabase } = ctx;

  const currentWeekStart = getWeekStart(israelNow());
  const currentWeekKey = toDateKey(currentWeekStart);

  const [{ data: trainee }, { data: programs }] = await Promise.all([
    supabase.from("profiles").select("id, full_name").eq("id", traineeId).eq("role", "trainee").maybeSingle(),
    supabase
      .from("programs")
      .select("id, title, status, week_start_date")
      .eq("trainee_id", traineeId)
      .is("deleted_at", null)
      .is("block_id", null)
      .gte("week_start_date", toDateKey(addDays(currentWeekStart, -16 * 7)))
      .lte("week_start_date", toDateKey(addDays(currentWeekStart, 8 * 7)))
      .order("week_start_date"),
  ]);
  if (!trainee) notFound();

  const programIds = (programs ?? []).map((p) => p.id);
  const workouts = await selectInChunks(programIds, (chunk) =>
    supabase.from("workouts").select("id, program_id").in("program_id", chunk),
  );
  const [workoutExercises, completions] = await Promise.all([
    selectInChunks(
      workouts.map((w) => w.id),
      (chunk) => supabase.from("workout_exercises").select("workout_id").in("workout_id", chunk),
    ),
    selectInChunks(
      workouts.map((w) => w.id),
      (chunk) => supabase.from("workout_completions").select("workout_id").in("workout_id", chunk),
    ),
  ]);
  const programOf = new Map(workouts.map((w) => [w.id, w.program_id]));
  const exerciseCount = new Map<string, number>();
  for (const we of workoutExercises) {
    const p = programOf.get(we.workout_id);
    if (p) exerciseCount.set(p, (exerciseCount.get(p) ?? 0) + 1);
  }
  const submitted = new Map<string, number>();
  for (const c of completions) {
    const p = programOf.get(c.workout_id);
    if (p) submitted.set(p, (submitted.get(p) ?? 0) + 1);
  }

  const candidates: ConvertCandidate[] = (programs ?? []).map((p) => {
    const weekStart = parseDateKey(p.week_start_date);
    return {
      id: p.id,
      title: p.title,
      weekKey: p.week_start_date,
      label: `${formatWeekLabel(weekStart, currentWeekStart)} · ${formatWeekRange(weekStart)}`,
      status: p.status,
      workoutCount: workouts.filter((w) => w.program_id === p.id).length,
      exerciseCount: exerciseCount.get(p.id) ?? 0,
      submittedCount: submitted.get(p.id) ?? 0,
      // A sensible start: the weeks of the last month up to this one.
      suggested: p.week_start_date <= currentWeekKey && p.week_start_date >= toDateKey(addDays(currentWeekStart, -3 * 7)),
    };
  });

  return (
    <AppShell title={`בלוק משבועות קיימים — ${trainee.full_name}`} backHref={`/trainer/trainees/${traineeId}`}>
      <ConvertBlockForm traineeId={traineeId} traineeName={trainee.full_name} candidates={candidates} />
    </AppShell>
  );
}
