import { notFound, redirect } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { countExercises } from "@/lib/format";
import { selectInChunks } from "@/lib/previous-sets";
import { getRequestAuth } from "@/lib/viewer";
import { isUuid } from "@/lib/utils";
import { addDays, formatWeekLabel, formatWeekRange, getWeekStart, israelNow, parseDateKey, toDateKey } from "@/lib/week";
import { NewBlockForm } from "./new-block-form";

/**
 * "בלוק חדש" (planning/PLAN.md feature 2): a run of weekly programs whose
 * targets progress automatically. Creating one is a pure mutation, so the
 * read-only viewer is sent back to the trainee's page.
 */
export default async function NewBlockPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: traineeId } = await params;
  if (!isUuid(traineeId)) notFound();
  const { supabase, viewer } = await getRequestAuth();

  const currentWeekStart = getWeekStart(israelNow());
  const currentWeekKey = toDateKey(currentWeekStart);

  // Who is asking is verified in the same wait as the first queries.
  const [me, { data: trainee }, { data: programs }] = await Promise.all([
    viewer,
    supabase.from("profiles").select("id, full_name").eq("id", traineeId).eq("role", "trainee").maybeSingle(),
    supabase
      .from("programs")
      .select("id, title, week_start_date, block_id")
      .eq("trainee_id", traineeId)
      .is("deleted_at", null)
      .gte("week_start_date", toDateKey(addDays(currentWeekStart, -8 * 7)))
      .order("week_start_date", { ascending: false }),
  ]);
  if (me?.role !== "trainer") redirect(`/trainer/trainees/${traineeId}`);
  if (!trainee) notFound();

  // What can be copied into week 1: recent programs that actually have exercises.
  const programIds = (programs ?? []).map((p) => p.id);
  const workouts = await selectInChunks(programIds, (chunk) =>
    supabase.from("workouts").select("id, program_id").in("program_id", chunk),
  );
  const workoutExercises = await selectInChunks(
    workouts.map((w) => w.id),
    (chunk) => supabase.from("workout_exercises").select("workout_id").in("workout_id", chunk),
  );
  const programByWorkout = new Map(workouts.map((w) => [w.id, w.program_id]));
  const exerciseCount = new Map<string, number>();
  for (const we of workoutExercises) {
    const programId = programByWorkout.get(we.workout_id);
    if (programId) exerciseCount.set(programId, (exerciseCount.get(programId) ?? 0) + 1);
  }

  const sources = (programs ?? [])
    .filter((p) => (exerciseCount.get(p.id) ?? 0) > 0)
    .map((p) => {
      const weekStart = parseDateKey(p.week_start_date);
      return {
        id: p.id,
        label: `${p.title} · ${formatWeekLabel(weekStart, currentWeekStart)} (${formatWeekRange(weekStart)}) · ${countExercises(exerciseCount.get(p.id) ?? 0)}`,
      };
    });

  const startOptions = [0, 1, 2, 3, 4].map((offset) => {
    const start = addDays(currentWeekStart, offset * 7);
    return {
      key: toDateKey(start),
      label: `${formatWeekLabel(start, currentWeekStart)} · ${formatWeekRange(start)}`,
    };
  });

  return (
    <AppShell title={`בלוק חדש — ${trainee.full_name}`} backHref={`/trainer/trainees/${traineeId}`}>
      <NewBlockForm
        traineeId={traineeId}
        traineeName={trainee.full_name}
        currentWeekKey={currentWeekKey}
        startOptions={startOptions}
        sources={sources}
      />
    </AppShell>
  );
}
