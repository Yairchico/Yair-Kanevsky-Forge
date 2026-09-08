import type { NextConfig } from "next";
import { initOpenNextCloudflareForDev } from "@opennextjs/cloudflare";

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

export default nextConfig;

// Enables `wrangler`-provided bindings (env vars, future KV/R2/D1, etc.)
// inside `next dev`, so local dev and the Cloudflare runtime stay in sync.
initOpenNextCloudflareForDev();
