"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { headers } from "next/headers";
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
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PLACEHOLDER_EMAIL_SUFFIX = "@trainees.local";

/** Best-effort absolute site origin, for building the password-reset email's link. */
async function getSiteOrigin() {
  const h = await headers();
  const host = h.get("host");
  if (!host) return undefined;
  const proto = h.get("x-forwarded-proto") ?? "https";
  return `${proto}://${host}`;
}

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
  if (email && !EMAIL_RE.test(email)) {
    return { error: "כתובת האימייל אינה תקינה" };
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
    // Logged server-side (Cloudflare logs) for real diagnosis, and also
    // surfaced to the trainer (this form is trainer-only) — a generic
    // "something went wrong" was hiding the actual Supabase error every
    // time this broke, so show it directly instead of guessing at it blind.
    console.error("createTrainee: admin.createUser failed", error);
    const msg = error.message.toLowerCase();
    return {
      error: msg.includes("already")
        ? "כבר קיים משתמש עם האימייל או שם המשתמש הזה"
        : `שגיאה ביצירת המתאמן: ${error.message}`,
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
  const email = String(formData.get("email") ?? "").trim();
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
  if (email && !EMAIL_RE.test(email)) {
    return { error: "כתובת האימייל אינה תקינה" };
  }

  const auth = await requireTrainer();
  if (!auth.ok) {
    return { error: "אין הרשאה לבצע פעולה זו" };
  }

  // Auth still needs *an* email under the hood (see createTrainee) — an
  // emptied field falls back to the placeholder rather than leaving the
  // real auth user without one.
  const finalEmail = email || `${username}${PLACEHOLDER_EMAIL_SUFFIX}`;

  const admin = createAdminClient();
  const { error: authError } = await admin.auth.admin.updateUserById(traineeId, {
    email: finalEmail,
    email_confirm: true,
  });
  if (authError) {
    console.error("updateTrainee: admin.updateUserById (email) failed", authError);
    const msg = authError.message.toLowerCase();
    return {
      error: msg.includes("already")
        ? "כתובת האימייל הזו כבר בשימוש"
        : `שגיאה בעדכון האימייל: ${authError.message}`,
    };
  }

  const { error } = await auth.supabase
    .from("profiles")
    .update({ full_name: fullName, username, phone: phone || null, email: finalEmail })
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

/**
 * Sends the trainee a real password-reset email instead of the trainer
 * setting a new password directly. Requires the trainee to have a real
 * (non-placeholder) email on file, and requires Supabase's email sending
 * (built-in or custom SMTP) to actually be configured on the project —
 * otherwise the call succeeds here but no mail arrives.
 */
export async function resetTraineePassword(traineeId: string): Promise<ActionState> {
  const auth = await requireTrainer();
  if (!auth.ok) {
    return { error: "אין הרשאה לבצע פעולה זו" };
  }

  const { data: trainee } = await auth.supabase
    .from("profiles")
    .select("email")
    .eq("id", traineeId)
    .single();

  const email = trainee?.email;
  if (!email || email.endsWith(PLACEHOLDER_EMAIL_SUFFIX)) {
    return { error: "יש להוסיף כתובת אימייל אמיתית למתאמן לפני שליחת איפוס סיסמה" };
  }

  const origin = await getSiteOrigin();
  const { error } = await auth.supabase.auth.resetPasswordForEmail(email, {
    redirectTo: origin ? `${origin}/auth/callback?next=/reset-password` : undefined,
  });

  if (error) {
    console.error("resetTraineePassword: resetPasswordForEmail failed", error);
    return { error: `שגיאה בשליחת מייל האיפוס: ${error.message}` };
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
