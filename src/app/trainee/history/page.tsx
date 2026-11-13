import { createClient } from "@/lib/supabase/server";
import { AppShell } from "@/components/app-shell";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { formatShortDateTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import {
  PLANNED_SET_COLUMNS,
  SET_LOG_COLUMNS,
  formatLegacyActual,
  formatLoggedSet,
  isSetTargetMet,
  toLoggedSet,
  toPlannedSet,
  type LoggedSet,
} from "@/lib/sets";
import { selectInChunks } from "@/lib/previous-sets";
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
      .select("workout_exercise_id, actual_sets, notes")
      .eq("trainee_id", user.id),
  ]);

  // Per-set performance (migration 0013) and the planned targets, to mark
  // a set that fell short of its target.
  const workoutExerciseIds = (workoutExercises ?? []).map((we) => we.id);
  const [plannedRows, loggedRows] = await Promise.all([
    selectInChunks(workoutExerciseIds, (chunk) =>
      supabase.from("workout_exercise_sets").select(PLANNED_SET_COLUMNS).in("workout_exercise_id", chunk),
    ),
    selectInChunks(workoutExerciseIds, (chunk) =>
      supabase
        .from("set_logs")
        .select(SET_LOG_COLUMNS)
        .eq("trainee_id", user.id)
        .eq("status", "done")
        .neq("source", "legacy")
        .in("workout_exercise_id", chunk),
    ),
  ]);
  const plannedByKey = new Map(plannedRows.map((r) => [`${r.workout_exercise_id}:${r.set_index}`, toPlannedSet(r)]));
  const loggedByWe = new Map<string, LoggedSet[]>();
  for (const row of loggedRows) {
    const list = loggedByWe.get(row.workout_exercise_id) ?? [];
    list.push(toLoggedSet(row));
    loggedByWe.set(row.workout_exercise_id, list);
  }

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
          const sets = (loggedByWe.get(we.id) ?? [])
            .sort((a, b) => a.setIndex - b.setIndex)
            .map((set) => ({
              ...set,
              met: isSetTargetMet(plannedByKey.get(`${we.id}:${set.setIndex}`), set),
            }));
          const legacy = sets.length === 0 ? formatLegacyActual(log?.actual_sets) : null;
          if (sets.length === 0 && !legacy && !log?.notes) return null;
          return {
            id: we.id,
            name: exerciseNameById.get(we.exercise_id) ?? "תרגיל לא ידוע",
            sets,
            legacy,
            notes: log?.notes ?? null,
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
                        <p className="text-sm font-medium">{ex.name}</p>
                        {ex.sets.length > 0 && (
                          <div className="flex flex-wrap gap-1.5 pt-0.5">
                            {ex.sets.map((set) => (
                              <span
                                key={set.setIndex}
                                dir="ltr"
                                className={cn(
                                  "rounded-md px-2 py-0.5 text-sm",
                                  set.met ? "bg-muted" : "bg-warning/20 text-warning-foreground",
                                )}
                              >
                                {formatLoggedSet(set)}
                              </span>
                            ))}
                          </div>
                        )}
                        {ex.legacy && (
                          <p className="text-sm">
                            {ex.legacy}{" "}
                            <span className="text-xs text-muted-foreground">(מלפני פיצול הסטים)</span>
                          </p>
                        )}
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
