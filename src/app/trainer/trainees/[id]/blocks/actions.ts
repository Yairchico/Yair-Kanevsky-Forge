"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import {
  DEFAULT_DELOAD_PCT,
  MAX_BLOCK_WEEKS,
  MAX_DELOAD_PCT,
  MIN_DELOAD_PCT,
  blockErrorMessage,
} from "@/lib/blocks";
import { NOT_TRAINER_ERROR, getTrainerContext } from "@/lib/require-trainer";
import { isUuid } from "@/lib/utils";

/**
 * Training blocks (planning/PLAN.md feature 2), the trainer's side. Every
 * multi-row operation is one database function (migration 0017) — a
 * single transaction with its own caller check — so these actions are
 * thin: validate what was typed, call, turn a refusal into a readable
 * message, revalidate. getTrainerContext() is the readable early version
 * of the functions' own "only the trainer" check.
 */

export interface BlockActionState {
  error?: string;
  /** Weeks that already have a program — confirm replacing them and submit again. */
  conflicts?: string[];
}

function revalidateBlockPages(traineeId: string, blockId?: string) {
  revalidatePath(`/trainer/trainees/${traineeId}`);
  revalidatePath("/trainer/trainees/[id]/programs/[programId]", "page");
  revalidatePath("/trainer/session");
  revalidatePath("/trainer");
  if (blockId) revalidatePath(`/trainer/trainees/${traineeId}/blocks/${blockId}`);
  // The trainee sees the block's published weeks.
  revalidatePath("/trainee");
  revalidatePath("/trainee/workouts");
}

const DATE_KEY = /^\d{4}-\d{2}-\d{2}$/;

function parseBlockForm(formData: FormData):
  | {
      title: string;
      weeksCount: number;
      deloadWeeks: number[];
      deloadPct: number;
      usePerformed: boolean;
      replaceExisting: boolean;
    }
  | { error: string } {
  const title = String(formData.get("title") ?? "").replace(/\s+/g, " ").trim();
  if (!title) return { error: "יש לתת שם לבלוק" };
  if (title.length > 120) return { error: "שם הבלוק ארוך מדי (עד 120 תווים)" };

  const weeksCount = Number(formData.get("weeks_count"));
  if (!Number.isInteger(weeksCount) || weeksCount < 1 || weeksCount > MAX_BLOCK_WEEKS) {
    return { error: `בלוק הוא בין שבוע אחד ל-${MAX_BLOCK_WEEKS} שבועות` };
  }

  const deloadWeeks = [...new Set(formData.getAll("deload_weeks").map((v) => Number(v)))];
  if (deloadWeeks.some((w) => !Number.isInteger(w) || w < 2 || w > weeksCount)) {
    return { error: "שבוע דילואד יכול להיות מהשבוע השני והלאה" };
  }

  const deloadPct = Number(formData.get("deload_pct") ?? DEFAULT_DELOAD_PCT);
  if (!Number.isInteger(deloadPct) || deloadPct < MIN_DELOAD_PCT || deloadPct > MAX_DELOAD_PCT) {
    return { error: `אחוז הדילואד הוא בין ${MIN_DELOAD_PCT} ל-${MAX_DELOAD_PCT}` };
  }

  return {
    title,
    weeksCount,
    deloadWeeks: deloadWeeks.sort((a, b) => a - b),
    deloadPct,
    usePerformed: formData.get("use_performed") === "1",
    replaceExisting: formData.get("replace_existing") === "1",
  };
}

/**
 * "בלוק חדש": the block and one draft program per week. Week 1 is empty, or
 * a copy of an existing program of the trainee. Weeks that already have a
 * program come back as `conflicts` first; only a second submit that carries
 * replace_existing replaces them — and never a week with recorded
 * performance. On success: on to the block's page.
 */
