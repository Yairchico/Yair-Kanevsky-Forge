"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentUser } from "@/lib/current-user";

export interface CreateTraineeState {
  error?: string;
}

export async function createTrainee(
  _prevState: CreateTraineeState,
  formData: FormData,
): Promise<CreateTraineeState> {
  const fullName = String(formData.get("full_name") ?? "").trim();
  const email = String(formData.get("email") ?? "").trim();
  const phone = String(formData.get("phone") ?? "").trim();
  const password = String(formData.get("password") ?? "");

  if (!fullName || !email || !password) {
    return { error: "נא למלא שם, אימייל וסיסמה" };
  }
  if (password.length < 6) {
    return { error: "הסיסמה חייבת להכיל לפחות 6 תווים" };
  }

  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const supabase = await createClient();

  // Defense in depth: RLS already blocks non-trainers from most tables,
  // but admin.createUser below uses the service-role key, which bypasses
  // RLS entirely — so the role check has to happen here explicitly.
  const { data: me } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();
  if (me?.role !== "trainer") {
    return { error: "אין הרשאה לבצע פעולה זו" };
  }

  const admin = createAdminClient();
  const { error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name: fullName, phone: phone || undefined },
  });

  if (error) {
    return {
      error: error.message.toLowerCase().includes("already")
        ? "כבר קיים משתמש עם האימייל הזה"
        : "שגיאה ביצירת המתאמן",
    };
  }

  revalidatePath("/trainer/trainees");
  redirect("/trainer/trainees");
}
