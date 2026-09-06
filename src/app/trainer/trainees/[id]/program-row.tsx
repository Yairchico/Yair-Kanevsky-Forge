"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { Pencil, Trash2 } from "lucide-react";
import { deleteProgram } from "./programs/actions";
import { cn } from "@/lib/utils";
import { formatWeekLabel, formatWeekRange, parseDateKey } from "@/lib/week";

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
 * separate quick-delete affordance sits next to it (its own confirm step,
 * not a full page navigation) — deleteProgram existed as a server action
 * but nothing in the UI called it until now.
 */
export function ProgramRow({ traineeId, program }: { traineeId: string; program: Program }) {
  const [confirming, setConfirming] = useState(false);
  const [pending, startTransition] = useTransition();
  const weekStart = parseDateKey(program.week_start_date);

  function handleDelete() {
    startTransition(async () => {
      await deleteProgram(traineeId, program.id);
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
          <Pencil className="h-3.5 w-3.5 text-muted-foreground" />
        </div>
      </Link>

      {confirming ? (
        <div className="flex shrink-0 items-center gap-1 pe-2">
          <button
            type="button"
            onClick={handleDelete}
            disabled={pending}
            className="rounded-md px-2 py-1 text-xs font-medium text-destructive hover:bg-destructive/10"
          >
            {pending ? "מוחק…" : "מחק לצמיתות"}
          </button>
          <button
            type="button"
            onClick={() => setConfirming(false)}
            className="rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-muted"
          >
            ביטול
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setConfirming(true)}
          aria-label={`מחק את ${program.title}`}
          className="me-2 flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
        >
          <Trash2 className="h-4 w-4" />
        </button>
      )}
    </div>
  );
}
