"use client";

import { useCallback, useEffect, useRef } from "react";
import { syncAfterEdits } from "@/app/sync-actions";

/**
 * For screens whose saves don't reload the page's data (see
 * src/app/sync-actions.ts): returns `schedule()`, to be called after every
 * successful save. Once things have been quiet for `delayMs`, one request
 * brings the page's fresh server copy and marks every other visited page
 * to be re-fetched. Leaving the screen before that runs it right away, so
 * the pages visited next never show what they held before the saves.
 *
 * `isBusy` (optional) = a save is still in flight; the sync waits for it.
 * If the sync itself fails (no reception) nothing is lost — the saves are
 * already stored; the page catches up on the next save or reload.
 */
export function useDeferredSync(delayMs: number, isBusy?: () => boolean): () => void {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const busy = useRef(isBusy);
  useEffect(() => {
    busy.current = isBusy;
  });

  const schedule = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    const run = () => {
      if (busy.current?.()) {
        timer.current = setTimeout(run, delayMs);
        return;
      }
      timer.current = null;
      void syncAfterEdits().catch(() => {});
    };
    timer.current = setTimeout(run, delayMs);
  }, [delayMs]);

  useEffect(
    () => () => {
      if (timer.current) {
        clearTimeout(timer.current);
        timer.current = null;
        void syncAfterEdits().catch(() => {});
      }
    },
    [],
  );

  return schedule;
}
