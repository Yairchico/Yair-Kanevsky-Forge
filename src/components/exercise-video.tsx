"use client";

import { useState } from "react";
import { ExternalLink, Play } from "lucide-react";
import { cn } from "@/lib/utils";
import { resolveVideo } from "@/lib/video";

/**
 * An exercise's demo video (a link, migration 0015, or an uploaded file,
 * migration 0019 — see playableVideoUrl), collapsed
 * to a "▶ צפה בסרטון" button until asked for — the player (and with it
 * YouTube's/Vimeo's scripts, or the video file itself) isn't loaded at all
 * until the tap, so a workout screen with ten exercises costs nothing
 * extra. The iframe src comes from parseVideoUrl, never from the stored
 * text directly. Renders nothing for a link that no longer parses.
 */
export function ExerciseVideo({
  url,
  title,
  className,
  defaultOpen = false,
}: {
  url: string;
  title: string;
  className?: string;
  /** Start with the player showing (the library's preview). */
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const parsed = resolveVideo(url);
  if ("error" in parsed) return null;

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={cn(
          "flex w-full items-center justify-center gap-2 rounded-xl border border-border bg-card px-4 py-2.5 text-sm font-medium transition-colors hover:bg-muted",
          className,
        )}
      >
        <Play className="h-4 w-4" />
        צפה בסרטון
      </button>
    );
  }

  return (
    <div className={cn("space-y-1.5", className)}>
      <div className="aspect-video w-full overflow-hidden rounded-xl bg-black">
        {parsed.kind === "file" ? (
          <video
            src={parsed.embedUrl}
            controls
            playsInline
            preload="metadata"
            className="h-full w-full"
          />
        ) : (
          <iframe
            src={parsed.embedUrl}
            title={`סרטון: ${title}`}
            loading="lazy"
            allow="accelerometer; encrypted-media; gyroscope; picture-in-picture; fullscreen"
            allowFullScreen
            referrerPolicy="strict-origin-when-cross-origin"
            className="h-full w-full border-0"
          />
        )}
      </div>
      <a
        href={parsed.watchUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground hover:underline"
      >
        <ExternalLink className="h-3 w-3" />
        לא נטען? פתיחה בחלון חדש
      </a>
    </div>
  );
}
