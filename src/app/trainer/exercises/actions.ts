"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { parseVideoUrl } from "@/lib/video";

type Supabase = Awaited<ReturnType<typeof createClient>>;

const MAX_NOTE_LENGTH = 1000;

/** A multi-line text field as submitted by a form: browsers send line breaks as CRLF. */
function readNote(value: FormDataEntryValue | null): string | null {
  return String(value ?? "").replace(/\r\n?/g, "\n").trim() || null;
}

/**
 * An exercise's name, permanent note, image and video all show up outside
 * the library too — in every program builder and on the trainees' own
 * workout screens — so an edit has to invalidate those as well.
 */
function revalidateExerciseEverywhere() {
  revalidatePath("/trainer/exercises");
  revalidatePath("/trainer/trainees/[id]/programs/[programId]", "page");
  revalidatePath("/trainer/trainees/[id]", "page");
  revalidatePath("/trainee/workouts");
  revalidatePath("/trainee/history");
}

export interface CreateExerciseState {
  error?: string;
}

const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const ALLOWED_IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);

/**
 * Shared by createExercise, updateExerciseImage and createExerciseInline: an
 * uploaded file (stored in the "exercise-images" Storage bucket, migration
 * 0008). File upload only — pasting an external URL used to be allowed too,
 * but was removed so every exercise photo actually lives in our own bucket.
 * Returns null (clears the image) if no file was given.
 */
async function resolveMediaUrl(
  supabase: Supabase,
  exerciseId: string,
  formData: FormData,
): Promise<{ mediaUrl: string | null } | { error: string }> {
  const file = formData.get("image_file");

  if (file instanceof File && file.size > 0) {
    // An explicit allowlist rather than "image/*": SVG is an image type
    // too, and an SVG can carry script — harmless inside an <img>, but the
    // bucket is public, so the file is also reachable by direct link.
    if (!ALLOWED_IMAGE_TYPES.has(file.type)) {
      return { error: "יש להעלות תמונה מסוג JPG, PNG, WebP או GIF" };
    }
    if (file.size > MAX_IMAGE_BYTES) {
      return { error: "התמונה גדולה מדי (מקסימום 5MB)" };
    }

    const ext = file.name.split(".").pop()?.toLowerCase().replace(/[^a-z0-9]/g, "") || "jpg";
    const path = `${exerciseId}-${Date.now()}.${ext}`;

    // Wrapped in try/catch, not just checking the returned error: an
    // upload failure here (e.g. the "exercise-images" bucket from
    // migration 0008 missing entirely) has been seen to throw rather than
    // resolve to {error}, which — uncaught — surfaces as Next's generic
    // crash page instead of a message the trainer can act on.
    try {
      // RLS ("trainer manages exercise-images", migration 0008) restricts
      // this to role='trainer'.
      const { error: uploadError } = await supabase.storage
        .from("exercise-images")
        .upload(path, file, { upsert: true, contentType: file.type });

      if (uploadError) {
        console.error("resolveMediaUrl: storage upload failed", uploadError);
        return { error: "שגיאה בהעלאת התמונה" };
      }

      return { mediaUrl: supabase.storage.from("exercise-images").getPublicUrl(path).data.publicUrl };
    } catch (err) {
      console.error("resolveMediaUrl: unexpected upload error", err);
      return { error: "שגיאה בלתי צפויה בהעלאת התמונה. נסה שוב." };
    }
  }

  return { mediaUrl: null };
}

/**
 * The standalone /trainer/exercises/new page. Inserts first (with no
 * image — a new exercise never gets a guessed/default one, see
 * src/lib/exercise-image.ts), then resolves and applies an optional
 * image the same way createExerciseInline does, since resolveMediaUrl
 * needs the exercise's own id for the storage path.
 */
