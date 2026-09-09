"use client";

import { PartyPopper } from "lucide-react";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { Brand } from "@/components/brand";

/**
 * The branded confirmation that pops up right when a trainee's submit
 * actually succeeds (SubmitWorkoutButton, on the false→true transition) —
 * separate from the button's own label change, which a trainee scrolled
 * past the button could easily miss.
 */
export function WorkoutSubmittedModal({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  if (!open) return null;

  return (
    <Modal open onClose={onClose} className="max-w-sm">
      <div className="flex flex-col items-center gap-3 py-2 text-center">
        <Brand />
        <PartyPopper className="h-10 w-10 text-primary" />
        <p className="text-lg font-semibold">האימון הוגש בהצלחה!</p>
        <p className="text-base text-muted-foreground">האימון נשלח למאמן.</p>
        <Button type="button" onClick={onClose} className="mt-1 w-full">
          מעולה
        </Button>
      </div>
    </Modal>
  );
}
