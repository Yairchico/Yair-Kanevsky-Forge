"use client";

import { useMemo, useState } from "react";
import { Plus } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { getExerciseImage } from "@/lib/exercise-image";
import { ExercisePhoto } from "@/components/exercise-photo";

interface Exercise {
  id: string;
  name: string;
  muscle_group: string | null;
  equipment: string | null;
  media_url?: string | null;
}

/**
 * Purely local filtering (the whole exercise catalog is already in
 * memory) and the add itself is just a callback — no server round trip
 * blocks anything here, so this stays instant regardless of network
 * latency. No inner scroll container either: it flows with the page like
 * everything else, so mobile scrolling isn't fighting a nested scroll box.
 */
export function AddExercisePicker({
  exercises,
  onAdd,
}: {
  exercises: Exercise[];
  onAdd: (exerciseId: string) => void;
}) {
  const [q, setQ] = useState("");

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
        <div className="space-y-1">
          {filtered.length === 0 ? (
            <p className="text-sm text-muted-foreground">לא נמצאו תרגילים.</p>
          ) : (
            filtered.map((ex) => (
              // A <div> (not a <button>) since the thumbnail inside is its
              // own click target (enlarge) — a button can't nest a button.
              <div
                key={ex.id}
                role="button"
                tabIndex={0}
                onClick={() => onAdd(ex.id)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") onAdd(ex.id);
                }}
                className="flex w-full cursor-pointer items-center gap-2 rounded-md p-2 text-start transition-colors hover:bg-muted"
              >
                <span onClick={(e) => e.stopPropagation()}>
                  <ExercisePhoto
                    src={getExerciseImage(ex)}
                    className="h-9 w-9 rounded-md bg-primary/10"
                  />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{ex.name}</p>
                  {ex.muscle_group && (
                    <p className="text-xs text-muted-foreground">
                      {ex.muscle_group}
                    </p>
                  )}
                </div>
                <Plus className="h-4 w-4 shrink-0 text-muted-foreground" />
              </div>
            ))
          )}
        </div>
      </CardContent>
    </Card>
  );
}
