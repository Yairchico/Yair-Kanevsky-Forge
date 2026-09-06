import { notFound } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { AppShell } from "@/components/app-shell";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { buttonVariants } from "@/components/ui/button";
import { TraineeEditForm } from "./trainee-edit-form";
import { DeleteTraineeButton } from "./delete-trainee-button";
import { TraineeWeekView } from "./trainee-week-view";
import { ProgramRow } from "./program-row";
import { cn } from "@/lib/utils";
import { addDays, getWeekStart, toDateKey } from "@/lib/week";

export default async function TraineeDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();

  // Independent of each other — fetched together instead of one after
  // another, which used to add up (this page was reported as slow to open).
  const [{ data: trainee }, { data: programs }] = await Promise.all([
    supabase
      .from("profiles")
      .select("id, full_name, username, phone, email, status, created_at")
      .eq("id", id)
      .eq("role", "trainee")
      .single(),
    supabase
      .from("programs")
      .select("id, title, status, week_start_date")
      .eq("trainee_id", id)
      .order("week_start_date", { ascending: false }),
  ]);

  if (!trainee) notFound();

  const allPrograms = programs ?? [];
  const eightWeeksAgo = toDateKey(addDays(getWeekStart(new Date()), -8 * 7));
  // Reuses the same fetch above instead of a second, near-identical
  // `programs` query just to narrow the date range.
  const recentPrograms = allPrograms.filter((p) => p.week_start_date >= eightWeeksAgo);

  const programIds = recentPrograms.map((p) => p.id);
  const noRows = ["00000000-0000-0000-0000-000000000000"];

  const { data: workouts } = await supabase
    .from("workouts")
    .select("id, program_id, day_of_week, order_index")
    .in("program_id", programIds.length ? programIds : noRows)
    .order("day_of_week")
    .order("order_index");

  const workoutIds = (workouts ?? []).map((w) => w.id);

  const [
    { data: workoutExercises },
    { data: exercises },
    { data: workoutCompletions },
    { data: exerciseCompletions },
    { data: recentLogs },
  ] = await Promise.all([
    supabase
      .from("workout_exercises")
      .select("id, workout_id, exercise_id, order_index, sets, reps, weight, rpe, rest_seconds")
      .in("workout_id", workoutIds.length ? workoutIds : noRows)
      .order("order_index"),
    supabase.from("exercises").select("id, name, muscle_group"),
    supabase
      .from("workout_completions")
      .select("workout_id, completed_at")
      .eq("trainee_id", id)
      .in("workout_id", workoutIds.length ? workoutIds : noRows),
    supabase
      .from("workout_exercise_completions")
      .select("workout_exercise_id")
      .eq("trainee_id", id),
    supabase
      .from("workout_logs")
      .select("workout_exercise_id, performed_at, actual_sets, rpe_actual, notes")
      .eq("trainee_id", id)
      .order("performed_at", { ascending: false })
      .limit(300),
  ]);

  const exerciseById = new Map((exercises ?? []).map((e) => [e.id, e]));
  const submissionByWorkoutId = new Map(
    (workoutCompletions ?? []).map((c) => [c.workout_id, c.completed_at]),
  );
  const doneExerciseIds = new Set(
    (exerciseCompletions ?? []).map((c) => c.workout_exercise_id),
  );
  const latestLogByWorkoutExerciseId = new Map<
    string,
    { weight: string | null; reps: string | null; rpe: number | null; notes: string | null; performedAt: string }
  >();
  for (const log of recentLogs ?? []) {
    if (latestLogByWorkoutExerciseId.has(log.workout_exercise_id)) continue;
    const sets = log.actual_sets as { weight?: string | null; reps?: string | null } | null;
    latestLogByWorkoutExerciseId.set(log.workout_exercise_id, {
      weight: sets?.weight ?? null,
      reps: sets?.reps ?? null,
      rpe: log.rpe_actual,
      notes: log.notes,
      performedAt: log.performed_at,
    });
  }

  const weeks = recentPrograms.map((program) => ({
    programId: program.id,
    title: program.title,
    status: program.status,
    weekStartDate: program.week_start_date,
    workouts: (workouts ?? [])
      .filter((w) => w.program_id === program.id)
      .map((w) => ({
        id: w.id,
        dayOfWeek: w.day_of_week,
        orderIndex: w.order_index,
        submittedAt: submissionByWorkoutId.get(w.id) ?? null,
        exercises: (workoutExercises ?? [])
          .filter((we) => we.workout_id === w.id)
          .map((we) => {
            const exercise = exerciseById.get(we.exercise_id);
            return {
              id: we.id,
              name: exercise?.name ?? "תרגיל לא ידוע",
              muscleGroup: exercise?.muscle_group ?? null,
              planned: {
                sets: we.sets,
                reps: we.reps,
                weight: we.weight,
                rpe: we.rpe,
                restSeconds: we.rest_seconds,
              },
              done: doneExerciseIds.has(we.id),
              log: latestLogByWorkoutExerciseId.get(we.id) ?? null,
            };
          }),
      })),
  }));

  return (
    <AppShell title={trainee.full_name} backHref="/trainer/trainees">
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>פרטי מתאמן</CardTitle>
            <CardDescription>עריכה ואיפוס סיסמה</CardDescription>
          </CardHeader>
          <CardContent>
            <TraineeEditForm trainee={trainee} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-2">
            <div>
              <CardTitle>תוכניות אימון</CardTitle>
              <CardDescription>תוכניות שבועיות עבור {trainee.full_name}</CardDescription>
            </div>
            <Link
              href={`/trainer/trainees/${id}/programs/new`}
              className={cn(buttonVariants({ size: "sm" }), "shrink-0")}
            >
              + תוכנית חדשה
            </Link>
          </CardHeader>
          <CardContent className="space-y-2">
            {!allPrograms.length ? (
              <p className="text-sm text-muted-foreground">עדיין אין תוכניות.</p>
            ) : (
              allPrograms.map((p) => (
                <ProgramRow key={p.id} traineeId={id} program={p} />
              ))
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>התוכנית השבועית</CardTitle>
          <CardDescription>מה שהמתאמן סימן, ביצע בפועל והגיש (קריאה בלבד)</CardDescription>
        </CardHeader>
        <CardContent>
          {!weeks.length ? (
            <p className="text-sm text-muted-foreground">אין עדיין תוכניות.</p>
          ) : (
            <TraineeWeekView weeks={weeks} />
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base text-destructive">אזור מסוכן</CardTitle>
        </CardHeader>
        <CardContent>
          <DeleteTraineeButton traineeId={id} traineeName={trainee.full_name} />
        </CardContent>
      </Card>
    </AppShell>
  );
}
