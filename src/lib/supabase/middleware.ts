import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

const PUBLIC_PATHS = ["/login", "/auth"];
const ROLE_COOKIE = "app_role";

/**
 * Refreshes the Supabase auth session on every request and enforces
 * basic route protection + role-based routing:
 *  - Signed-out users hitting a protected path are sent to /login.
 *  - Signed-in users are routed to /trainer or /trainee based on their
 *    profile role, and kept out of the other role's area.
 *  - Signed-in users hitting /login are sent to their own area.
 *
 * Performance notes (this runs on EVERY navigation, so its cost is the
 * app's baseline "feels slow" cost):
 *
 * - Uses getSession() instead of getUser(). getUser() always makes a
 *   network call to Supabase's Auth API to revalidate the token — that's
 *   the right call to make before trusting a claim for AUTHORIZATION, but
 *   this proxy only uses it for which page shell to route to. Every real
 *   data query (Server Components, Server Actions) still goes straight to
 *   Supabase/PostgREST with the same cookies and is independently
 *   re-validated there via RLS — so a forged/stale session here can only
 *   ever produce an empty/broken page shell, never real data. getSession()
 *   decodes the cookie locally (refreshing it transparently if the access
 *   token expired) with no network round trip in the common case.
 * - Caches `role` in its own plain cookie (set at login, see
 *   src/app/login/actions.ts) instead of querying `profiles` on every
 *   request. Same reasoning: this is a routing convenience, not the
 *   authorization boundary (RLS is), so a stale/tampered value only
 *   misroutes to a page shell that then renders empty via RLS. Missing
 *   cookie (older session) falls back to a real query and re-seeds it.
 *
 * NOTE: an earlier version also forwarded the user id/email as request
 * headers so pages could skip their own getUser() call. That's removed —
 * it's suspected of not surviving the OpenNext/Cloudflare "Node.js
 * middleware" experimental runtime for Server Action requests specifically
 * (a trainee-creation submit was silently bouncing to /login instead of
 * running). Pages and Server Actions call supabase.auth.getUser() directly
 * again, which reads the actual auth cookie rather than a header this
 * proxy set — more code, but it doesn't depend on that propagation path.
 */
export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value),
          );
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  const {
    data: { session },
  } = await supabase.auth.getSession();
  const user = session?.user ?? null;

  const { pathname } = request.nextUrl;
  const isPublicPath = PUBLIC_PATHS.some((p) => pathname.startsWith(p));

  if (!user && !isPublicPath) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    return NextResponse.redirect(url);
  }

  if (user) {
    const needsRoleGate =
      pathname === "/login" ||
      pathname === "/" ||
      pathname.startsWith("/trainer") ||
      pathname.startsWith("/trainee");

    if (needsRoleGate) {
      let role = request.cookies.get(ROLE_COOKIE)?.value;

      if (role !== "trainer" && role !== "trainee") {
        const { data: profile } = await supabase
          .from("profiles")
          .select("role")
          .eq("id", user.id)
          .single();
        role = profile?.role === "trainer" ? "trainer" : "trainee";
        supabaseResponse.cookies.set(ROLE_COOKIE, role, {
          httpOnly: true,
          sameSite: "lax",
          secure: true,
          path: "/",
          maxAge: 60 * 60 * 24 * 30,
        });
      }

      const isTrainer = role === "trainer";

      if (pathname === "/login" || pathname === "/") {
        const url = request.nextUrl.clone();
        url.pathname = isTrainer ? "/trainer" : "/trainee";
        return NextResponse.redirect(url);
      }

      const wantsTrainerArea = pathname.startsWith("/trainer");
      if (wantsTrainerArea !== isTrainer) {
        const url = request.nextUrl.clone();
        url.pathname = isTrainer ? "/trainer" : "/trainee";
        return NextResponse.redirect(url);
      }
    }
  }

  return supabaseResponse;
}
