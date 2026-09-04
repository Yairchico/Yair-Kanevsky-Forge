"use server";

import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";

export interface SignInState {
  error?: string;
}

export async function signIn(
  _prevState: SignInState,
  formData: FormData,
): Promise<SignInState> {
  const username = String(formData.get("username") ?? "").trim().toLowerCase();
  const password = String(formData.get("password") ?? "");

  if (!username || !password) {
    return { error: "נא למלא שם משתמש וסיסמה" };
  }

  const supabase = await createClient();

  // Login is by username, but Supabase Auth itself still works by email —
  // resolve the (real or placeholder) email server-side first. Generic
  // "wrong username or password" error either way, so this doesn't leak
  // whether a username exists.
  const { data: email } = await supabase.rpc("email_for_username", {
    p_username: username,
  });

  if (!email) {
    return { error: "שם משתמש או סיסמה שגויים" };
  }

  const { data, error } = await supabase.auth.signInWithPassword({ email, password });

  if (error || !data.user) {
    return { error: "שם משתמש או סיסמה שגויים" };
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", data.user.id)
    .single();
  const role = profile?.role === "trainer" ? "trainer" : "trainee";

  // Cache the role in its own cookie so proxy.ts doesn't have to query
  // `profiles` again on every subsequent navigation (see the perf notes
  // in src/lib/supabase/middleware.ts).
  const cookieStore = await cookies();
  cookieStore.set("app_role", role, {
    httpOnly: true,
    sameSite: "lax",
    secure: true,
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
  });

  // Redirect straight to the right area instead of bouncing through /login
  // again (proxy.ts would otherwise have to work this out a second time).
  redirect(role === "trainer" ? "/trainer" : "/trainee");
}
