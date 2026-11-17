"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { SessionExerciseData } from "@/components/session/session-exercise-panel";
import { loadFreeSessionExercises } from "@/lib/free-session-data";
import { FREE_SET_COLUMNS, freeSetHasTarget, freeSetToLogged } from "@/lib/free-sessions";
import { NOT_TRAINER_ERROR, getTrainerContext } from "@/lib/require-trainer";
import {
  validateSetIndex,
  validateSetLogInput,
  type LogSetResult,
  type SetLogInput,
} from "@/lib/set-log-server";
import { isUuid } from "@/lib/utils";

/**
 * Free sessions (planning/PLAN.md features 5b and 5c): a trainer-led
 * session that isn't tied to anyone's weekly plan. Exercises are picked on
 * the fly (or copied from a saved workout when the session starts), every
 * set is saved the moment it's confirmed, and the session can be assigned
 * to a trainee — when it starts, when it ends, or any time later.
 *
 * Only the trainer writes any of this: RLS (migration 0016) is what
 * enforces it, getTrainerContext() is the readable early version.
 */

type Ctx = NonNullable<Awaited<ReturnType<typeof getTrainerContext>>>;

const NOT_FOUND_ERROR = "האימון לא נמצא";
const FINISHED_ERROR = "האימון הזה כבר הסתיים — פתחו אותו מחדש כדי לערוך";
const MAX_SESSION_EXERCISES = 40;
const MAX_LABEL_LENGTH = 80;

function revalidateFreeSession(sessionId: string | null, traineeIds: (string | null | undefined)[] = []) {
  revalidatePath("/trainer");
  revalidatePath("/trainer/session");
  revalidatePath("/trainer/session/templates");
  if (sessionId) revalidatePath(`/trainer/session/free/${sessionId}`);
  for (const traineeId of traineeIds) {
    if (traineeId) revalidatePath(`/trainer/trainees/${traineeId}`);
  }
  // An assigned session shows in the trainee's history and feeds "last time".
  revalidatePath("/trainee/history");
  revalidatePath("/trainee/workouts");
}

async function getSession(ctx: Ctx, sessionId: string) {
  if (!isUuid(sessionId)) return null;
  const { data } = await ctx.supabase
    .from("free_sessions")
    .select("id, trainee_id, guest_label, template_id, started_at, finished_at, notes")
    .eq("id", sessionId)
    .maybeSingle();
  return data;
}

async function getSessionForExercise(ctx: Ctx, sessionExerciseId: string) {
  if (!isUuid(sessionExerciseId)) return null;
  const { data: exercise } = await ctx.supabase
    .from("free_session_exercises")
    .select("id, session_id, exercise_id")
    .eq("id", sessionExerciseId)
    .maybeSingle();
  if (!exercise) return null;
  const session = await getSession(ctx, exercise.session_id);
  return session ? { session, exercise } : null;
}

async function isTrainee(ctx: Ctx, profileId: string): Promise<boolean> {
  if (!isUuid(profileId)) return false;
  const { data } = await ctx.supabase
    .from("profiles")
    .select("id, role, is_superadmin")
    .eq("id", profileId)
    .maybeSingle();
  return data?.role === "trainee" && !data.is_superadmin;
}

function cleanLabel(label: string | null | undefined): { label: string | null } | { error: string } {
  const text = (label ?? "").replace(/\s+/g, " ").trim();
  if (text.length > MAX_LABEL_LENGTH) return { error: `השם ארוך מדי (עד ${MAX_LABEL_LENGTH} תווים)` };
  return { label: text || null };
}

export interface StartFreeSessionInput {
  /** Start from a saved workout: its exercises and targets are copied in. */
  templateId?: string | null;
  /** Assign it to a trainee from the start (their "last time" is then shown). */
  traineeId?: string | null;
  guestLabel?: string | null;
}

/** Creates the session and opens it. Only returns when something went wrong. */
export async function startFreeSession(input: StartFreeSessionInput): Promise<{ error: string }> {
  const ctx = await getTrainerContext();
  if (!ctx) return { error: NOT_TRAINER_ERROR };

  const templateId = input.templateId || null;
  const traineeId = input.traineeId || null;
  if (templateId && !isUuid(templateId)) return { error: "האימון השמור לא נמצא" };
  if (traineeId && !(await isTrainee(ctx, traineeId))) return { error: "המתאמן לא נמצא" };
  const label = cleanLabel(input.guestLabel);
  if ("error" in label) return { error: label.error };

  const { data: sessionId, error } = await ctx.supabase.rpc("start_free_session", {
    p_template_id: templateId,
    p_trainee_id: traineeId,
    p_guest_label: label.label,
  });
  if (error || !sessionId) {
    return { error: error?.code === "P0002" ? "האימון השמור לא נמצא" : "שגיאה בפתיחת האימון" };
  }

  revalidateFreeSession(sessionId, [traineeId]);
  redirect(`/trainer/session/free/${sessionId}`);
}

