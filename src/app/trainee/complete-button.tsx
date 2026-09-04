"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check } from "lucide-react";
import { toggleWorkoutCompletion } from "./actions";
import { Button } from "@/components/ui/button";

export function CompleteButton({
  workoutId,
  completed,
}: {
  workoutId: string;
  completed: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function toggle() {
    startTransition(async () => {
      await toggleWorkoutCompletion(workoutId, !completed);
      router.refresh();
    });
  }

  return (
    <Button
      type="button"
      variant={completed ? "default" : "outline"}
      onClick={toggle}
      disabled={pending}
      className="w-full"
    >
      <Check className="h-4 w-4" />
      {completed ? "בוצע ✓" : "סמן כבוצע"}
    </Button>
  );
}