export async function createBlock(
  traineeId: string,
  _prevState: BlockActionState,
  formData: FormData,
): Promise<BlockActionState> {
  const ctx = await getTrainerContext();
  if (!ctx) return { error: NOT_TRAINER_ERROR };
  if (!isUuid(traineeId)) return { error: "המתאמן לא נמצא" };

  const parsed = parseBlockForm(formData);
  if ("error" in parsed) return { error: parsed.error };

  const startWeek = String(formData.get("start_week") ?? "");
  if (!DATE_KEY.test(startWeek)) return { error: "יש לבחור שבוע התחלה" };
  const sourceProgramId = String(formData.get("source_program_id") ?? "") || null;
  if (sourceProgramId && !isUuid(sourceProgramId)) return { error: "התוכנית להעתקה לא נמצאה" };

  if (!parsed.replaceExisting) {
    const [y, m, d] = startWeek.split("-").map(Number);
    const weekKeys = Array.from({ length: parsed.weeksCount }, (_, i) => {
      const date = new Date(Date.UTC(y, m - 1, d + 7 * i));
      return date.toISOString().slice(0, 10);
    });
    const { data: taken } = await ctx.supabase
      .from("programs")
      .select("week_start_date")
      .eq("trainee_id", traineeId)
      .is("deleted_at", null)
      .in("week_start_date", weekKeys);
    if (taken?.length) {
      return { conflicts: taken.map((p) => p.week_start_date).sort() };
    }
  }

  const { data: blockId, error } = await ctx.supabase.rpc("create_block", {
    p_trainee_id: traineeId,
    p_title: parsed.title,
    p_start_week: startWeek,
    p_weeks_count: parsed.weeksCount,
    p_deload_weeks: parsed.deloadWeeks,
    p_deload_pct: parsed.deloadPct,
    p_source_program_id: sourceProgramId,
    p_use_performed: false,
    p_replace_existing: parsed.replaceExisting,
    p_auto_publish: formData.get("auto_publish") === "1",
  });
  if (error || !blockId) return { error: blockErrorMessage(error, "שגיאה ביצירת הבלוק") };

  revalidateBlockPages(traineeId, blockId);
  redirect(`/trainer/trainees/${traineeId}/blocks/${blockId}`);
}

/** "התחל בלוק חדש" from a block's page: week 1 = that block's last regular week (targets, or the weights lifted). */
export async function startNextBlock(
  traineeId: string,
  blockId: string,
  _prevState: BlockActionState,
  formData: FormData,
): Promise<BlockActionState> {
  const ctx = await getTrainerContext();
  if (!ctx) return { error: NOT_TRAINER_ERROR };
  if (!isUuid(blockId)) return { error: "הבלוק לא נמצא" };

  const parsed = parseBlockForm(formData);
  if ("error" in parsed) return { error: parsed.error };

  const { data: newBlockId, error } = await ctx.supabase.rpc("start_next_block", {
    p_block_id: blockId,
    p_title: parsed.title,
    p_weeks_count: parsed.weeksCount,
    p_deload_weeks: parsed.deloadWeeks,
    p_deload_pct: parsed.deloadPct,
    p_use_performed: parsed.usePerformed,
    p_replace_existing: parsed.replaceExisting,
  });
  if (error || !newBlockId) {
    if (error?.code === "BK001" && !parsed.replaceExisting) {
      const match = /(\d{4}-\d{2}-\d{2})/.exec(error.message ?? "");
      return { conflicts: match ? [match[1]] : [] };
    }
    return { error: blockErrorMessage(error, "שגיאה ביצירת הבלוק") };
  }

  revalidateBlockPages(traineeId, blockId);
  revalidateBlockPages(traineeId, newBlockId);
  redirect(`/trainer/trainees/${traineeId}/blocks/${newBlockId}`);
}

export interface ApplyStructureResult {
  error?: string;
  /** Block week numbers that were rebuilt from this week. */
  updated?: number[];
  /** Block week numbers left alone because the trainee already started them. */
  frozen?: number[];
}

/** "החל על השבועות הבאים": the later weeks of the block get this week's workouts, exercises and sets. */
export async function applyBlockStructure(traineeId: string, programId: string): Promise<ApplyStructureResult> {
  const ctx = await getTrainerContext();
  if (!ctx) return { error: NOT_TRAINER_ERROR };
  if (!isUuid(programId)) return { error: "התוכנית לא נמצאה" };

  const { data, error } = await ctx.supabase.rpc("apply_block_structure", { p_program_id: programId });
  if (error || !data) return { error: blockErrorMessage(error, "שגיאה בעדכון השבועות הבאים") };

  const { data: program } = await ctx.supabase.from("programs").select("block_id").eq("id", programId).maybeSingle();
  revalidateBlockPages(traineeId, program?.block_id ?? undefined);
  return { updated: data.updated ?? [], frozen: data.frozen ?? [] };
}

