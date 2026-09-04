"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

export interface CreateTraineeState {
  error?: string;
}

export interface ActionState {
  error?: string;
  success?: boolean;
}

const USERNAME_RE = /^[a-z0-9_.]{3,32}$/;

/**
 * Confirms the signed-in caller is the trainer. RLS already blocks a
 * non-trainer from most tables, but the trainee actions below also use
 * the service-role admin client (bypasses RLS entirely), so this explicit
 * check is the real authorization boundary for those.
 */
async function requireTrainer() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: me } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();
  if (me?.role !== "trainer") {
    return { supabase, user, ok: false as const };
  }
  return { supabase, user, ok: true as const };
}

export async function createTrainee(
  _prevState: CreateTraineeState,
  formData: FormData,
): Promise<CreateTraineeState> {
  const fullName = String(formData.get("full_name") ?? "").trim();
  const username = String(formData.get("username") ?? "").trim().toLowerCase();
  const email = String(formData.get("email") ?? "").trim();
  const phone = String(formData.get("phone") ?? "").trim();
  const password = String(formData.get("password") ?? "");

  if (!fullName || !username || !password) {
    return { error: "נא למלא שם, שם משתמש וסיסמה" };
  }
  if (!USERNAME_RE.test(username)) {
    return {
      error:
        "שם משתמש: 3-32 תווים, אותיות אנגלית קטנות/ספרות/נקודה/קו תחתון בלבד",
    };
  }
  if (password.length < 6) {
    return { error: "הסיסמה חייבת להכיל לפחות 6 תווים" };
  }

  const auth = await requireTrainer();
  if (!auth.ok) {
    return { error: "אין הרשאה לבצע פעולה זו" };
  }

  // Supabase Auth still needs *an* email under the hood even though the
  // trainee logs in with a username (see email_for_username() in
  // migration 0004) — auto-generate one when the trainer doesn't give a
  // real one, so email is effectively optional from the UI's perspective.
  const finalEmail = email || `${username}@trainees.local`;

  const admin = createAdminClient();
  const { error } = await admin.auth.admin.createUser({
    email: finalEmail,
    password,
    email_confirm: true,
    user_metadata: { full_name: fullName, phone: phone || undefined, username },
  });

  if (error) {
    const msg = error.message.toLowerCase();
    return {
      error: msg.includes("already")
        ? "כבר קיים משתמש עם האימייל או שם המשתמש הזה"
        : "שגיאה ביצירת המתאמן",
    };
  }

  revalidatePath("/trainer/trainees");
  redirect("/trainer/trainees");
}

export async function updateTrainee(
  traineeId: string,
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const fullName = String(formData.get("full_name") ?? "").trim();
  const username = String(formData.get("username") ?? "").trim().toLowerCase();
  const phone = String(formData.get("phone") ?? "").trim();

  if (!fullName || !username) {
    return { error: "נא למלא שם ושם משתמש" };
  }
  if (!USERNAME_RE.test(username)) {
    return {
      error:
        "שם משתמש: 3-32 תווים, אותיות אנגלית קטנות/ספרות/נקודה/קו תחתון בלבד",
    };
  }

  const auth = await requireTrainer();
  if (!auth.ok) {
    return { error: "אין הרשאה לבצע פעולה זו" };
  }

  const { error } = await auth.supabase
    .from("profiles")
    .update({ full_name: fullName, username, phone: phone || null })
    .eq("id", traineeId);

  if (error) {
    return {
      error:
        error.code === "23505"
          ? "שם המשתמש הזה כבר תפוס"
          : "שגיאה בעדכון המתאמן",
    };
  }

  revalidatePath("/trainer/trainees");
  revalidatePath(`/trainer/trainees/${traineeId}`);
  return { success: true };
}

export async function resetTraineePassword(
  traineeId: string,
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const password = String(formData.get("password") ?? "");
  if (password.length < 6) {
    return { error: "הסיסמה חייבת להכיל לפחות 6 תווים" };
  }

  const auth = await requireTrainer();
  if (!auth.ok) {
    return { error: "אין הרשאה לבצע פעולה זו" };
  }

  const admin = createAdminClient();
  const { error } = await admin.auth.admin.updateUserById(traineeId, { password });
  if (error) {
    return { error: "שגיאה באיפוס הסיסמה" };
  }

  return { success: true };
}

export async function deleteTrainee(traineeId: string): Promise<ActionState> {
  const auth = await requireTrainer();
  if (!auth.ok) {
    return { error: "אין הרשאה לבצע פעולה זו" };
  }

  const admin = createAdminClient();
  // Deletes auth.users; profiles row cascades via its FK (on delete cascade).
  const { error } = await admin.auth.admin.deleteUser(traineeId);
  if (error) {
    return { error: "שגיאה במחיקת המתאמן" };
  }

  revalidatePath("/trainer/trainees");
  redirect("/trainer/trainees");
}
