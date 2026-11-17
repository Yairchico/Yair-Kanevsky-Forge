import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import type { Database } from "@/lib/supabase/types";

/**
 * Supabase client for use in Server Components, Server Actions and Route
 * Handlers. Reads/writes the auth session via Next.js cookies.
 *
 * NOTE: Server Components can't write cookies — the `setAll` call below will
 * throw there. That's expected and safe to ignore as long as
 * `src/middleware.ts` is refreshing the session on every request.
 */

/**
 * Optional timing of every request to Supabase, for finding out where a
 * slow page spends its time. Off unless the PERF_LOG environment variable
 * is "1" (staging: wrangler.jsonc → env.staging.vars). One line per request
 * in the Worker's log (Cloudflare → Workers → Logs): method, path WITHOUT
 * the query string (so no ids, names or filters are ever logged), status
 * and duration.
 */
const timedFetch: typeof fetch = async (input, init) => {
  const started = Date.now();
  const method = init?.method ?? (input instanceof Request ? input.method : "GET");
  let path = "";
  try {
    path = new URL(input instanceof Request ? input.url : String(input)).pathname;
  } catch {
    // not worth failing a request over
  }
  try {
    const response = await fetch(input, init);
    console.log(`[perf] ${method} ${path} ${response.status} ${Date.now() - started}ms`);
    return response;
  } catch (error) {
    console.log(`[perf] ${method} ${path} failed ${Date.now() - started}ms`);
    throw error;
  }
};

export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      ...(process.env.PERF_LOG === "1" ? { global: { fetch: timedFetch } } : {}),
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options),
            );
          } catch {
            // Called from a Server Component — middleware handles refresh.
          }
        },
      },
    },
  );
}
