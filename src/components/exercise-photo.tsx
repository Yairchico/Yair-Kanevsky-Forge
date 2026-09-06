"use client";

import { useEffect, useState } from "react";
import { Dumbbell, X } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * A thumbnail that opens a full-size lightbox on click/tap — exercise
 * photos are informative (form, setup) and the thumbnails are small, so
 * being able to blow one up matters more here than for most images in
 * the app. Self-contained (owns its own open state), so it drops into any
 * card without the parent needing to know about it.
 *
 * `src: null` (a custom exercise with no photo set) renders a plain,
 * non-interactive placeholder instead — nothing to enlarge.
 */
export function ExercisePhoto({
  src,
  alt = "",
  className,
}: {
  src: string | null;
  alt?: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open]);

  if (!src) {
    return (
      <div
        className={cn(
          "flex shrink-0 items-center justify-center bg-primary/10 text-primary",
          className,
        )}
      >
        <Dumbbell className="h-1/3 w-1/3" />
      </div>
    );
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="הגדל תמונה"
        className="shrink-0 cursor-zoom-in"
      >
        {/* eslint-disable-next-line @next/next/no-img-element -- media_url can be any external host */}
        <img src={src} alt={alt} loading="lazy" className={cn("object-cover", className)} />
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
          onClick={() => setOpen(false)}
        >
          <button
            type="button"
            onClick={() => setOpen(false)}
            aria-label="סגור"
            className="absolute end-4 top-4 flex h-9 w-9 items-center justify-center rounded-full bg-black/40 text-white transition-colors hover:bg-black/60"
          >
            <X className="h-5 w-5" />
          </button>
          {/* eslint-disable-next-line @next/next/no-img-element -- media_url can be any external host */}
          <img
            src={src}
            alt={alt}
            onClick={(e) => e.stopPropagation()}
            className="max-h-[85vh] max-w-[90vw] rounded-lg object-contain shadow-2xl"
          />
        </div>
      )}
    </>
  );
}
