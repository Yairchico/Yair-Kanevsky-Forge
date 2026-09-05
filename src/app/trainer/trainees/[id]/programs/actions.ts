"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export interface ActionState {
  error?: string;
}

export async function createProgram(
  traineeId: string,
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const title = String(formData.get("title") ?? "").trim();
  const weekStartDate = String(formData.get("week_start_date") ?? "").trim();

  if (!title) {
    return { error: "נא להזין שם לתוכנית" };
  }
  if (!weekStartDate) {
    return { error: "נא לבחור שבוע" };
  }

  const supabase = await createClient();

  // One program per (trainee, week) — see migration 0006. If one already
  // exists for the chosen week, just go there instead of erroring.
  const { data: existing } = await supabase
    .from("programs")
    .select("id")
    .eq("trainee_id", traineeId)
    .eq("week_start_date", weekStartDate)
    .maybeSingle();

  if (existing) {
    redirect(`/trainer/trainees/${traineeId}/programs/${existing.id}`);
  }

  const { data: program, error } = await supabase
    .from("programs")
    .insert({ trainee_id: traineeId, title, week_start_date: weekStartDate })
    .select("id")
    .single();

  if (error || !program) {
    return { error: "שגיאה ביצירת התוכנית" };
  }

  revalidatePath(`/trainer/trainees/${traineeId}`);
  redirect(`/trainer/trainees/${traineeId}/programs/${program.id}`);
}

export async function deleteProgram(
  traineeId: string,
  programId: string,
): Promise<ActionState> {
  const supabase = await createClient();
  const { error } = await supabase.from("programs").delete().eq("id", programId);
  if (error) {
    return { error: "שגיאה במחיקת התוכנית" };
  }

  revalidatePath(`/trainer/trainees/${traineeId}`);
  redirect(`/trainer/trainees/${traineeId}`);
}

export async function setProgramStatus(
  traineeId: string,
  programId: string,
  status: "draft" | "published",
) {
  const supabase = await createClient();
  await supabase
    .from("programs")
    .update({
      status,
      published_at: status === "published" ? new Date().toISOString() : null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", programId);

  revalidatePath(`/trainer/trainees/${traineeId}`);
  revalidatePath(`/trainer/trainees/${traineeId}/programs/${programId}`);
}
