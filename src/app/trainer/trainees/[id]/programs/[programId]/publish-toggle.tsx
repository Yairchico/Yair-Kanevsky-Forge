"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { setProgramStatus } from "../actions";
import { Button } from "@/components/ui/button";

export function PublishToggle({
  traineeId,
  programId,
  isPublished,
}: {
  traineeId: string;
  programId: string;
  isPublished: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [confirmUnpublish, setConfirmUnpublish] = useState(false);

  function toggle() {
    startTransition(async () => {
      await setProgramStatus(
        traineeId,
        programId,
        isPublished ? "draft" : "published",
      );
      setConfirmUnpublish(false);
      router.refresh();
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
