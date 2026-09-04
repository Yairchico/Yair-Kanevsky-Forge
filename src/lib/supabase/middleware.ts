import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

const PUBLIC_PATHS = ["/login", "/auth"];

/**
 * Refreshes the Supabase auth session on every request and enforces
 * basic route protection + role-based routing:
 *  - Signed-out users hitting a protected path are sent to /login.
 *  - Signed-in users are routed to /trainer or /trainee based on their
 *    profile role, and kept out of the other role's area.
 *  - Signed-in users hitting /login are sent to their own area.
 *
 * Also forwards the already-validated user id/email as request headers
 * (x-user-id / x-user-email) so pages can read them via
 * `getCurrentUser()` (src/lib/current-user.ts) instead of calling
 * `supabase.auth.getUser()` again themselves — that call is a network
 * round trip to Supabase's Auth API, and doing it twice per navigation
 * (once here, once in the page) was adding real latency for no benefit,
 * since this proxy already did the validation.
 */
export async function updateSession(request: NextRequest) {
  const requestHeaders = new Headers(request.headers);
  let supabaseResponse = NextResponse.next({ request: { headers: requestHeaders } });

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
          supabaseResponse = NextResponse.next({ request: { headers: requestHeaders } });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  // IMPORTANT: do not remove — revalidates the auth token with Supabase's
  // Auth server (unlike getSession(), which only decodes the local
  // cookie). This is the one place per request that should pay for that
  // round trip; everything downstream reuses its result via headers.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { pathname } = request.nextUrl;
  const isPublicPath = PUBLIC_PATHS.some((p) => pathname.startsWith(p));

  if (!user && !isPublicPath) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    return NextResponse.redirect(url);
  }

  if (user) {
    requestHeaders.set("x-user-id", user.id);
    if (user.email) requestHeaders.set("x-user-email", user.email);
    supabaseResponse = NextResponse.next({ request: { headers: requestHeaders } });

    if (pathname === "/login" || pathname === "/") {
      const { data: profile } = await supabase
        .from("profiles")
        .select("role")
        .eq("id", user.id)
        .single();
      const url = request.nextUrl.clone();
      url.pathname = profile?.role === "trainer" ? "/trainer" : "/trainee";
      return NextResponse.redirect(url);
    }

    if (pathname.startsWith("/trainer") || pathname.startsWith("/trainee")) {
      const { data: profile } = await supabase
        .from("profiles")
        .select("role")
        .eq("id", user.id)
        .single();

      const wantsTrainerArea = pathname.startsWith("/trainer");
      const isTrainer = profile?.role === "trainer";

      if (wantsTrainerArea !== isTrainer) {
        const url = request.nextUrl.clone();
        url.pathname = isTrainer ? "/trainer" : "/trainee";
        return NextResponse.redirect(url);
      }
    }
  }

  return supabaseResponse;
}