type BlockResult = { error?: string };

/** Runs one block function and turns its outcome into the usual `{ error? }`. */
async function runBlockAction(
  traineeId: string,
  blockId: string,
  fallback: string,
  call: (ctx: NonNullable<Awaited<ReturnType<typeof getTrainerContext>>>) => PromiseLike<{
    error: { code?: string; message?: string } | null;
  }>,
): Promise<BlockResult> {
  const ctx = await getTrainerContext();
  if (!ctx) return { error: NOT_TRAINER_ERROR };
  if (!isUuid(blockId)) return { error: "הבלוק לא נמצא" };
  const { error } = await call(ctx);
  if (error) return { error: blockErrorMessage(error, fallback) };
  revalidateBlockPages(traineeId, blockId);
  return {};
}

/** "חשב מחדש": re-derive every week's targets from the week before it and what was actually done. */
export async function recomputeBlock(traineeId: string, blockId: string): Promise<BlockResult> {
  return runBlockAction(traineeId, blockId, "שגיאה בחישוב מחדש", (ctx) =>
    ctx.supabase.rpc("recompute_block", { p_block_id: blockId, p_from_index: 2 }),
  );
}

/** "דחה בשבוע": the trainee missed a whole week — this week and the ones after it move a week later. */
export async function shiftBlock(traineeId: string, blockId: string, fromIndex: number): Promise<BlockResult> {
  if (!Number.isInteger(fromIndex) || fromIndex < 1 || fromIndex > MAX_BLOCK_WEEKS) return { error: "שבוע לא תקין" };
  return runBlockAction(traineeId, blockId, "שגיאה בדחיית הבלוק", (ctx) =>
    ctx.supabase.rpc("shift_block", { p_block_id: blockId, p_from_index: fromIndex }),
  );
}

/** "הוסף דילואד אחרי שבוע N": a new deload week; the weeks after it move a week later. */
export async function insertBlockDeload(
  traineeId: string,
  blockId: string,
  afterIndex: number,
  deloadPct: number | null,
): Promise<BlockResult> {
  if (!Number.isInteger(afterIndex) || afterIndex < 1 || afterIndex > MAX_BLOCK_WEEKS) return { error: "שבוע לא תקין" };
  if (deloadPct != null && (!Number.isInteger(deloadPct) || deloadPct < MIN_DELOAD_PCT || deloadPct > MAX_DELOAD_PCT)) {
    return { error: `אחוז הדילואד הוא בין ${MIN_DELOAD_PCT} ל-${MAX_DELOAD_PCT}` };
  }
  return runBlockAction(traineeId, blockId, "שגיאה בהוספת שבוע דילואד", (ctx) =>
    ctx.supabase.rpc("insert_block_deload", {
      p_block_id: blockId,
      p_after_index: afterIndex,
      p_deload_pct: deloadPct,
    }),
  );
}

/** Turns one existing block week into a deload week, or back into a regular one. */
export async function setBlockWeekDeload(
  traineeId: string,
  blockId: string,
  programId: string,
  isDeload: boolean,
  deloadPct: number | null,
): Promise<BlockResult> {
  if (!isUuid(programId)) return { error: "השבוע לא נמצא" };
  if (deloadPct != null && (!Number.isInteger(deloadPct) || deloadPct < MIN_DELOAD_PCT || deloadPct > MAX_DELOAD_PCT)) {
    return { error: `אחוז הדילואד הוא בין ${MIN_DELOAD_PCT} ל-${MAX_DELOAD_PCT}` };
  }
  return runBlockAction(traineeId, blockId, "שגיאה בעדכון השבוע", (ctx) =>
    ctx.supabase.rpc("set_block_week_deload", {
      p_program_id: programId,
      p_is_deload: isDeload,
      p_deload_pct: isDeload ? deloadPct : null,
    }),
  );
}