export async function updateFreeSessionLabel(
  sessionId: string,
  guestLabel: string,
): Promise<{ error?: string; guestLabel?: string | null }> {
  const ctx = await getTrainerContext();
  if (!ctx) return { error: NOT_TRAINER_ERROR };
  const session = await getSession(ctx, sessionId);
  if (!session) return { error: NOT_FOUND_ERROR };
  const label = cleanLabel(guestLabel);
  if ("error" in label) return { error: label.error };

  const { error } = await ctx.supabase.from("free_sessions").update({ guest_label: label.label }).eq("id", sessionId);
  if (error) return { error: "שגיאה בשמירת השם" };
  revalidateFreeSession(sessionId, [session.trainee_id]);
  return { guestLabel: label.label };
}

// ---------------------------------------------------------------------------
// Exercises
// ---------------------------------------------------------------------------

export interface FreeExerciseResult {
  error?: string;
  exercise?: SessionExerciseData;
}

export async function addFreeSessionExercise(sessionId: string, exerciseId: string): Promise<FreeExerciseResult> {
  const ctx = await getTrainerContext();
  if (!ctx) return { error: NOT_TRAINER_ERROR };
  const session = await getSession(ctx, sessionId);
  if (!session) return { error: NOT_FOUND_ERROR };
  if (session.finished_at) return { error: FINISHED_ERROR };
  if (!isUuid(exerciseId)) return { error: "התרגיל לא נמצא" };

  const { data: existing } = await ctx.supabase
    .from("free_session_exercises")
    .select("order_index")
    .eq("session_id", sessionId);
  if ((existing?.length ?? 0) >= MAX_SESSION_EXERCISES) {
    return { error: `אפשר להוסיף עד ${MAX_SESSION_EXERCISES} תרגילים לאימון` };
  }
  const nextOrder = Math.max(-1, ...(existing ?? []).map((e) => e.order_index)) + 1;

  const { data: row, error } = await ctx.supabase
    .from("free_session_exercises")
    .insert({ session_id: sessionId, exercise_id: exerciseId, order_index: nextOrder })
    .select("id")
    .single();
  if (error || !row) return { error: error?.code === "23503" ? "התרגיל לא נמצא" : "שגיאה בהוספת התרגיל" };

  const [exercise] = await loadFreeSessionExercises(ctx.supabase, session, [row.id]);
  revalidateFreeSession(sessionId);
  return exercise ? { exercise } : { error: "שגיאה בהוספת התרגיל" };
}

/**
 * Swaps the exercise of a row for another one ("the machine is taken").
 * Only while nothing was performed on it: sets that were done belong to
 * the exercise they were done on. Targets copied from a saved workout are
 * dropped — a weight meant for one exercise says nothing about another.
 */
export async function replaceFreeSessionExercise(
  sessionExerciseId: string,
  newExerciseId: string,
): Promise<FreeExerciseResult> {
  const ctx = await getTrainerContext();
  if (!ctx) return { error: NOT_TRAINER_ERROR };
  const found = await getSessionForExercise(ctx, sessionExerciseId);
  if (!found) return { error: NOT_FOUND_ERROR };
  if (found.session.finished_at) return { error: FINISHED_ERROR };
  if (!isUuid(newExerciseId)) return { error: "התרגיל לא נמצא" };

  const { count } = await ctx.supabase
    .from("free_session_sets")
    .select("id", { count: "exact", head: true })
    .eq("session_exercise_id", sessionExerciseId)
    .not("logged_at", "is", null);
  if (count) return { error: "כבר נרשמו סטים בתרגיל הזה — הוסיפו תרגיל חדש במקום להחליף" };

  const { error } = await ctx.supabase
    .from("free_session_exercises")
    .update({ exercise_id: newExerciseId, instructions: null, rest_seconds: null, notes: null })
    .eq("id", sessionExerciseId);
  if (error) return { error: error.code === "23503" ? "התרגיל לא נמצא" : "שגיאה בהחלפת התרגיל" };
  await ctx.supabase.from("free_session_sets").delete().eq("session_exercise_id", sessionExerciseId);

  const [exercise] = await loadFreeSessionExercises(ctx.supabase, found.session, [sessionExerciseId]);
  revalidateFreeSession(found.session.id);
  return exercise ? { exercise } : { error: "שגיאה בהחלפת התרגיל" };
}

