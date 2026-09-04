import type { NextConfig } from "next";
import { initOpenNextCloudflareForDev } from "@opennextjs/cloudflare";

const nextConfig: NextConfig = {
  /* config options here */
};

export default nextConfig;

// Enables `wrangler`-provided bindings (env vars, future KV/R2/D1, etc.)
// inside `next dev`, so local dev and the Cloudflare runtime stay in sync.
initOpenNextCloudflareForDev();
