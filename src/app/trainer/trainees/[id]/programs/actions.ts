"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export interface ActionState {
  error?: string;
}

const DAY_LABELS = [
  "ראשון",
  "שני",
  "שלישי",
  "רביעי",
  "חמישי",
  "שישי",
  "שבת",
];

export async function createProgram(
  traineeId: string,
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const title = String(formData.get("title") ?? "").trim();
  if (!title) {
    return { error: "נא להזין שם לתוכנית" };
  }

  const supabase = await createClient();

  const { data: program, error } = await supabase
    .from("programs")
    .insert({ trainee_id: traineeId, title })
    .select("id")
    .single();

  if (error || !program) {
    return { error: "שגיאה ביצירת התוכנית" };
  }

  const { error: daysError } = await supabase.from("program_days").insert(
    DAY_LABELS.map((label, day_index) => ({
      program_id: program.id,
      day_index,
      label,
    })),
  );

  if (daysError) {
    return { error: "התוכנית נוצרה אך שגיאה ביצירת הימים" };
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
