"use client";

import { useEffect } from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * A centered popup dialog: dims the page, closes on click-outside/X/Escape.
 * Shared by anything that needs a real "pop up in the middle of the
 * screen" moment (a day picker, a preview-before-you-commit step) rather
 * than an inline expand/collapse.
 */
export function Modal({
  open,
  onClose,
  title,
  children,
  className,
}: {
  open: boolean;
  onClose: () => void;
  title?: string;
  children: React.ReactNode;
  className?: string;
}) {
  useEffect(() => {
    if (!open) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={onClose}
    >
      {/* flex-col + max-h here (not just on the backdrop's p-4 gutter) so
          content taller than the viewport scrolls inside the modal instead
          of overflowing it — the title/close row stays pinned (shrink-0)
          while only the body scrolls. 100dvh rather than 100vh: on mobile
          browsers vh includes space the address bar can cover, dvh doesn't. */}
      <div
        onClick={(e) => e.stopPropagation()}
        className={cn(
          "flex max-h-[calc(100dvh-2rem)] w-full max-w-md flex-col rounded-xl border border-border bg-card shadow-2xl",
          className,
        )}
      >
        <div className="flex shrink-0 items-center justify-between gap-2 p-4 pb-3">
          {title && <h2 className="text-base font-semibold">{title}</h2>}
          <button
            type="button"
            onClick={onClose}
            aria-label="סגור"
            className="ms-auto flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="overflow-y-auto px-4 pb-4">{children}</div>
      </div>
    </div>
  );
}
