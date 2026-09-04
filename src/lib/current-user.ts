import { headers } from "next/headers";

/**
 * Reads the id/email that src/lib/supabase/middleware.ts (proxy.ts)
 * already validated for this request and forwarded as headers — avoids a
 * second `supabase.auth.getUser()` network round trip per page just to
 * display "who am I". Not for authorization: real access control is
 * still RLS + the profiles.role check done in proxy.ts / server actions.
 */
export async function getCurrentUser() {
  const h = await headers();
  const id = h.get("x-user-id");
  if (!id) return null;
  return { id, email: h.get("x-user-email") };
}
