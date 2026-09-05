import { createClient } from "@/lib/supabase/server";
import { AppShell } from "@/components/app-shell";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

/**
 * Shows the last 30 days of logged performance entries (workout_logs) —
 * this is the one table in the schema that's actually date-scoped and
 * accumulates over time, so it's the honest source for "history."
 * workout_completions (submitted/not) is a single current-state flag per
 * workout, not per calendar occurrence, so a workout done again next week
 * overwrites last week's — it can't show multiple past weeks. Real weekly
 * history would need program instances scoped by date, which is a bigger
 * schema change than this pass.
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
          <CardContent className="p-6 text-sm text-muted-foreground">
            שגיאת התחברות.
          </CardContent>
        </Card>
      </AppShell>
    );
  }

  const monthAgo = new Date();
  monthAgo.setDate(monthAgo.getDate() - 30);

  const { data: logs } = await supabase
    .from("workout_logs")
    .select("id, workout_exercise_id, performed_at, actual_sets, rpe_actual, notes")
    .eq("trainee_id", user.id)
    .gte("performed_at", monthAgo.toISOString())
    .order("performed_at", { ascending: false });

  const workoutExerciseIds = [...new Set((logs ?? []).map((l) => l.workout_exercise_id))];
  const { data: workoutExercises } = await supabase
    .from("workout_exercises")
    .select("id, exercise_id")
    .in(
      "id",
      workoutExerciseIds.length ? workoutExerciseIds : ["00000000-0000-0000-0000-000000000000"],
    );

  const exerciseIds = [...new Set((workoutExercises ?? []).map((w) => w.exercise_id))];
  const { data: exercises } = await supabase
    .from("exercises")
    .select("id, name")
    .in("id", exerciseIds.length ? exerciseIds : ["00000000-0000-0000-0000-000000000000"]);

  const exerciseNameByWorkoutExercise = new Map(
    (workoutExercises ?? []).map((we) => [
      we.id,
      exercises?.find((e) => e.id === we.exercise_id)?.name ?? "תרגיל לא ידוע",
    ]),
  );

  // Group by calendar day (local date string).
  const groups = new Map<string, typeof logs>();
  for (const log of logs ?? []) {
    const dateKey = new Date(log.performed_at).toLocaleDateString("he-IL", {
      weekday: "long",
      day: "numeric",
      month: "long",
    });
    if (!groups.has(dateKey)) groups.set(dateKey, []);
    groups.get(dateKey)!.push(log);
  }

  return (
    <AppShell title="היסטוריה" backHref="/trainee">
      <p className="text-sm text-muted-foreground">
        ביצועים שהוזנו ב-30 הימים האחרונים.
      </p>

      {groups.size === 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>אין עדיין היסטוריה</CardTitle>
            <CardDescription>
              כשתזין ביצוע בפועל לתרגיל (בכפתור &quot;הזן ביצוע בפועל&quot;), הוא יופיע כאן.
            </CardDescription>
          </CardHeader>
        </Card>
      ) : (
        <div className="space-y-5">
          {[...groups.entries()].map(([date, entries]) => (
            <div key={date} className="space-y-2">
              <h2 className="text-sm font-semibold text-muted-foreground">{date}</h2>
              <div className="space-y-2">
                {entries!.map((log) => {
                  const sets = log.actual_sets as
                    | { weight?: string | null; reps?: string | null }
                    | null;
                  return (
                    <Card key={log.id}>
                      <CardContent className="p-3">
                        <p className="text-sm font-medium">
                          {exerciseNameByWorkoutExercise.get(log.workout_exercise_id)}
                        </p>
                        <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted-foreground">
                          {sets?.reps && <span>{sets.reps} חזרות</span>}
                          {sets?.weight && <span>{sets.weight}</span>}
                          {log.rpe_actual != null && <span>RPE {log.rpe_actual}</span>}
                        </div>
                        {log.notes && <p className="mt-1 text-sm">{log.notes}</p>}
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </AppShell>
  );
}
