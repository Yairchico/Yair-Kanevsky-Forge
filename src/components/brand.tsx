import Image from "next/image";
import { cn } from "@/lib/utils";
import { APP_NAME } from "@/lib/constants";

/**
 * public/logo-mark.png and public/logo-full.png are cropped (via sharp,
 * see git history) from the logo image the user uploaded to public/logo.png.
 * `unoptimized` because we already pre-sized them and this app doesn't
 * have Cloudflare's Images binding configured (see wrangler.jsonc).
 */
export function BrandMark({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        "relative h-10 w-10 shrink-0 overflow-hidden rounded-xl",
        className,
      )}
    >
      <Image
        src="/logo-mark.png"
        alt=""
        fill
        sizes="40px"
        unoptimized
        className="object-cover"
      />
    </div>
  );
}

export function Brand({ className }: { className?: string }) {
  return (
    <div className={cn("flex items-center gap-2", className)}>
      <BrandMark />
      <span className="font-semibold leading-none">{APP_NAME}</span>
    </div>
  );
}
