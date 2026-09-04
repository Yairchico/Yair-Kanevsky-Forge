import { cn } from "@/lib/utils";
import { APP_NAME } from "@/lib/constants";

/**
 * Placeholder brand mark — recreated (colors + a "YK" monogram) from the
 * logo image shared in chat, since we only have the image, not an actual
 * asset file (PNG/SVG) to embed. Once that file exists, replace the div
 * below with an <Image src="/logo.svg" .../> here and every screen that
 * uses <BrandMark> picks it up automatically.
 */
export function BrandMark({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        "flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary text-sm font-black tracking-tighter text-primary-foreground",
        className,
      )}
    >
      YK
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
