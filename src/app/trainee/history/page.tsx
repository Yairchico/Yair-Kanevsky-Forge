import { getRequestAuth } from "@/lib/viewer";
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
import { loadExercisesOfSessions } from "@/lib/free-session-data";
import { isSessionStale } from "@/lib/free-sessions";
import { selectInChunks } from "@/lib/previous-sets";
import { dayName } from "@/lib/week";

interface HistoryEntry {
  key: string;
  /** When it happened: the submission time, or when a free session started. */
  at: string;
  label: string;
  /** Set when the trainer ran it (a session from the plan, or a free session). */
  tag: string | null;
  /** The trainer's overall note on the session. */
  trainerNote: string | null;
  exercises: {
    id: string;
    name: string;
    sets: (LoggedSet & { met: boolean })[];
    legacy: string | null;
    notes: string | null;
  }[];
}

/**
 * A log of submitted workouts — one card per workout_completions row
 * (an actual "הגש אימון"), not per workout_logs row. workout_logs is
 * upserted per (workout_exercise_id, trainee_id) since migration 0012, so
 * there's exactly one row per exercise per week's workout occurrence to
 * begin with; grouping by the submission itself (rather than listing raw
 * log rows keyed by their own performed_at) is what keeps this a clean
 * "here's what you submitted, and when" list instead of a pile of
 * near-duplicate entries.
 *
 * Two more things land here since the trainer-led sessions (migration
 * 0016): a workout from the plan that the trainer ran is tagged "אימון אישי
 * עם המאמן", and free sessions the trainer assigned to this trainee are
 * listed alongside, tagged "אימון חופשי עם המאמן".
 */
function SignedOut() {
  return (
    <AppShell title="היסטוריה" backHref="/trainee">
      <Card>
        <CardContent className="p-6 text-base text-muted-foreground">שגיאת התחברות.</CardContent>
      </Card>
    </AppShell>
  );
}

