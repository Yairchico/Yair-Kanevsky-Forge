import { cache } from "react";
import { createClient } from "@/lib/supabase/server";

type Supabase = Awaited<ReturnType<typeof createClient>>;

/** Who is signed in, as far as the app's screens need to know. */
export interface Viewer {
  id: string;
  email: string | null;
  role: "trainer" | "trainee";
  /**
   * The read-only "superadmin" oversight account (profiles.is_superadmin,
   * migration 0011) — someone who shares the trainer's screens but must
   * never change anything. The real enforcement is RLS (no INSERT/UPDATE/
   * DELETE policy exists for is_superadmin() anywhere); the screens check
   * this only so they don't show a control that would just fail.
   */
  isSuperadmin: boolean;
  username: string | null;
  fullName: string | null;
}

/** The `sub` of a JWT, read without verifying it. Only ever used as a query filter — see getRequestAuth. */
function unverifiedSubject(token: string): string | null {
  try {
    const payload = token.split(".")[1];
    if (!payload) return null;
    const base64 = payload.replace(/-/g, "+").replace(/_/g, "/");
    const json = new TextDecoder().decode(Uint8Array.from(atob(base64), (c) => c.charCodeAt(0)));
    const sub = (JSON.parse(json) as { sub?: unknown }).sub;
    return typeof sub === "string" && sub ? sub : null;
  } catch {
    return null;
  }
}

async function loadViewer(supabase: Supabase, token: string, userId: string): Promise<Viewer | null> {
  try {
    // Two things at once instead of one after the other:
    // - getClaims verifies the access token: locally (no network) when the
    //   Supabase project signs with asymmetric keys, otherwise by asking the
    //   Auth server exactly like getUser() did.
    // - the viewer's own profile row. PostgREST verifies the same token
    //   itself before RLS runs, so starting this before the verification
    //   above has answered can't leak anything: a bad token gets no rows.
    const [claims, profile] = await Promise.all([
      supabase.auth.getClaims(token),
      supabase.from("profiles").select("role, is_superadmin, username, full_name").eq("id", userId).maybeSingle(),
    ]);
    if (claims.error || claims.data?.claims.sub !== userId) return null;
    const email = claims.data.claims.email;
    return {
      id: userId,
      email: typeof email === "string" ? email : null,
      role: profile.data?.role === "trainer" ? "trainer" : "trainee",
      isSuperadmin: profile.data?.is_superadmin === true,
      username: profile.data?.username ?? null,
      fullName: profile.data?.full_name ?? null,
    };
  } catch {
    return null;
  }
}

/**
 * The start of every page and Server Action: the cookie-scoped Supabase
 * client, plus who is asking.
 *
 * - `viewer` is a promise of the VERIFIED signed-in user and their profile
 *   (null = not signed in / invalid session). Nothing may be rendered or
 *   written on someone's behalf before it has resolved to a viewer.
 * - `userId` is available at once, read from the session cookie WITHOUT
 *   verification. Its only legitimate use is as a filter value in queries
 *   that are started in parallel with the verification (so a page waits
 *   once instead of twice): every such query goes through PostgREST, which
 *   verifies the token and applies RLS on its own, so an invalid or forged
 *   cookie simply gets empty results — and the page still must await
 *   `viewer` before using them. Never use `userId` for a decision by itself,
 *   and never with the service-role client.
 *
 * Memoized per request while rendering, so a page and the helpers it calls
 * share one verification and one profile query.
 */
export const getRequestAuth = cache(async () => {
  const supabase = await createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  const token = session?.access_token ?? null;
  const userId = token ? unverifiedSubject(token) : null;
  const viewer: Promise<Viewer | null> = token && userId ? loadViewer(supabase, token, userId) : Promise.resolve(null);
  return { supabase, userId, viewer };
});
