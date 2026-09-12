"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { Eye, Pencil, Trash2 } from "lucide-react";
import { deleteProgram } from "./programs/actions";
import { cn } from "@/lib/utils";
import { formatWeekLabel, formatWeekRange, parseDateKey } from "@/lib/week";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";

interface Program {
  id: string;
  title: string;
  status: "draft" | "published";
  week_start_date: string;
}

/**
 * The whole row is a Link to the builder — that's the "edit" action, and
 * always has been — but a bare row like that reads as informational, not
 * clickable, so it carries an explicit pencil icon as a visual cue. A
 * separate quick-delete affordance sits next to it, gated behind a
 * confirmation Modal (not an inline replace-the-button state) — deleteProgram
 * existed as a server action but nothing in the UI called it until now.
 *
 * deleteProgram is a soft-delete (migration 0010): the program disappears
 * from this list, but its workout history/submissions are NOT destroyed.
 * The confirm step says so explicitly, since "מחק לצמיתות" (permanently
 * delete) used to be literally true here and no longer is.
 */
export function ProgramRow({
  traineeId,
  program,
  readOnly = false,
}: {
  traineeId: string;
  program: Program;
  /** The read-only superadmin viewer (migration 0011) can still open the builder to look, just not delete. */
  readOnly?: boolean;
}) {
  const [confirming, setConfirming] = useState(false);
  const [pending, startTransition] = useTransition();
  const weekStart = parseDateKey(program.week_start_date);

  function handleDelete() {
    startTransition(async () => {
      await deleteProgram(traineeId, program.id);
      setConfirming(false);
    });
  }

  return (
    <div className="flex items-center gap-1 rounded-md border border-border text-sm">
      <Link
        href={`/trainer/trainees/${traineeId}/programs/${program.id}`}
        className="flex min-w-0 flex-1 items-center justify-between gap-2 p-3 transition-colors hover:bg-muted"
      >
        <div className="min-w-0">
          <p className="truncate font-medium">{program.title}</p>
          <p className="text-xs text-muted-foreground">
            {formatWeekLabel(weekStart)} · {formatWeekRange(weekStart)}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <span
            className={cn(
              "rounded-full px-2 py-0.5 text-xs font-medium",
              program.status === "published"
                ? "bg-success/15 text-success"
                : "bg-warning/20 text-warning-foreground",
            )}
          >
            {program.status === "published" ? "פורסם" : "טיוטה"}
          </span>
          {readOnly ? (
            <Eye className="h-3.5 w-3.5 text-muted-foreground" />
          ) : (
            <Pencil className="h-3.5 w-3.5 text-muted-foreground" />
          )}
        </div>
      </Link>

      {!readOnly && (
        <button
          type="button"
          onClick={() => setConfirming(true)}
          aria-label={`הסר את ${program.title}`}
          className="me-2 flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
        >
          <Trash2 className="h-4 w-4" />
        </button>
      )}

      <Modal open={confirming} onClose={() => setConfirming(false)} title="הסרת תוכנית">
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">
            האם אתה בטוח שברצונך להסיר את &quot;{program.title}&quot;? התוכנית
            תוסר מהרשימה. היסטוריית האימונים וההגשות שנשמרה תישאר במערכת, אך
            אי אפשר לשחזר את התוכנית עצמה מכאן.
          </p>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => setConfirming(false)}>
              ביטול
            </Button>
            <Button type="button" variant="destructive" onClick={handleDelete} disabled={pending}>
              {pending ? "מסיר…" : "כן, הסר"}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
