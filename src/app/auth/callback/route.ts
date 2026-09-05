import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

// Handles the redirect from Supabase magic-link / OAuth / password-recovery
// flows. `next` (set when the link was generated — see resetTraineePassword)
// says where to send the user once their session is established; password
// recovery points it at /reset-password so they land straight on the "set
// a new password" form instead of /login.
export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const next = searchParams.get("next");

  if (code) {
    const supabase = await createClient();
    await supabase.auth.exchangeCodeForSession(code);
  }

  return NextResponse.redirect(`${origin}${next && next.startsWith("/") ? next : "/login"}`);
}
