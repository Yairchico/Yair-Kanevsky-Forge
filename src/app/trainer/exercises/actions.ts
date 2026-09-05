"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export interface CreateExerciseState {
  error?: string;
}

export async function createExercise(
  _prevState: CreateExerciseState,
  formData: FormData,
): Promise<CreateExerciseState> {
  const name = String(formData.get("name") ?? "").trim();
  const muscleGroup = String(formData.get("muscle_group") ?? "").trim() || null;
  const equipment = String(formData.get("equipment") ?? "").trim() || null;
  const instructions = String(formData.get("instructions") ?? "").trim() || null;

  if (!name) {
    return { error: "נא להזין שם תרגיל" };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  // RLS ("trainer manages exercises") already restricts inserts to
  // role='trainer'; the trainee never reaches this action since it's only
  // wired up from /trainer/exercises/new.
  const { error } = await supabase.from("exercises").insert({
    name,
    muscle_group: muscleGroup,
    equipment,
    instructions,
    is_custom: true,
    created_by: user.id,
  });

  if (error) {
    return {
      error:
        error.code === "23505"
          ? "כבר קיים תרגיל בשם הזה"
          : "שגיאה בהוספת התרגיל",
    };
  }

  revalidatePath("/trainer/exercises");
  redirect("/trainer/exercises");
}

export interface UpdateExerciseImageState {
  error?: string;
  success?: boolean;
}

const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

/**
 * The only editable field on an existing (catalog) exercise: its image.
 * Everything else about a base exercise is shared library data — changing
 * a name/muscle-group here would ripple through every program that already
 * references it, which isn't what "edit" is meant to do.
 *
 * Accepts either an uploaded file (stored in the "exercise-images" Storage
 * bucket, migration 0008) or a pasted external URL — an uploaded file wins
 * if both are given. Clearing both falls back to the guessed default photo
 * (see src/lib/exercise-image.ts).
 */
export async function updateExerciseImage(
  exerciseId: string,
  _prevState: UpdateExerciseImageState,
  formData: FormData,
): Promise<UpdateExerciseImageState> {
  const urlInput = String(formData.get("media_url") ?? "").trim();
  const file = formData.get("image_file");

  const supabase = await createClient();
  let mediaUrl: string | null = urlInput || null;

  if (file instanceof File && file.size > 0) {
    if (!file.type.startsWith("image/")) {
      return { error: "יש להעלות קובץ תמונה" };
    }
    if (file.size > MAX_IMAGE_BYTES) {
      return { error: "התמונה גדולה מדי (מקסימום 5MB)" };
    }

    const ext = file.name.split(".").pop()?.toLowerCase().replace(/[^a-z0-9]/g, "") || "jpg";
    const path = `${exerciseId}-${Date.now()}.${ext}`;

    // RLS ("trainer manages exercise-images", migration 0008) restricts
    // this to role='trainer'.
    const { error: uploadError } = await supabase.storage
      .from("exercise-images")
      .upload(path, file, { upsert: true, contentType: file.type });

    if (uploadError) {
      console.error("updateExerciseImage: storage upload failed", uploadError);
      return { error: "שגיאה בהעלאת התמונה" };
    }

    mediaUrl = supabase.storage.from("exercise-images").getPublicUrl(path).data.publicUrl;
  }

  // RLS ("trainer manages exercises") restricts this to role='trainer'.
  const { error } = await supabase
    .from("exercises")
    .update({ media_url: mediaUrl })
    .eq("id", exerciseId);

  if (error) {
    return { error: "שגיאה בשמירת התמונה" };
  }

  revalidatePath("/trainer/exercises");
  return { success: true };
}
