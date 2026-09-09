"use client";

import { useMemo, useState, useTransition } from "react";
import { SearchX, Trash2 } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { SearchInput } from "@/components/ui/search-input";
import { MUSCLE_GROUPS } from "@/lib/exercise-constants";
import { getExerciseImage } from "@/lib/exercise-image";
import { ExerciseThumbnail } from "@/components/exercise-photo";
import { cn } from "@/lib/utils";
import { deleteExercise } from "./actions";
import { ExerciseDetailModal } from "./exercise-detail-modal";

interface Exercise {
  id: string;
  name: string;
  muscle_group: string | null;
  equipment: string | null;
  is_custom: boolean;
  media_url: string | null;
}

/** Inline confirm, not a full dialog — deleting one exercise from a list is routine. */
function DeleteExerciseButton({ exercise }: { exercise: Exercise }) {
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [pending, startTransition] = useTransition();

  function handleDelete() {
    startTransition(async () => {
      const result = await deleteExercise(exercise.id);
      if (result.error) {
        setError(result.error);
        setConfirming(false);
      }
    });
  }

  if (confirming) {
    return (
      <div className="mt-1.5 flex items-center gap-1.5 text-xs">
        <span className="text-muted-foreground">למחוק?</span>
        <button
          type="button"
          onClick={handleDelete}
          disabled={pending}
          className="font-medium text-destructive hover:underline"
        >
          {pending ? "מוחק…" : "כן"}
        </button>
        <button
          type="button"
          onClick={() => setConfirming(false)}
          className="text-muted-foreground hover:underline"
        >
          לא
        </button>
      </div>
    );
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setConfirming(true)}
        className="mt-1.5 flex items-center gap-1 text-xs text-muted-foreground hover:text-destructive"
      >
        <Trash2 className="h-3 w-3" />
        מחק תרגיל
      </button>
      {error && <p className="mt-1 text-xs text-destructive">{error}</p>}
    </>
  );
}

/**
 * Search + category filtering entirely client-side: the whole (small)
 * exercise catalog is fetched once by the server component and handed
 * here as a prop, so every keystroke and chip click filters an in-memory
 * array — no network round trip, no debounce needed, no server-navigation
 * latency. This replaced a version that filtered via ?q=/?group= URL
 * params (a full server re-render per interaction, which felt slow).
 *
 * Clicking a card opens ExerciseDetailModal (name/muscle-group/equipment +
 * a real-size image, with their own edit controls) — "מחק תרגיל" stays a
 * quick action directly on the card, stopping propagation so it doesn't
 * also open the modal.
 */
export function ExerciseLibrary({
  exercises,
  readOnly = false,
}: {
  exercises: Exercise[];
  readOnly?: boolean;
}) {
  const [q, setQ] = useState("");
  const [group, setGroup] = useState<string | null>(null);
  const [openExerciseId, setOpenExerciseId] = useState<string | null>(null);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return exercises.filter((e) => {
      if (group && e.muscle_group !== group) return false;
      if (needle && !e.name.toLowerCase().includes(needle)) return false;
      return true;
    });
  }, [exercises, q, group]);

  // Re-derived from the (possibly just-revalidated) exercises prop rather
  // than held as its own snapshot, so an edit inside the modal is reflected
  // immediately without a stale copy of the exercise floating around.
  const openExercise = openExerciseId ? exercises.find((e) => e.id === openExerciseId) : undefined;

  return (
    <div className="space-y-4">
      <SearchInput
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="חיפוש תרגיל…"
        className="sm:max-w-xs"
      />

      <div className="flex flex-wrap gap-2">
        {["הכל", ...MUSCLE_GROUPS].map((g) => {
          const isAll = g === "הכל";
          const active = isAll ? !group : group === g;
          return (
            <button
              key={g}
              type="button"
              onClick={() => setGroup(isAll ? null : g)}
              className={cn(
                "rounded-full px-3 py-1.5 text-sm font-medium transition-colors",
                active
                  ? "bg-primary text-primary-foreground shadow-xs"
                  : "bg-secondary text-secondary-foreground hover:bg-muted",
              )}
            >
              {g}
            </button>
          );
        })}
      </div>

      {filtered.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-2 p-10 text-center text-sm text-muted-foreground">
            <SearchX className="h-8 w-8 text-muted-foreground/50" />
            לא נמצאו תרגילים תואמים.
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((ex) => (
            <Card
              key={ex.id}
              role="button"
              tabIndex={0}
              onClick={() => setOpenExerciseId(ex.id)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  setOpenExerciseId(ex.id);
                }
              }}
              className="cursor-pointer transition-shadow hover:shadow-sm"
            >
              <CardContent className="flex items-start gap-3 p-4">
                <ExerciseThumbnail
                  src={getExerciseImage(ex)}
                  className="h-14 w-14 rounded-lg bg-primary/10"
                />
                <div className="min-w-0 flex-1">
                  <div className="flex items-start justify-between gap-2">
                    <p className="truncate font-medium">{ex.name}</p>
                    {ex.is_custom && (
                      <span className="shrink-0 rounded-full bg-secondary px-2 py-0.5 text-xs whitespace-nowrap text-secondary-foreground">
                        מותאם
                      </span>
                    )}
                  </div>
                  <p className="text-sm text-muted-foreground">
                    {[ex.muscle_group, ex.equipment].filter(Boolean).join(" · ")}
                  </p>
                  {!readOnly && (
                    <div onClick={(e) => e.stopPropagation()}>
                      <DeleteExerciseButton exercise={ex} />
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {openExercise && (
        <ExerciseDetailModal
          exercise={openExercise}
          readOnly={readOnly}
          onClose={() => setOpenExerciseId(null)}
        />
      )}
    </div>
  );
}
