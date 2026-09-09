"use client";

import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

/**
 * The file-upload image input shared by the two "create a new exercise"
 * flows (the standalone "תרגיל חדש" page and the program builder's inline
 * picker) — field name ("image_file") matches resolveMediaUrl's
 * server-side contract in src/app/trainer/exercises/actions.ts. File
 * upload only, no pasted-URL option (removed so every exercise photo
 * actually lives in our own "exercise-images" Storage bucket).
 *
 * Editing an *existing* exercise's image has its own richer flow —
 * src/app/trainer/exercises/exercise-detail-modal.tsx — with a live
 * replace/cancel step; this component is only for "pick a file before you
 * even save the new exercise", so it just shows a plain preview of
 * whatever's currently chosen (an object URL, revoked on change/unmount so
 * it doesn't leak).
 */
export function ExerciseImageField({
  size = "md",
  className,
}: {
  size?: "sm" | "md";
  className?: string;
}) {
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const objectUrlRef = useRef<string | null>(null);

  useEffect(() => {
    return () => {
      if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
    };
  }, []);

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    if (objectUrlRef.current) {
      URL.revokeObjectURL(objectUrlRef.current);
      objectUrlRef.current = null;
    }
    const file = e.target.files?.[0];
    if (file) {
      const url = URL.createObjectURL(file);
      objectUrlRef.current = url;
      setPreviewUrl(url);
    } else {
      setPreviewUrl(null);
    }
  }

  const isSmall = size === "sm";

  return (
    <div className={cn("flex items-center gap-2", className)}>
      {previewUrl && (
        // eslint-disable-next-line @next/next/no-img-element -- object URL from the local file, not an external host
        <img
          src={previewUrl}
          alt="תצוגה מקדימה"
          className={cn(
            "shrink-0 rounded-md border border-border object-cover",
            isSmall ? "h-10 w-10" : "h-16 w-16",
          )}
        />
      )}
      <input
        type="file"
        name="image_file"
        accept="image/*"
        onChange={handleFileChange}
        className={cn(
          "block min-w-0 flex-1 text-muted-foreground file:me-2 file:rounded-md file:border-0 file:bg-secondary file:text-secondary-foreground",
          isSmall
            ? "text-xs file:px-2 file:py-1 file:text-xs"
            : "text-sm file:px-3 file:py-1.5 file:text-sm",
        )}
      />
    </div>
  );
}
