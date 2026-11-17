/**
 * What a page shows while its data is on the way (every loading.tsx): the
 * outline of the app shell — header, then a few cards — pulsing gently.
 * Shown at once on navigation, so a tap always gets an immediate answer
 * even when the data takes a moment. Deliberately generic: it only has to
 * say "the page is coming", not predict each screen's exact layout.
 */
export function PageSkeleton() {
  return (
    <div className="flex min-h-full flex-1 flex-col" role="status" aria-label="טוען">
      <div className="flex items-center justify-between border-b border-border bg-card px-4 py-3 sm:px-6">
        <div className="flex items-center gap-3">
          <div className="h-11 w-11 animate-pulse rounded-full bg-secondary" />
          <div className="space-y-2">
            <div className="h-3 w-28 animate-pulse rounded bg-secondary" />
            <div className="h-2.5 w-20 animate-pulse rounded bg-secondary" />
          </div>
        </div>
        <div className="h-9 w-20 animate-pulse rounded-lg bg-secondary" />
      </div>
      <div className="flex flex-1 flex-col gap-4 p-4 sm:p-6">
        {[0, 1, 2].map((i) => (
          <div key={i} className="space-y-3 rounded-xl border border-border bg-card p-5">
            <div className="h-4 w-2/5 animate-pulse rounded bg-secondary" />
            <div className="h-3 w-4/5 animate-pulse rounded bg-secondary" />
            <div className="h-3 w-3/5 animate-pulse rounded bg-secondary" />
          </div>
        ))}
      </div>
    </div>
  );
}
