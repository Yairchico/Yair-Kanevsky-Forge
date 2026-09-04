"use client";

import { useState, useTransition } from "react";
import { setProgramStatus } from "../actions";
import { Button } from "@/components/ui/button";

/** Controlled by the parent so an in-page edit (which auto-reverts a
 * published program to draft) can flip this badge without a page refresh. */
export function PublishToggle({
  traineeId,
  programId,
  isPublished,
  onChange,
}: {
  traineeId: string;
  programId: string;
  isPublished: boolean;
  onChange: (published: boolean) => void;
}) {
  const [pending, startTransition] = useTransition();
  const [confirmUnpublish, setConfirmUnpublish] = useState(false);

  function toggle() {
    const next = !isPublished;
    startTransition(async () => {
      await setProgramStatus(traineeId, programId, next ? "published" : "draft");
      onChange(next);
      setConfirmUnpublish(false);
    });
  }

  if (isPublished) {
    return confirmUnpublish ? (
      <div className="flex items-center gap-2 text-sm">
        <span className="text-muted-foreground">להחזיר לטיוטה?</span>
        <Button size="sm" variant="destructive" onClick={toggle} disabled={pending}>
          כן
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={() => setConfirmUnpublish(false)}
        >
          ביטול
        </Button>
      </div>
    ) : (
      <Button
        size="sm"
        variant="outline"
        onClick={() => setConfirmUnpublish(true)}
      >
        החזר לטיוטה
      </Button>
    );
  }

  return (
    <Button size="sm" onClick={toggle} disabled={pending}>
      {pending ? "מפרסם…" : "פרסם תוכנית"}
    </Button>
  );
}
