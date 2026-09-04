"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/current-user";

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

  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const supabase = await createClient();

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
