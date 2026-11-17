/**
 * Server-side loading of a free session's exercises in the shape the
 * session screens use (SessionExerciseData). Not a "use server" module:
 * helpers that take an already authenticated Supabase client.
 */

import type { createClient } from "@/lib/supabase/server";
import type { SessionExerciseData } from "@/components/session/session-exercise-panel";
import { FREE_SET_COLUMNS, freeSetToLogged, freeSetToPlanned } from "@/lib/free-sessions";
import { getPreviousPerformance, selectInChunks } from "@/lib/previous-sets";
import type { LoggedSet, PlannedSet } from "@/lib/sets";
import { playableVideoUrl } from "@/lib/video";

type Supabase = Awaited<ReturnType<typeof createClient>>;

const NO_ROWS = ["00000000-0000-0000-0000-000000000000"];

/**
 * The exercises of several sessions at once, per session and in order, each
 * with its targets and what was performed. No "last time" — that's only
 * needed on the live screen (loadFreeSessionExercises below).
 */
export async function loadExercisesOfSessions(
  supabase: Supabase,
  sessionIds: string[],
  onlyIds?: string[],
): Promise<Map<string, SessionExerciseData[]>> {
  const bySession = new Map<string, SessionExerciseData[]>();
  if (sessionIds.length === 0) return bySession;

  const sessionExercises = (
    await selectInChunks(sessionIds, (chunk) => {
      let query = supabase
        .from("free_session_exercises")
        .select("id, session_id, exercise_id, order_index, rest_seconds, instructions, notes")
        .in("session_id", chunk);
      if (onlyIds) query = query.in("id", onlyIds.length ? onlyIds : NO_ROWS);
      return query;
    })
  ).sort((a, b) => a.order_index - b.order_index || (a.id < b.id ? -1 : 1));
  if (sessionExercises.length === 0) return bySession;

  const exerciseIds = [...new Set(sessionExercises.map((e) => e.exercise_id))];
  const [exercises, setRows] = await Promise.all([
    selectInChunks(exerciseIds, (chunk) =>
      supabase.from("exercises").select("id, name, muscle_group, instructions, video_url, video_storage_path").in("id", chunk),
    ),
    selectInChunks(
      sessionExercises.map((e) => e.id),
      (chunk) => supabase.from("free_session_sets").select(FREE_SET_COLUMNS).in("session_exercise_id", chunk),
    ),
  ]);

  const exerciseById = new Map(exercises.map((e) => [e.id, e]));
  const plannedById = new Map<string, PlannedSet[]>();
  const loggedById = new Map<string, LoggedSet[]>();
  for (const row of setRows) {
    const planned = freeSetToPlanned(row);
    if (planned) plannedById.set(row.session_exercise_id, [...(plannedById.get(row.session_exercise_id) ?? []), planned]);
    const logged = freeSetToLogged(row);
    if (logged) loggedById.set(row.session_exercise_id, [...(loggedById.get(row.session_exercise_id) ?? []), logged]);
  }

  for (const row of sessionExercises) {
    const exercise = exerciseById.get(row.exercise_id);
    const list = bySession.get(row.session_id) ?? [];
    list.push({
      id: row.id,
      exerciseId: row.exercise_id,
      name: exercise?.name ?? "תרגיל לא ידוע",
      muscleGroup: exercise?.muscle_group ?? null,
      videoUrl: exercise ? playableVideoUrl(exercise) : null,
      permanentNote: exercise?.instructions ?? null,
      instructions: row.instructions,
      restSeconds: row.rest_seconds,
      plannedSets: (plannedById.get(row.id) ?? []).sort((a, b) => a.setIndex - b.setIndex),
      loggedSets: (loggedById.get(row.id) ?? []).sort((a, b) => a.setIndex - b.setIndex),
      initialNote: row.notes,
      previous: null,
    });
    bySession.set(row.session_id, list);
  }
  return bySession;
}

/**
 * Every exercise of one session (or just `onlyIds`), in order, with its
 * targets, what was performed, and — when the session belongs to a trainee
 * — what they did last time on the same exercise.
 */
export async function loadFreeSessionExercises(
  supabase: Supabase,
  session: { id: string; trainee_id: string | null },
  onlyIds?: string[],
): Promise<SessionExerciseData[]> {
  const exercises = (await loadExercisesOfSessions(supabase, [session.id], onlyIds)).get(session.id) ?? [];
  if (!session.trainee_id || exercises.length === 0) return exercises;

  const previous = await getPreviousPerformance(
    supabase,
    session.trainee_id,
    exercises.map((e) => ({ key: e.id, exerciseId: e.exerciseId })),
  );
  return exercises.map((e) => ({ ...e, previous: previous.get(e.id) ?? null }));
}

export interface FreeSessionListItem {
  id: string;
  traineeId: string | null;
  guestLabel: string | null;
  templateId: string | null;
  startedAt: string;
  finishedAt: string | null;
  /** Exercises with at least one performed set. */
  exerciseCount: number;
  /** Performed sets. */
  setCount: number;
}

/**
 * The most recent free sessions (optionally one trainee's), newest first,
 * each with how much was actually performed in it. RLS decides what the
 * caller may see: the trainer and the read-only viewer everything, a
 * trainee only sessions assigned to them.
 */
export async function loadFreeSessionList(
  supabase: Supabase,
  options: { traineeId?: string; limit?: number } = {},
): Promise<FreeSessionListItem[]> {
  let query = supabase
    .from("free_sessions")
    .select("id, trainee_id, guest_label, template_id, started_at, finished_at");
  if (options.traineeId) query = query.eq("trainee_id", options.traineeId);
  const { data: sessions } = await query.order("started_at", { ascending: false }).limit(options.limit ?? 30);
  if (!sessions?.length) return [];

  const sessionExercises = await selectInChunks(
    sessions.map((s) => s.id),
    (chunk) => supabase.from("free_session_exercises").select("id, session_id").in("session_id", chunk),
  );
  const performed = await selectInChunks(
    sessionExercises.map((e) => e.id),
    (chunk) =>
      supabase
        .from("free_session_sets")
        .select("session_exercise_id")
        .in("session_exercise_id", chunk)
        .not("logged_at", "is", null),
  );

  const setsByExercise = new Map<string, number>();
  for (const row of performed) {
    setsByExercise.set(row.session_exercise_id, (setsByExercise.get(row.session_exercise_id) ?? 0) + 1);
  }
  const counts = new Map<string, { exercises: number; sets: number }>();
  for (const exercise of sessionExercises) {
    const sets = setsByExercise.get(exercise.id) ?? 0;
    if (sets === 0) continue;
    const current = counts.get(exercise.session_id) ?? { exercises: 0, sets: 0 };
    counts.set(exercise.session_id, { exercises: current.exercises + 1, sets: current.sets + sets });
  }

  return sessions.map((s) => ({
    id: s.id,
    traineeId: s.trainee_id,
    guestLabel: s.guest_label,
    templateId: s.template_id,
    startedAt: s.started_at,
    finishedAt: s.finished_at,
    exerciseCount: counts.get(s.id)?.exercises ?? 0,
    setCount: counts.get(s.id)?.sets ?? 0,
  }));
}
