import { createClient } from "@/lib/supabase/server";
import { AppShell } from "@/components/app-shell";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { formatShortDateTime, formatWeight } from "@/lib/format";
import { dayName } from "@/lib/week";

/**
 * A log of submitted workouts — one card per workout_completions row
 * (an actual "הגש אימון"), not per workout_logs row. workout_logs is
 * upserted per (workout_exercise_id, trainee_id) since migration 0012, so
 * there's exactly one row per exercise per week's workout occurrence to
 * begin with; grouping by the submission itself (rather than listing raw
 * log rows keyed by their own performed_at) is what keeps this a clean
 * "here's what you submitted, and when" list instead of a pile of
 * near-duplicate entries.
 */
export default async function TraineeHistoryPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return (
      <AppShell title="היסטוריה" backHref="/trainee">
        <Card>
          <CardContent className="p-6 text-base text-muted-foreground">
            שגיאת התחברות.
          </CardContent>
        </Card>
      </AppShell>
    );
  }

  const monthAgo = new Date();
  monthAgo.setDate(monthAgo.getDate() - 30);
  const noRows = ["00000000-0000-0000-0000-000000000000"];

  const { data: completions } = await supabase
    .from("workout_completions")
    .select("workout_id, completed_at")
    .eq("trainee_id", user.id)
    .gte("completed_at", monthAgo.toISOString())
    .order("completed_at", { ascending: false });

  const workoutIds = [...new Set((completions ?? []).map((c) => c.workout_id))];

  const [{ data: workouts }, { data: workoutExercises }, { data: logs }] = await Promise.all([
    supabase
      .from("workouts")
      .select("id, day_of_week, program_id")
      .in("id", workoutIds.length ? workoutIds : noRows),
    supabase
      .from("workout_exercises")
      .select("id, workout_id, exercise_id, order_index")
      .in("workout_id", workoutIds.length ? workoutIds : noRows)
      .order("order_index"),
    supabase
      .from("workout_logs")
      .select("workout_exercise_id, actual_sets, rpe_actual, notes")
      .eq("trainee_id", user.id),
  ]);

  const programIds = [...new Set((workouts ?? []).map((w) => w.program_id))];
  const { data: programs } = await supabase
    .from("programs")
    .select("id, title")
    .in("id", programIds.length ? programIds : noRows);

  const exerciseIds = [...new Set((workoutExercises ?? []).map((we) => we.exercise_id))];
  const { data: exercises } = await supabase
    .from("exercises")
    .select("id, name")
    .in("id", exerciseIds.length ? exerciseIds : noRows);

  const workoutById = new Map((workouts ?? []).map((w) => [w.id, w]));
  const programTitleById = new Map((programs ?? []).map((p) => [p.id, p.title]));
  const exerciseNameById = new Map((exercises ?? []).map((e) => [e.id, e.name]));
  const logByWorkoutExerciseId = new Map((logs ?? []).map((l) => [l.workout_exercise_id, l]));

  const history = (completions ?? [])
    .map((completion) => {
      // A workout the trainer later deleted (or unpublished — RLS scopes
      // a trainee's own SELECT on workouts to published, non-deleted
      // programs) won't resolve here; skip it rather than show a broken row.
      const workout = workoutById.get(completion.workout_id);
      if (!workout) return null;

      const exercisesForWorkout = (workoutExercises ?? [])
        .filter((we) => we.workout_id === completion.workout_id)
        .map((we) => {
          const log = logByWorkoutExerciseId.get(we.id);
          if (!log) return null;
          const sets = log.actual_sets as { weight?: string | null; reps?: string | null } | null;
          return {
            id: we.id,
            name: exerciseNameById.get(we.exercise_id) ?? "תרגיל לא ידוע",
            reps: sets?.reps ?? null,
            weight: sets?.weight ?? null,
            rpe: log.rpe_actual,
            notes: log.notes,
          };
        })
        .filter((ex): ex is NonNullable<typeof ex> => ex !== null);

      const programTitle = programTitleById.get(workout.program_id);
      return {
        workoutId: completion.workout_id,
        completedAt: completion.completed_at,
        label: programTitle ? `${dayName(workout.day_of_week)} · ${programTitle}` : dayName(workout.day_of_week),
        exercises: exercisesForWorkout,
      };
    })
    .filter((entry): entry is NonNullable<typeof entry> => entry !== null);

  return (
    <AppShell title="היסטוריה" backHref="/trainee">
      <p className="text-base text-muted-foreground">אימונים שהוגשו ב-30 הימים האחרונים.</p>

      {history.length === 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>אין עדיין היסטוריה</CardTitle>
            <CardDescription className="text-base">
              כשתגיש אימון, הוא יופיע כאן.
            </CardDescription>
          </CardHeader>
        </Card>
      ) : (
        <div className="space-y-3">
          {history.map((entry) => (
            <Card key={entry.workoutId}>
              <CardContent className="space-y-2.5 p-4">
                <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
                  <p className="text-base font-semibold">{entry.label}</p>
                  <span className="text-sm text-muted-foreground">
                    {formatShortDateTime(entry.completedAt)}
                  </span>
                </div>

                {entry.exercises.length === 0 ? (
                  <p className="text-sm text-muted-foreground">האימון הוגש ללא פרטי ביצוע.</p>
                ) : (
                  <div className="divide-y divide-border">
                    {entry.exercises.map((ex) => (
                      <div key={ex.id} className="space-y-0.5 py-2 first:pt-0 last:pb-0">
                        <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
                          <span className="text-sm font-medium">{ex.name}</span>
                          <span className="text-sm text-muted-foreground">
                            {[ex.reps && `${ex.reps} חזרות`, formatWeight(ex.weight), ex.rpe != null && `RPE ${ex.rpe}`]
                              .filter(Boolean)
                              .join(" · ") || "נרשם"}
                          </span>
                        </div>
                        {ex.notes && <p className="text-sm text-muted-foreground">{ex.notes}</p>}
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </AppShell>
  );
}