export async function createExercise(
  _prevState: CreateExerciseState,
  formData: FormData,
): Promise<CreateExerciseState> {
  const name = String(formData.get("name") ?? "").trim();
  const muscleGroup = String(formData.get("muscle_group") ?? "").trim() || null;
  const equipment = String(formData.get("equipment") ?? "").trim() || null;
  const instructions = readNote(formData.get("instructions"));

  if (!name) {
    return { error: "נא להזין שם תרגיל" };
  }
  if (instructions && instructions.length > MAX_NOTE_LENGTH) {
    return { error: `ההערה הקבועה ארוכה מדי (עד ${MAX_NOTE_LENGTH} תווים)` };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  // RLS ("trainer manages exercises") already restricts inserts to
  // role='trainer'; the trainee never reaches this action since it's only
  // wired up from /trainer/exercises/new.
  const { data: row, error } = await supabase
    .from("exercises")
    .insert({
      name,
      muscle_group: muscleGroup,
      equipment,
      instructions,
      is_custom: true,
      created_by: user.id,
      media_url: null,
    })
    .select("id")
    .single();

  if (error || !row) {
    return {
      error:
        error?.code === "23505"
          ? "כבר קיים תרגיל בשם הזה"
          : "שגיאה בהוספת התרגיל",
    };
  }

  const resolved = await resolveMediaUrl(supabase, row.id, formData);
  if ("mediaUrl" in resolved && resolved.mediaUrl) {
    await supabase.from("exercises").update({ media_url: resolved.mediaUrl }).eq("id", row.id);
  }
  // A failed image upload doesn't fail the whole exercise creation — the
  // exercise already exists with no image, exactly like not adding one at
  // all; resolveMediaUrl already logs the real reason server-side.

  revalidatePath("/trainer/exercises");
  redirect("/trainer/exercises");
}

export interface UpdateExerciseDetailsState {
  error?: string;
  success?: boolean;
}

/**
 * Name/muscle-group/equipment on an existing (catalog) exercise — edited
 * from the exercise-detail modal (exercise-detail-modal.tsx). This is
 * shared library data: changing it ripples through every program that
 * already references the exercise (they all point at the same row), which
 * is deliberate — a trainer fixing a typo or reclassifying an exercise
 * expects it to update everywhere, not fork per program.
 */
export async function updateExerciseDetails(
  exerciseId: string,
  _prevState: UpdateExerciseDetailsState,
  formData: FormData,
): Promise<UpdateExerciseDetailsState> {
  const name = String(formData.get("name") ?? "").trim();
  const muscleGroup = String(formData.get("muscle_group") ?? "").trim() || null;
  const equipment = String(formData.get("equipment") ?? "").trim() || null;
  // The permanent note (planning/PLAN.md feature 3): shown wherever this
  // exercise appears in a program.
  const instructions = readNote(formData.get("instructions"));

  if (!name) {
    return { error: "נא להזין שם תרגיל" };
  }
  if (instructions && instructions.length > MAX_NOTE_LENGTH) {
    return { error: `ההערה הקבועה ארוכה מדי (עד ${MAX_NOTE_LENGTH} תווים)` };
  }

  const supabase = await createClient();
  // RLS ("trainer manages exercises") restricts this to role='trainer'.
  const { error } = await supabase
    .from("exercises")
    .update({ name, muscle_group: muscleGroup, equipment, instructions })
    .eq("id", exerciseId);

  if (error) {
    return {
      error: error.code === "23505" ? "כבר קיים תרגיל בשם הזה" : "שגיאה בשמירת התרגיל",
    };
  }

  revalidateExerciseEverywhere();
  return { success: true };
}

export interface UpdateExerciseVideoState {
  error?: string;
  success?: boolean;
}

/**
 * Sets or clears an exercise's demo video link (migration 0015). An empty
 * field clears it. The link is validated by the same parser that later
 * builds the player (src/lib/video.ts), so nothing unplayable — or unsafe —
 * is ever stored.
 */
export async function updateExerciseVideo(
  exerciseId: string,
  _prevState: UpdateExerciseVideoState,
  formData: FormData,
): Promise<UpdateExerciseVideoState> {
  const raw = String(formData.get("video_url") ?? "").trim();

  let videoUrl: string | null = null;
  if (raw) {
    const parsed = parseVideoUrl(raw);
    if ("error" in parsed) return { error: parsed.error };
    videoUrl = raw;
  }

  const supabase = await createClient();
  // RLS ("trainer manages exercises") restricts this to role='trainer'.
  const { error } = await supabase
    .from("exercises")
    .update({ video_url: videoUrl })
    .eq("id", exerciseId);

  if (error) {
    return { error: "שגיאה בשמירת הסרטון" };
  }

  revalidateExerciseEverywhere();
  return { success: true };
}

export interface UpdateExerciseImageState {
  error?: string;
  success?: boolean;
}

/**
 * An existing (catalog) exercise's image: upload a file, or clear it
 * (empty FormData — no "image_file" — resolves to null, see
 * resolveMediaUrl). Called from the exercise-detail modal.
 */
export async function updateExerciseImage(
  exerciseId: string,
  _prevState: UpdateExerciseImageState,
  formData: FormData,
): Promise<UpdateExerciseImageState> {
  const supabase = await createClient();
  const resolved = await resolveMediaUrl(supabase, exerciseId, formData);
  if ("error" in resolved) return { error: resolved.error };

  // RLS ("trainer manages exercises") restricts this to role='trainer'.
  const { error } = await supabase
    .from("exercises")
    .update({ media_url: resolved.mediaUrl })
    .eq("id", exerciseId);

  if (error) {
    return { error: "שגיאה בשמירת התמונה" };
  }

  revalidateExerciseEverywhere();
  return { success: true };
}

export interface DeleteExerciseState {
  error?: string;
  success?: boolean;
}

/**
 * Deleting an exercise that's already used in some program fails on the
 * FK (`workout_exercises.exercise_id ... on delete restrict`, migration
 * 0001) — surfaced here as a friendly message instead of a raw DB error.
 */
export async function deleteExercise(exerciseId: string): Promise<DeleteExerciseState> {
  const supabase = await createClient();
  // RLS ("trainer manages exercises") restricts this to role='trainer'.
  const { error } = await supabase.from("exercises").delete().eq("id", exerciseId);

  if (error) {
    return {
      error:
        error.code === "23503"
          ? "אי אפשר למחוק תרגיל שנמצא בשימוש (בתוכנית, באימון אישי או באימון שמור)"
          : "שגיאה במחיקת התרגיל",
    };
  }

  revalidatePath("/trainer/exercises");
  return { success: true };
}

export interface CreateExerciseInlineState {
  error?: string;
  exercise?: {
    id: string;
    name: string;
    muscle_group: string | null;
    equipment: string | null;
    media_url: string | null;
    instructions: string | null;
  };
}

/**
 * Used by the program builder's exercise picker: creating a new exercise
 * without leaving the builder. Unlike createExercise (the standalone
 * /trainer/exercises/new page), this doesn't redirect — it returns the
 * created row so the picker can add it straight into the current workout.
 */
export async function createExerciseInline(
  _prevState: CreateExerciseInlineState,
  formData: FormData,
): Promise<CreateExerciseInlineState> {
  const name = String(formData.get("name") ?? "").trim();
  const muscleGroup = String(formData.get("muscle_group") ?? "").trim() || null;
  const equipment = String(formData.get("equipment") ?? "").trim() || null;
  const instructions = readNote(formData.get("instructions"));

  if (!name) {
    return { error: "נא להזין שם תרגיל" };
  }
  if (instructions && instructions.length > MAX_NOTE_LENGTH) {
    return { error: `ההערה הקבועה ארוכה מדי (עד ${MAX_NOTE_LENGTH} תווים)` };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "שגיאת התחברות" };

  const { data: row, error } = await supabase
    .from("exercises")
    .insert({
      name,
      muscle_group: muscleGroup,
      equipment,
      instructions,
      is_custom: true,
      created_by: user.id,
    })
    .select("id, name, muscle_group, equipment, instructions")
    .single();

  if (error || !row) {
    return {
      error:
        error?.code === "23505" ? "כבר קיים תרגיל בשם הזה" : "שגיאה בהוספת התרגיל",
    };
  }

  const resolved = await resolveMediaUrl(supabase, row.id, formData);
  const mediaUrl = "error" in resolved ? null : resolved.mediaUrl;
  if (mediaUrl) {
    await supabase.from("exercises").update({ media_url: mediaUrl }).eq("id", row.id);
  }

  revalidatePath("/trainer/exercises");
  return { exercise: { ...row, media_url: mediaUrl } };
}
