"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import { addExerciseToDay } from "./actions";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

interface Exercise {
  id: string;
  name: string;
  muscle_group: string | null;
  equipment: string | null;
}

export function AddExercisePicker({
  traineeId,
  programId,
  programDayId,
  exercises,
}: {
  traineeId: string;
  programId: string;
  programDayId: string;
  exercises: Exercise[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [q, setQ] = useState("");
  const [addingId, setAddingId] = useState<string | null>(null);

  const filtered = useMemo(() => {
    if (!q.trim()) return exercises.slice(0, 20);
    const needle = q.trim().toLowerCase();
    return exercises
      .filter(
        (e) =>
          e.name.toLowerCase().includes(needle) ||
          e.muscle_group?.toLowerCase().includes(needle),
      )
      .slice(0, 20);
  }, [q, exercises]);

  function add(exerciseId: string) {
    setAddingId(exerciseId);
    startTransition(async () => {
      await addExerciseToDay(traineeId, programId, programDayId, exerciseId);
      setAddingId(null);
      router.refresh();
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">ספריית תרגילים</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <Input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="חיפוש תרגיל…"
        />
        <div className="max-h-80 space-y-1 overflow-y-auto">
          {filtered.length === 0 ? (
            <p className="text-sm text-muted-foreground">לא נמצאו תרגילים.</p>
          ) : (
            filtered.map((ex) => (
              <div
                key={ex.id}
                className="flex items-center justify-between gap-2 rounded-md p-2 hover:bg-muted"
              >
                <div>
                  <p className="text-sm font-medium">{ex.name}</p>
                  {ex.muscle_group && (
                    <p className="text-xs text-muted-foreground">
                      {ex.muscle_group}
                    </p>
                  )}
                </div>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={pending && addingId === ex.id}
                  onClick={() => add(ex.id)}
                  aria-label={`הוסף ${ex.name}`}
                >
                  <Plus className="h-4 w-4" />
                </Button>
              </div>
            ))
          )}
        </div>
      </CardContent>
    </Card>
  );
}