/**
 * Removes an exercise from the session. If sets were already performed on
 * it they go with it, so that has to be asked for explicitly
 * (`discardLoggedSets`) — the screen confirms with the trainer first.
 */
export async function removeFreeSessionExercise(
  sessionExerciseId: string,
  options: { discardLoggedSets?: boolean } = {},
): Promise<{ error?: string }> {
  const ctx = await getTrainerContext();
  if (!ctx) return { error: NOT_TRAINER_ERROR };
  const found = await getSessionForExercise(ctx, sessionExerciseId);
  if (!found) return {};
  if (found.session.finished_at) return { error: FINISHED_ERROR };

  if (!options.discardLoggedSets) {
    const { count } = await ctx.supabase
      .from("free_session_sets")
      .select("id", { count: "exact", head: true })
      .eq("session_exercise_id", sessionExerciseId)
      .not("logged_at", "is", null);
    if (count) return { error: "בתרגיל הזה כבר נרשמו סטים" };
  }

  const { error } = await ctx.supabase.from("free_session_exercises").delete().eq("id", sessionExerciseId);
  if (error) return { error: "שגיאה בהסרת התרגיל" };
  revalidateFreeSession(found.session.id, [found.session.trainee_id]);
  return {};
}

// ---------------------------------------------------------------------------
// Sets
// ---------------------------------------------------------------------------

/** One performed set. Confirming it again after fixing a number updates it in place. */
export async function logFreeSet(
  sessionExerciseId: string,
  setIndex: number,
  input: SetLogInput,
): Promise<LogSetResult> {
  const validationError = validateSetIndex(setIndex) ?? validateSetLogInput(input);
  if (validationError) return { error: validationError };

  const ctx = await getTrainerContext();
  if (!ctx) return { error: NOT_TRAINER_ERROR };
  const found = await getSessionForExercise(ctx, sessionExerciseId);
  if (!found) return { error: "התרגיל הוסר מהאימון — רעננו את הדף" };
  if (found.session.finished_at) return { error: FINISHED_ERROR };

  // Only the performed columns are sent, so a target copied from a saved
  // workout (same row) is left exactly as it was.
  const { data: row, error } = await ctx.supabase
    .from("free_session_sets")
    .upsert(
      {
        session_exercise_id: sessionExerciseId,
        set_index: setIndex,
        weight_kg: input.weightKg,
        reps: input.reps,
        rpe: input.rpe,
        logged_at: new Date().toISOString(),
      },
      { onConflict: "session_exercise_id,set_index" },
    )
    .select(FREE_SET_COLUMNS)
    .single();
  if (error || !row) {
    return { error: error?.code === "23503" ? "התרגיל הוסר מהאימון — רעננו את הדף" : "שגיאה בשמירת הסט" };
  }

  const log = freeSetToLogged(row);
  if (!log) return { error: "שגיאה בשמירת הסט" };
  // No revalidatePath here on purpose — see syncAfterEdits (src/app/sync-actions.ts).
  return { log };
}

/** Un-confirms a set: a row that carries a target keeps it, any other row is removed. */
export async function unlogFreeSet(sessionExerciseId: string, setIndex: number): Promise<{ error?: string }> {
  const ctx = await getTrainerContext();
  if (!ctx) return { error: NOT_TRAINER_ERROR };
  const found = await getSessionForExercise(ctx, sessionExerciseId);
  if (!found) return {};
  if (found.session.finished_at) return { error: FINISHED_ERROR };

  const { data: row } = await ctx.supabase
    .from("free_session_sets")
    .select("id, target_reps_min, target_reps_note")
    .eq("session_exercise_id", sessionExerciseId)
    .eq("set_index", setIndex)
    .maybeSingle();
  if (!row) return {};

  const { error } = freeSetHasTarget(row)
    ? await ctx.supabase
        .from("free_session_sets")
        .update({ weight_kg: null, reps: null, rpe: null, logged_at: null })
        .eq("id", row.id)
    : await ctx.supabase.from("free_session_sets").delete().eq("id", row.id);
  if (error) return { error: "שגיאה בביטול הסט" };

  // No revalidatePath here on purpose — see syncAfterEdits (src/app/sync-actions.ts).
  return {};
}

