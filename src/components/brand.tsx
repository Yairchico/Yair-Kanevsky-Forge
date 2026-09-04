import { cn } from "@/lib/utils";
import { APP_NAME } from "@/lib/constants";

/**
 * Placeholder brand mark until a real logo file is provided — swap the
 * emoji below for an <Image src="/logo.svg" .../> once we have one. Kept
 * as its own component so that swap only has to happen in one place.
 */
export function BrandMark({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        "flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xl",
        className,
      )}
    >
      💪
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