export default async function TraineeHistoryPage() {
  const { supabase, userId, viewer } = await getRequestAuth();
  if (!userId) return <SignedOut />;

  const monthAgo = new Date();
  monthAgo.setDate(monthAgo.getDate() - 30);
  const monthAgoIso = monthAgo.toISOString();
  const noRows = ["00000000-0000-0000-0000-000000000000"];

  // The workouts from the plan: submissions → their workouts and exercises
  // → the sets. Each step needs the previous one's ids.
  async function loadPlanHistory() {
    const { data: completions } = await supabase
      .from("workout_completions")
      .select("workout_id, completed_at, source, notes")
      .eq("trainee_id", userId!)
      .gte("completed_at", monthAgoIso)
      .order("completed_at", { ascending: false });
    const workoutIds = [...new Set((completions ?? []).map((c) => c.workout_id))];

    const [{ data: workouts }, { data: workoutExercises }] = await Promise.all([
      supabase
        .from("workouts")
        .select("id, day_of_week, program_id")
        .in("id", workoutIds.length ? workoutIds : noRows),
      supabase
        .from("workout_exercises")
        .select("id, workout_id, exercise_id, order_index")
        .in("workout_id", workoutIds.length ? workoutIds : noRows)
        .order("order_index"),
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
          .eq("trainee_id", userId!)
          .eq("status", "done")
          .neq("source", "legacy")
          .in("workout_exercise_id", chunk),
      ),
    ]);
    return { completions, workouts, workoutExercises, plannedRows, loggedRows };
  }

  // Free sessions the trainer assigned to this trainee, with everything
  // performed in them.
  async function loadFreeHistory() {
    const { data: sessions } = await supabase
      .from("free_sessions")
      .select("id, started_at, finished_at, notes")
      .eq("trainee_id", userId!)
      .gte("started_at", monthAgoIso)
      .order("started_at", { ascending: false })
      .limit(30);
    const exercisesBySession = await loadExercisesOfSessions(
      supabase,
      (sessions ?? []).map((session) => session.id),
    );
    return { sessions: sessions ?? [], exercisesBySession };
  }

  // Everything that doesn't depend on anything else starts together; the
  // two chains above run side by side instead of one after the other.
  const [user, plan, free, { data: logs }, { data: programs }, { data: exercises }] = await Promise.all([
    viewer,
    loadPlanHistory(),
    loadFreeHistory(),
    supabase.from("workout_logs").select("workout_exercise_id, actual_sets, notes").eq("trainee_id", userId),
    // RLS: only this trainee's own published programs.
    supabase.from("programs").select("id, title").eq("trainee_id", userId),
    supabase.from("exercises").select("id, name"),
  ]);
  if (!user) return <SignedOut />;
  const { completions, workouts, workoutExercises, plannedRows, loggedRows } = plan;

  // A free session counts once it's over: finished, or left open long
  // enough that it clearly isn't in progress any more. Empty ones never do.
  const freeSessions = free.sessions.filter(
    (session) =>
      (session.finished_at != null || isSessionStale(session.started_at)) &&
      (free.exercisesBySession.get(session.id) ?? []).some((ex) => ex.loggedSets.length > 0),
  );
  const freeExercisesBySession = free.exercisesBySession;

  const plannedByKey = new Map(plannedRows.map((r) => [`${r.workout_exercise_id}:${r.set_index}`, toPlannedSet(r)]));
  const loggedByWe = new Map<string, LoggedSet[]>();
  for (const row of loggedRows) {
    const list = loggedByWe.get(row.workout_exercise_id) ?? [];
    list.push(toLoggedSet(row));
    loggedByWe.set(row.workout_exercise_id, list);
  }

  const workoutById = new Map((workouts ?? []).map((w) => [w.id, w]));
  const programTitleById = new Map((programs ?? []).map((p) => [p.id, p.title]));
  const exerciseNameById = new Map((exercises ?? []).map((e) => [e.id, e.name]));
  const logByWorkoutExerciseId = new Map((logs ?? []).map((l) => [l.workout_exercise_id, l]));

  const planHistory: HistoryEntry[] = (completions ?? [])
    .map((completion): HistoryEntry | null => {
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
      const byTrainer = completion.source === "trainer_session";
      return {
        key: completion.workout_id,
        at: completion.completed_at,
        label: programTitle ? `${dayName(workout.day_of_week)} · ${programTitle}` : dayName(workout.day_of_week),
        tag: byTrainer ? "אימון אישי עם המאמן" : null,
        trainerNote: byTrainer ? completion.notes : null,
        exercises: exercisesForWorkout,
      };
    })
    .filter((entry): entry is HistoryEntry => entry !== null);

  const freeHistory: HistoryEntry[] = freeSessions.map((session) => ({
    key: `free-${session.id}`,
    at: session.started_at,
    label: "אימון חופשי",
    tag: "אימון חופשי עם המאמן",
    trainerNote: session.notes ?? null,
    exercises: (freeExercisesBySession.get(session.id) ?? [])
      .filter((ex) => ex.loggedSets.length > 0)
      .map((ex) => ({
        id: ex.id,
        name: ex.name,
        sets: ex.loggedSets.map((set) => ({
          ...set,
          met: isSetTargetMet(
            ex.plannedSets.find((planned) => planned.setIndex === set.setIndex),
            set,
          ),
        })),
        legacy: null,
        notes: ex.initialNote,
      })),
  }));

  const history = [...planHistory, ...freeHistory].sort((a, b) => (a.at < b.at ? 1 : -1));

  return (
    <AppShell title="היסטוריה" backHref="/trainee">
      <p className="text-base text-muted-foreground">אימונים מ-30 הימים האחרונים.</p>

      {history.length === 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>אין עדיין היסטוריה</CardTitle>
            <CardDescription className="text-base">
              כשתגיש אימון, או כשהמאמן יתעד אימון איתך, הוא יופיע כאן.
            </CardDescription>
          </CardHeader>
        </Card>
      ) : (
        <div className="space-y-3">
          {history.map((entry) => (
            <Card key={entry.key}>
              <CardContent className="space-y-2.5 p-4">
                <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
                  <p className="flex flex-wrap items-center gap-2 text-base font-semibold">
                    {entry.label}
                    {entry.tag && (
                      <span className="rounded-full bg-primary-tint px-2.5 py-0.5 text-xs font-medium text-primary-text">
                        {entry.tag}
                      </span>
                    )}
                  </p>
                  <span className="text-sm text-muted-foreground">{formatShortDateTime(entry.at)}</span>
                </div>
                {entry.trainerNote && (
                  <p className="rounded-md bg-muted/60 px-2.5 py-1.5 text-sm whitespace-pre-line">
                    <span className="text-muted-foreground">הערת המאמן: </span>
                    {entry.trainerNote}
                  </p>
                )}

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
