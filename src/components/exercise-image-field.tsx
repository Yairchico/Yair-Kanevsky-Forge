"use client";

import { useEffect, useRef, useState } from "react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

/**
 * The file+URL image input shared by every place a trainer sets an
 * exercise's image (the exercise library's edit-image flow, the standalone
 * "תרגיל חדש" page, and the program builder's inline picker) — field names
 * ("image_file"/"media_url") match resolveMediaUrl's server-side "upload
 * wins over URL" contract in src/app/trainer/exercises/actions.ts.
 *
 * Shows a live preview of a newly chosen file (an object URL, revoked on
 * change/unmount so it doesn't leak) so a trainer sees what they're about
 * to upload before saving, instead of only finding out after the fact.
 */
export function ExerciseImageField({
  urlDefaultValue,
  size = "md",
  className,
}: {
  urlDefaultValue?: string;
  size?: "sm" | "md";
  className?: string;
}) {
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const objectUrlRef = useRef<string | null>(null);

  // Revoke on unmount too, not just on the next selection — otherwise the
  // last chosen file's object URL leaks for the page's lifetime.
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
    <div className={cn("space-y-1.5", className)}>
      <div className="flex items-center gap-2">
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
      <p className={cn("text-center text-muted-foreground", isSmall ? "text-[10px]" : "text-xs")}>
        או
      </p>
      <Input
        name="media_url"
        defaultValue={urlDefaultValue}
        placeholder="קישור לתמונה"
        className={isSmall ? "h-8 text-xs" : undefined}
      />
    </div>
  );
}
