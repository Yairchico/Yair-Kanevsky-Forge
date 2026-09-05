"use server";

import { createClient } from "@/lib/supabase/server";

export interface UpdatePasswordState {
  error?: string;
  success?: boolean;
}

/**
 * Sets a new password for whoever is signed in via the recovery-email link
 * (see resetTraineePassword + /auth/callback). Relies entirely on the
 * session the recovery link already established — no admin client needed.
 */
export async function updatePassword(
  _prevState: UpdatePasswordState,
  formData: FormData,
): Promise<UpdatePasswordState> {
  const password = String(formData.get("password") ?? "");
  if (password.length < 6) {
    return { error: "הסיסמה חייבת להכיל לפחות 6 תווים" };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { error: "הקישור פג תוקף. יש לבקש איפוס סיסמה חדש." };
  }

  const { error } = await supabase.auth.updateUser({ password });
  if (error) {
    return { error: "שגיאה בעדכון הסיסמה" };
  }

  return { success: true };
}