// ---------------------------------------------------------------------------
// Finishing, assigning, saving as a template
// ---------------------------------------------------------------------------

async function performedSetCount(ctx: Ctx, sessionId: string): Promise<number> {
  const { data: exercises } = await ctx.supabase
    .from("free_session_exercises")
    .select("id")
    .eq("session_id", sessionId);
  const ids = (exercises ?? []).map((e) => e.id);
  if (ids.length === 0) return 0;
  const { count } = await ctx.supabase
    .from("free_session_sets")
    .select("id", { count: "exact", head: true })
    .in("session_exercise_id", ids)
    .not("logged_at", "is", null);
  return count ?? 0;
}

export interface FinishFreeSessionInput {
  /** Per-exercise notes typed during the session. */
  notes: { sessionExerciseId: string; notes: string | null }[];
  generalNote: string | null;
  /** Who it belongs to from now on: a trainee, or null for nobody. Omitted = unchanged. */
  traineeId?: string | null;
  /** Also keep what was performed as a new saved workout with this title. */
  saveAsTemplateTitle?: string | null;
  /** Also update the saved workout this session was started from. */
  updateTemplate?: boolean;
}

export interface FinishFreeSessionResult {
  error?: string;
  finished?: boolean;
  /** The session is saved, but the saved-workout step failed (it can be retried from the summary). */
  templateFailed?: boolean;
}

/**
 * Ends the session: notes, who it belongs to, and optionally a saved
 * workout made from it. A session in which nothing was performed isn't
 * kept — there is nothing to remember about it — and the trainer is sent
 * back to the session picker (a redirect, so this page never re-renders
 * for a session that no longer exists).
 */
export async function finishFreeSession(
  sessionId: string,
  input: FinishFreeSessionInput,
): Promise<FinishFreeSessionResult> {
  const ctx = await getTrainerContext();
  if (!ctx) return { error: NOT_TRAINER_ERROR };
  const session = await getSession(ctx, sessionId);
  if (!session) return { error: NOT_FOUND_ERROR };

  const generalNote = input.generalNote?.trim() || null;
  if (generalNote && generalNote.length > 2000) return { error: "ההערה הכללית ארוכה מדי" };
  for (const entry of input.notes ?? []) {
    if (entry.notes && entry.notes.length > 1000) return { error: "ההערה ארוכה מדי" };
  }
  const templateTitle = input.saveAsTemplateTitle?.trim() || null;
  if (templateTitle && templateTitle.length > 120) return { error: "שם האימון השמור ארוך מדי" };

  const assign = input.traineeId !== undefined;
  const traineeId = input.traineeId || null;
  if (assign && traineeId && !(await isTrainee(ctx, traineeId))) return { error: "המתאמן לא נמצא" };

  if ((await performedSetCount(ctx, sessionId)) === 0) {
    const { error } = await ctx.supabase.from("free_sessions").delete().eq("id", sessionId);
    if (error) return { error: "שגיאה בסגירת האימון" };
    revalidateFreeSession(null, [session.trainee_id]);
    redirect("/trainer/session");
  }

  // Notes only ever land on this session's own exercises.
  const { data: ownExercises } = await ctx.supabase
    .from("free_session_exercises")
    .select("id")
    .eq("session_id", sessionId);
  const ownIds = new Set((ownExercises ?? []).map((e) => e.id));
  for (const entry of input.notes ?? []) {
    if (!ownIds.has(entry.sessionExerciseId)) continue;
    const { error } = await ctx.supabase
      .from("free_session_exercises")
      .update({ notes: entry.notes?.trim() || null })
      .eq("id", entry.sessionExerciseId);
    if (error) return { error: "שגיאה בשמירת ההערות" };
  }

  const { error } = await ctx.supabase
    .from("free_sessions")
    .update({
      finished_at: session.finished_at ?? new Date().toISOString(),
      notes: generalNote,
      ...(assign ? { trainee_id: traineeId } : {}),
    })
    .eq("id", sessionId);
  if (error) return { error: "שגיאה בסיום האימון" };

  // The session itself is safely finished by now; a failure here is
  // reported, not rolled back, and can be retried from the summary.
  let templateFailed = false;
  if (templateTitle) {
    const { error: rpcError } = await ctx.supabase.rpc("save_session_as_template", {
      p_session_id: sessionId,
      p_title: templateTitle,
    });
    templateFailed = Boolean(rpcError);
  } else if (input.updateTemplate && session.template_id) {
    const { error: rpcError } = await ctx.supabase.rpc("save_session_as_template", {
      p_session_id: sessionId,
      p_template_id: session.template_id,
    });
    templateFailed = Boolean(rpcError);
  }

  revalidateFreeSession(sessionId, [session.trainee_id, assign ? traineeId : null]);
  if (session.template_id) revalidatePath(`/trainer/session/templates/${session.template_id}`);
  return { finished: true, templateFailed };
}

