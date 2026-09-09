"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * A small, self-dismissing confirmation message pinned to the bottom of the
 * screen — for a quick "yes, that happened" after an action with no other
 * visible feedback (e.g. marking an exercise done from inside a modal that
 * then closes). Not for errors — those stay inline near the control that
 * failed, same as everywhere else in the app.
 */
export function useToast() {
  const [message, setMessage] = useState<string | null>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const show = useCallback((text: string, durationMs = 2500) => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    setMessage(text);
    timeoutRef.current = setTimeout(() => setMessage(null), durationMs);
  }, []);

  useEffect(() => {
    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, []);

  return { message, show };
}

export function Toast({ message }: { message: string | null }) {
  if (!message) return null;

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-4 z-[70] flex justify-center px-4">
      <div className="pointer-events-auto rounded-full bg-foreground px-4 py-2.5 text-sm font-medium text-background shadow-lg">
        {message}
      </div>
    </div>
  );
}
