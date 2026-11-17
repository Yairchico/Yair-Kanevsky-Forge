import type { NextConfig } from "next";
import { PHASE_PRODUCTION_BUILD } from "next/constants";
import { initOpenNextCloudflareForDev } from "@opennextjs/cloudflare";

/**
 * The only branch Cloudflare's dashboard git integration ("Workers Builds")
 * may build. That integration is wired to the PRODUCTION Worker and fires on
 * a push to ANY branch (see CLAUDE.md → Deployment), so without this a
 * feature branch pushed for review could be built and shipped to real
 * trainees — including code that needs a database migration nobody has run
 * yet. Change this constant if the production branch is ever renamed.
 */
const PRODUCTION_BRANCH = "claude/fitness-app-trainers-gccazz";

/**
 * Build-time safety checks. Both turn a silent, user-facing outage into a
 * loud failed build, and neither affects `next dev`, lint or type-checking
 * (they only run for a real `next build`).
 */
function assertSafeToBuild() {
  // 1. Workers Builds sets WORKERS_CI=1 and WORKERS_CI_BRANCH=<pushed branch>
  //    (developers.cloudflare.com/workers/ci-cd/builds/configuration). A
  //    failed build never reaches the deploy step, so refusing here is what
  //    keeps a non-production branch off the live site. GitHub Actions
  //    (ci.yml, deploy.yml, deploy-production.yml) doesn't set WORKERS_CI and
  //    is unaffected. Fails closed: if the branch can't be identified at
  //    all, don't build — the previous deployment simply keeps running.
  if (process.env.WORKERS_CI === "1") {
    const branch = process.env.WORKERS_CI_BRANCH;
    if (branch !== PRODUCTION_BRANCH) {
      throw new Error(
        `Refusing to build branch "${branch ?? "(unknown)"}" in Cloudflare Workers Builds: ` +
          `only "${PRODUCTION_BRANCH}" may deploy to production. This is intentional ` +
          `(next.config.ts → PRODUCTION_BRANCH); the live site is untouched.`,
      );
    }
  }

  // 2. NEXT_PUBLIC_* values are inlined at build time. An unset GitHub
  //    secret arrives as an empty string, the build "succeeds", and the
  //    resulting Worker throws on every single request (this exact thing
  //    took staging down — CLAUDE.md → Known gotchas). Refuse to produce
  //    that build at all.
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  if (!/^https?:\/\/\S+$/i.test(url.trim())) {
    throw new Error(
      "NEXT_PUBLIC_SUPABASE_URL is missing or not an http(s) URL at build time. " +
        "Set it (GitHub → Settings → Secrets and variables → Actions, or the " +
        "Cloudflare build variables) before building — a build without it deploys a " +
        "site that fails on every request.",
    );
  }
  if (!(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "").trim()) {
    throw new Error("NEXT_PUBLIC_SUPABASE_ANON_KEY is missing at build time.");
  }
}

const nextConfig: NextConfig = {
  experimental: {
    serverActions: {
      // Default is 1MB, which silently rejects most real photo uploads
      // (e.g. the exercise-image file upload in
      // src/app/trainer/exercises/actions.ts, whose own MAX_IMAGE_BYTES
      // check allows up to 5MB) before the Server Action body ever reaches
      // our code — a pasted URL isn't affected since that request body is
      // tiny. Sized a bit above that 5MB cap for the multipart boundary/
      // header overhead Next's docs warn about.
      bodySizeLimit: "6mb",
    },
  },
};

export default function config(phase: string): NextConfig {
  // `next typegen` reports the build phase too, but it only writes route
  // types and deploys nothing, so it shouldn't need real env values.
  const isTypegen = process.argv.includes("typegen");
  if (phase === PHASE_PRODUCTION_BUILD && !isTypegen) assertSafeToBuild();
  return nextConfig;
}

// Enables `wrangler`-provided bindings (env vars, future KV/R2/D1, etc.)
// inside `next dev`, so local dev and the Cloudflare runtime stay in sync.
initOpenNextCloudflareForDev();