/** Back to the live screen, to fix or add something. */
export async function reopenFreeSession(sessionId: string): Promise<{ error?: string }> {
  const ctx = await getTrainerContext();
  if (!ctx) return { error: NOT_TRAINER_ERROR };
  const session = await getSession(ctx, sessionId);
  if (!session) return { error: NOT_FOUND_ERROR };
  const { error } = await ctx.supabase.from("free_sessions").update({ finished_at: null }).eq("id", sessionId);
  if (error) return { error: "שגיאה בפתיחת האימון" };
  revalidateFreeSession(sessionId, [session.trainee_id]);
  return {};
}

/** Assign the session to a trainee, move it to another one, or (null) unassign it. Nothing else changes. */
export async function assignFreeSession(sessionId: string, traineeId: string | null): Promise<{ error?: string }> {
  const ctx = await getTrainerContext();
  if (!ctx) return { error: NOT_TRAINER_ERROR };
  const session = await getSession(ctx, sessionId);
  if (!session) return { error: NOT_FOUND_ERROR };
  const target = traineeId || null;
  if (target && !(await isTrainee(ctx, target))) return { error: "המתאמן לא נמצא" };

  const { error } = await ctx.supabase.from("free_sessions").update({ trainee_id: target }).eq("id", sessionId);
  if (error) return { error: "שגיאה בשיוך האימון" };
  revalidateFreeSession(sessionId, [session.trainee_id, target]);
  return {};
}

/**
 * Deletes the session for good (an assigned one leaves the trainee's
 * history with it), then goes back to where it was listed. Only returns
 * when something went wrong.
 */
export async function deleteFreeSession(sessionId: string): Promise<{ error: string }> {
  const ctx = await getTrainerContext();
  if (!ctx) return { error: NOT_TRAINER_ERROR };
  const session = await getSession(ctx, sessionId);
  if (session) {
    const { error } = await ctx.supabase.from("free_sessions").delete().eq("id", sessionId);
    if (error) return { error: "שגיאה במחיקת האימון" };
    revalidateFreeSession(null, [session.trainee_id]);
  }
  redirect(session?.trainee_id ? `/trainer/trainees/${session.trainee_id}` : "/trainer/session");
}

/**
 * From the summary of a finished session: keep what was performed as a new
 * saved workout (`title`), or update the saved workout it was started from.
 */
export async function saveFreeSessionAsTemplate(
  sessionId: string,
  options: { title?: string; updateExisting?: boolean },
): Promise<{ error?: string; templateId?: string }> {
  const ctx = await getTrainerContext();
  if (!ctx) return { error: NOT_TRAINER_ERROR };
  const session = await getSession(ctx, sessionId);
  if (!session) return { error: NOT_FOUND_ERROR };

  const title = options.title?.trim() ?? "";
  if (options.updateExisting) {
    if (!session.template_id) return { error: "האימון הזה לא נפתח מאימון שמור" };
  } else if (!title) {
    return { error: "יש לתת שם לאימון השמור" };
  } else if (title.length > 120) {
    return { error: "שם האימון השמור ארוך מדי" };
  }

  const { data: templateId, error } = await ctx.supabase.rpc("save_session_as_template", {
    p_session_id: sessionId,
    p_title: options.updateExisting ? null : title,
    p_template_id: options.updateExisting ? session.template_id : null,
  });
  if (error || !templateId) {
    if (error?.code === "P0002") return { error: "האימון השמור כבר לא קיים" };
    if (error?.code === "P0001") return { error: "לא בוצע אף סט באימון הזה" };
    return { error: "שגיאה בשמירת האימון השמור" };
  }
  revalidateFreeSession(sessionId);
  revalidatePath(`/trainer/session/templates/${templateId}`);
  return { templateId };
}
