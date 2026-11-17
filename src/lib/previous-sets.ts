import type { createClient } from "@/lib/supabase/server";
import { SET_LOG_COLUMNS, toLoggedSet, type LoggedSet } from "@/lib/sets";

type Supabase = Awaited<ReturnType<typeof createClient>>;

const IN_CHUNK = 100;

/**
 * Runs a `.in(column, ids)` query in chunks and concatenates the rows.
 * PostgREST puts the id list in the URL, and a ±4-week window of workouts
 * can mean a few hundred exercise ids — long enough to risk a too-long
 * request line if sent at once.
 */
export async function selectInChunks<T>(
  ids: string[],
  query: (chunk: string[]) => PromiseLike<{ data: T[] | null }>,
): Promise<T[]> {
  if (ids.length === 0) return [];
  const chunks: string[][] = [];
  for (let i = 0; i < ids.length; i += IN_CHUNK) chunks.push(ids.slice(i, i + IN_CHUNK));
  const results = await Promise.all(chunks.map((chunk) => query(chunk)));
  return results.flatMap((r) => r.data ?? []);
}

export interface PreviousPerformance {
  /** When that earlier session's sets were logged (latest set). */
  loggedAt: string;
  sets: LoggedSet[];
}

interface Occurrence {
  /** The row the sets hang off: a workout_exercises id, or a free_session_exercises id. */
  key: string;
  exerciseId: string;
  first: string;
  last: string;
  sets: LoggedSet[];
}

type SetLogRow = Parameters<typeof toLoggedSet>[0] & { workout_exercise_id: string };

/** Answers "what did they do last time" for any exercise rows of one trainee — see loadPreviousIndex. */
export type PreviousLookup = (targets: { key: string; exerciseId: string }[]) => Map<string, PreviousPerformance>;

/**
 * "What did this trainee do last time on this exercise?" — for each of
 * `targets` (the row a set list hangs off — a workout_exercises row or a
 * free-session exercise — and its exercise_id), the sets logged on the most
 * recent OTHER occurrence of the same exercise that was logged before this
 * one. "Before" = before this occurrence's own first logged set, or before
 * now if it has none yet; that way an older week viewed later still shows
 * what came before it, not what came after.
 *
 * Both sources count: workouts from the weekly plan (set_logs) and free
 * sessions assigned to the trainee (QUESTIONS.md Q5.9). Looks back over the
 * trainee's latest `limit` logged plan sets and their 30 most recent free
 * sessions — plenty for "last time" without scanning their entire history.
 */
export async function getPreviousPerformance(
  supabase: Supabase,
  traineeId: string,
  targets: { key: string; exerciseId: string }[],
  limit = 600,
): Promise<Map<string, PreviousPerformance>> {
  if (targets.length === 0) return new Map();
  return (await loadPreviousIndex(supabase, traineeId, limit))(targets);
}

/**
 * Everything getPreviousPerformance needs from the database, which depends
 * only on the trainee — not on which exercises are being asked about. So a
 * page can start it together with its very first queries (it's a chain of
 * up to three waits on its own) and ask the returned lookup at the end,
 * instead of starting it after the page's last query.
 */
export async function loadPreviousIndex(supabase: Supabase, traineeId: string, limit = 600): Promise<PreviousLookup> {
  const [{ data: recentRows }, { data: freeSessions }] = await Promise.all([
    supabase
      .from("set_logs")
      .select(SET_LOG_COLUMNS)
      .eq("trainee_id", traineeId)
      .eq("status", "done")
      .order("logged_at", { ascending: false })
      .limit(limit),
    supabase
      .from("free_sessions")
      .select("id")
      .eq("trainee_id", traineeId)
      .order("started_at", { ascending: false })
      .limit(30),
  ]);
  const recent = (recentRows ?? []) as SetLogRow[];
  const sessionIds = (freeSessions ?? []).map((s) => s.id);

  const occurrences = new Map<string, Occurrence>();
  function add(key: string, exerciseId: string, set: LoggedSet) {
    const entry = occurrences.get(key);
    if (entry) {
      entry.sets.push(set);
      if (set.loggedAt < entry.first) entry.first = set.loggedAt;
      if (set.loggedAt > entry.last) entry.last = set.loggedAt;
    } else {
      occurrences.set(key, { key, exerciseId, first: set.loggedAt, last: set.loggedAt, sets: [set] });
    }
  }

  // The two sources don't depend on each other — resolved together.
  const loggedWeIds = [...new Set(recent.map((r) => r.workout_exercise_id))];
  const [weRows, sessionExercises] = await Promise.all([
    selectInChunks(loggedWeIds, (chunk) =>
      supabase.from("workout_exercises").select("id, exercise_id").in("id", chunk),
    ),
    selectInChunks(sessionIds, (chunk) =>
      supabase.from("free_session_exercises").select("id, exercise_id").in("session_id", chunk),
    ),
  ]);

  // ---- the weekly plan
  const exerciseIdByWeId = new Map(weRows.map((r) => [r.id, r.exercise_id]));
  for (const row of recent) {
    const exerciseId = exerciseIdByWeId.get(row.workout_exercise_id);
    if (exerciseId) add(row.workout_exercise_id, exerciseId, toLoggedSet(row));
  }

  // ---- free sessions assigned to this trainee
  const exerciseIdBySessionExerciseId = new Map(sessionExercises.map((e) => [e.id, e.exercise_id]));
  if (exerciseIdBySessionExerciseId.size > 0) {
    const freeSets = await selectInChunks([...exerciseIdBySessionExerciseId.keys()], (chunk) =>
      supabase
        .from("free_session_sets")
        .select("session_exercise_id, set_index, weight_kg, reps, rpe, logged_at")
        .in("session_exercise_id", chunk)
        .not("logged_at", "is", null),
    );
    for (const row of freeSets) {
      const exerciseId = exerciseIdBySessionExerciseId.get(row.session_exercise_id);
      if (!exerciseId || !row.logged_at) continue;
      add(
        row.session_exercise_id,
        exerciseId,
        toLoggedSet({ ...row, logged_at: row.logged_at, source: "trainer_session" }),
      );
    }
  }

  // Occurrences per exercise, newest first.
  const byExercise = new Map<string, Occurrence[]>();
  for (const occurrence of occurrences.values()) {
    const list = byExercise.get(occurrence.exerciseId) ?? [];
    list.push(occurrence);
    byExercise.set(occurrence.exerciseId, list);
  }
  for (const list of byExercise.values()) list.sort((a, b) => (a.last < b.last ? 1 : -1));

  return (targets) => {
    const result = new Map<string, PreviousPerformance>();
    const now = new Date().toISOString();
    for (const target of targets) {
      const before = occurrences.get(target.key)?.first ?? now;
      const previous = byExercise
        .get(target.exerciseId)
        ?.find((occurrence) => occurrence.key !== target.key && occurrence.last < before);
      if (previous) {
        result.set(target.key, {
          loggedAt: previous.last,
          sets: [...previous.sets].sort((a, b) => a.setIndex - b.setIndex),
        });
      }
    }
    return result;
  };
}
