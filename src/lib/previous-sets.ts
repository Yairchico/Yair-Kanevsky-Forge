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

/**
 * "What did this trainee do last time on this exercise?" — for each of
 * `targets` (a workout_exercise row and its exercise_id), the sets logged
 * on the most recent OTHER occurrence of the same exercise that was logged
 * before this one. "Before" = before this occurrence's own first logged
 * set, or before now if it has none yet; that way an older week viewed
 * later still shows what came before it, not what came after.
 *
 * Looks back over the trainee's latest `limit` logged sets — plenty for
 * "last time" without scanning their entire history.
 */
export async function getPreviousPerformance(
  supabase: Supabase,
  traineeId: string,
  targets: { workoutExerciseId: string; exerciseId: string }[],
  limit = 600,
): Promise<Map<string, PreviousPerformance>> {
  const result = new Map<string, PreviousPerformance>();
  if (targets.length === 0) return result;

  const { data: recent } = await supabase
    .from("set_logs")
    .select(SET_LOG_COLUMNS)
    .eq("trainee_id", traineeId)
    .eq("status", "done")
    .order("logged_at", { ascending: false })
    .limit(limit);
  if (!recent?.length) return result;

  const loggedWeIds = [...new Set(recent.map((r) => r.workout_exercise_id))];
  const weRows = await selectInChunks(loggedWeIds, (chunk) =>
    supabase.from("workout_exercises").select("id, exercise_id").in("id", chunk),
  );
  const exerciseIdByWeId = new Map(weRows.map((r) => [r.id, r.exercise_id]));

  // Per workout_exercise: its sets, and the time span they were logged in.
  const byWe = new Map<string, { exerciseId: string; first: string; last: string; sets: LoggedSet[] }>();
  for (const row of recent) {
    const exerciseId = exerciseIdByWeId.get(row.workout_exercise_id);
    if (!exerciseId) continue;
    const entry = byWe.get(row.workout_exercise_id);
    if (entry) {
      entry.sets.push(toLoggedSet(row));
      if (row.logged_at < entry.first) entry.first = row.logged_at;
      if (row.logged_at > entry.last) entry.last = row.logged_at;
    } else {
      byWe.set(row.workout_exercise_id, {
        exerciseId,
        first: row.logged_at,
        last: row.logged_at,
        sets: [toLoggedSet(row)],
      });
    }
  }

  // Occurrences per exercise, newest first.
  const byExercise = new Map<string, { weId: string; last: string; sets: LoggedSet[] }[]>();
  for (const [weId, entry] of byWe) {
    const list = byExercise.get(entry.exerciseId) ?? [];
    list.push({ weId, last: entry.last, sets: entry.sets });
    byExercise.set(entry.exerciseId, list);
  }
  for (const list of byExercise.values()) list.sort((a, b) => (a.last < b.last ? 1 : -1));

  const now = new Date().toISOString();
  for (const target of targets) {
    const before = byWe.get(target.workoutExerciseId)?.first ?? now;
    const previous = byExercise
      .get(target.exerciseId)
      ?.find((occ) => occ.weId !== target.workoutExerciseId && occ.last < before);
    if (previous) {
      result.set(target.workoutExerciseId, {
        loggedAt: previous.last,
        sets: [...previous.sets].sort((a, b) => a.setIndex - b.setIndex),
      });
    }
  }
  return result;
}