/** Publishes (or un-publishes) one week of the block. The week must have something in it to publish. */
export async function setBlockWeekPublished(
  traineeId: string,
  blockId: string,
  programId: string,
  published: boolean,
): Promise<BlockResult> {
  const ctx = await getTrainerContext();
  if (!ctx) return { error: NOT_TRAINER_ERROR };
  if (!isUuid(programId) || !isUuid(blockId)) return { error: "השבוע לא נמצא" };

  if (published) {
    const { data: workouts } = await ctx.supabase.from("workouts").select("id").eq("program_id", programId);
    const ids = (workouts ?? []).map((w) => w.id);
    const { count } = ids.length
      ? await ctx.supabase
          .from("workout_exercises")
          .select("id", { count: "exact", head: true })
          .in("workout_id", ids)
      : { count: 0 };
    if (!count) return { error: "אין תרגילים בשבוע הזה — אין מה לפרסם" };
  }

  const { error } = await ctx.supabase
    .from("programs")
    .update({
      status: published ? "published" : "draft",
      published_at: published ? new Date().toISOString() : null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", programId)
    .eq("block_id", blockId)
    .is("deleted_at", null);
  if (error) return { error: "שגיאה בעדכון הפרסום" };

  revalidateBlockPages(traineeId, blockId);
  return {};
}

/** The block's own settings: its name (also the name of its weekly programs), automatic publishing, the default deload. */
export async function updateBlockSettings(
  traineeId: string,
  blockId: string,
  settings: { title: string; autoPublish: boolean; defaultDeloadPct: number },
): Promise<BlockResult> {
  const ctx = await getTrainerContext();
  if (!ctx) return { error: NOT_TRAINER_ERROR };
  if (!isUuid(blockId)) return { error: "הבלוק לא נמצא" };

  const title = (settings.title ?? "").replace(/\s+/g, " ").trim();
  if (!title) return { error: "יש לתת שם לבלוק" };
  if (title.length > 120) return { error: "שם הבלוק ארוך מדי (עד 120 תווים)" };
  const pct = settings.defaultDeloadPct;
  if (!Number.isInteger(pct) || pct < MIN_DELOAD_PCT || pct > MAX_DELOAD_PCT) {
    return { error: `אחוז הדילואד הוא בין ${MIN_DELOAD_PCT} ל-${MAX_DELOAD_PCT}` };
  }

  const { data: before } = await ctx.supabase
    .from("blocks")
    .select("auto_publish_next_week, default_deload_pct")
    .eq("id", blockId)
    .is("deleted_at", null)
    .maybeSingle();
  if (!before) return { error: "הבלוק לא נמצא" };

  const { error } = await ctx.supabase
    .from("blocks")
    .update({
      title,
      auto_publish_next_week: settings.autoPublish,
      default_deload_pct: pct,
      // Turning automatic publishing on takes effect at the next weekly
      // maintenance; clearing this makes that happen on the next visit.
      ...(settings.autoPublish && !before.auto_publish_next_week ? { rolled_through: null } : {}),
    })
    .eq("id", blockId);
  if (error) return { error: "שגיאה בשמירת ההגדרות" };

  await ctx.supabase.from("programs").update({ title }).eq("block_id", blockId).is("deleted_at", null);
  if (before.default_deload_pct !== pct) {
    await ctx.supabase.rpc("recompute_block", { p_block_id: blockId, p_from_index: 2 });
  }

  revalidateBlockPages(traineeId, blockId);
  return {};
}

/** "סיים בלוק": no more automatic progression; optionally the weeks that haven't begun are removed. */
export async function endBlock(traineeId: string, blockId: string, removeFuture: boolean): Promise<BlockResult> {
  return runBlockAction(traineeId, blockId, "שגיאה בסיום הבלוק", (ctx) =>
    ctx.supabase.rpc("end_block", { p_block_id: blockId, p_remove_future: removeFuture }),
  );
}

/**
 * Deletes the block. Weeks nobody trained in go with it; a week with
 * recorded performance stays as an ordinary weekly program. Then back to
 * the trainee's page (a redirect: this block's page no longer exists).
 * Only returns when something went wrong.
 */
export async function deleteBlock(traineeId: string, blockId: string): Promise<{ error: string }> {
  const result = await runBlockAction(traineeId, blockId, "שגיאה במחיקת הבלוק", (ctx) =>
    ctx.supabase.rpc("delete_block", { p_block_id: blockId }),
  );
  if (result.error) return { error: result.error };
  redirect(`/trainer/trainees/${traineeId}`);
}
