"use server";

import { revalidatePath } from "next/cache";

/**
 * The revalidation that belongs to a burst of small saves (confirming /
 * un-confirming sets; editing rows in the program builder), done once for
 * the burst instead of once per save.
 *
 * Why it is separate: in a Server Action, revalidatePath makes Next.js
 * re-render the page the user is on inside that same request, and Server
 * Actions run one at a time — so when every ✓ revalidated, every ✓ waited
 * for a full reload of the workout page's data, and the next ✓ waited
 * behind it. Those actions therefore return right after the write (the
 * screen already shows the result — src/lib/use-set-entry.ts, the exercise
 * editor), and the screen calls this a moment after the last one
 * (src/lib/use-deferred-sync.ts). What it does is what those actions used
 * to do each time: the current page gets its fresh server copy, and every
 * page visited before is re-fetched when it's navigated to again.
 *
 * The other person's browser never depended on it: every page here is
 * rendered per request, so the trainer (or the trainee) sees the change
 * the next time they open or refresh a page either way.
 *
 * It changes no data, so it needs no permission check.
 */
export async function syncAfterEdits(): Promise<void> {
  revalidatePath("/", "layout");
}
