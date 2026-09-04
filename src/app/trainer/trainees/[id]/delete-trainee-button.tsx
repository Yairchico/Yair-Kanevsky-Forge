"use client";

import { useState, useTransition } from "react";
import { deleteTrainee } from "../actions";
import { Button } from "@/components/ui/button";

export function DeleteTraineeButton({
  traineeId,
  traineeName,
}: {
  traineeId: string;
  traineeName: string;
}) {
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [pending, startTransition] = useTransition();

  if (!confirming) {
    return (
      <Button type="button" variant="destructive" onClick={() => setConfirming(true)}>
        מחיקת מתאמן
      </Button>
    );
  }

  function handleDelete() {
    startTransition(async () => {
      const result = await deleteTrainee(traineeId);
      if (result?.error) setError(result.error);
    });
  }

  return (
    <div className="flex flex-wrap items-center gap-3">
      <p className="text-sm text-destructive">
        למחוק לצמיתות את &quot;{traineeName}&quot;? כל התוכניות וההיסטוריה
        שלו יימחקו גם כן. לא ניתן לבטל.
      </p>
      <div className="flex gap-2">
        <Button
          type="button"
          variant="destructive"
          onClick={handleDelete}
          disabled={pending}
        >
          {pending ? "מוחק…" : "כן, למחוק"}
        </Button>
        <Button type="button" variant="outline" onClick={() => setConfirming(false)}>
          ביטול
        </Button>
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}
    </div>
  );
}
