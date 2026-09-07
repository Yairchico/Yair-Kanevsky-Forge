import { type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";

/**
 * Deliberately named `middleware.ts` / `middleware()`, NOT Next 16's renamed
 * `proxy.ts` / `proxy()` — even though the rename is the "current" spelling,
 * `proxy.ts` is hard-locked to the Node.js runtime (Next's own docs: "The
 * edge runtime is NOT supported in proxy. ... If you want to continue using
 * the edge runtime, keep using middleware."). This project keeps
 * `middleware.ts` specifically for that: `@opennextjs/cloudflare` runs edge
 * middleware through its well-supported `openNextEdgePlugins` path, while
 * its own source (`bundle-node-middleware.js`) documents Node.js middleware
 * on workerd as "experimental ... not supported by the OpenNext
 * maintainers." Reverted 2026-09-07 after the staging Worker crashed on
 * every route with a generic 500 whose Observability log bottomed out in
 * `middlewareHandler` — the exact code path that comment describes. Do not
 * rename this back to `proxy.ts` without re-confirming OpenNext has since
 * added real support for Node.js middleware on Cloudflare Workers.
 */
export async function middleware(request: NextRequest) {
  return updateSession(request);
}

export const config = {
  matcher: [
    /*
     * Match all request paths except:
     * - _next/static, _next/image (Next.js internals)
     * - favicon.ico, common static assets
     */
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
