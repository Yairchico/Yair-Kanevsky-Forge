"use client";

import { useActionState, useMemo, useState, useTransition } from "react";
import { Pencil, SearchX, Trash2 } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SearchInput } from "@/components/ui/search-input";
import { MUSCLE_GROUPS } from "@/lib/exercise-constants";
import { getExerciseImage } from "@/lib/exercise-image";
import { ExercisePhoto } from "@/components/exercise-photo";
import { cn } from "@/lib/utils";
import { deleteExercise, updateExerciseImage, type UpdateExerciseImageState } from "./actions";

interface Exercise {
  id: string;
  name: string;
  muscle_group: string | null;
  equipment: string | null;
  is_custom: boolean;
  media_url: string | null;
}

const initialImageState: UpdateExerciseImageState = {};

/**
 * Every exercise has a picture (a real default photo — see
 * src/lib/exercise-image.ts), and the only thing a trainer can edit on an
 * existing exercise is that image: upload a file, or paste a URL (the
 * upload wins if both are given). Collapsed behind a small "ערוך תמונה"
 * toggle so the grid stays scannable.
 */
function ExerciseImageEditor({ exercise }: { exercise: Exercise }) {
  const [editing, setEditing] = useState(false);
  const action = updateExerciseImage.bind(null, exercise.id);
  const [state, formAction, pending] = useActionState(action, initialImageState);

  const [prevState, setPrevState] = useState(state);
  if (state !== prevState) {
    setPrevState(state);
    if (state.success && editing) setEditing(false);
  }

  if (!editing) {
    return (
      <button
        type="button"
        onClick={() => setEditing(true)}
        className="mt-1.5 flex items-center gap-1 text-xs text-muted-foreground hover:text-primary"
      >
        <Pencil className="h-3 w-3" />
        ערוך תמונה
      </button>
    );
  }

  return (
    <form action={formAction} className="mt-1.5 space-y-1.5">
      <input
        type="file"
        name="image_file"
        accept="image/*"
        className="block w-full text-xs text-muted-foreground file:me-2 file:rounded-md file:border-0 file:bg-secondary file:px-2 file:py-1 file:text-xs file:text-secondary-foreground"
      />
      <p className="text-center text-[10px] text-muted-foreground">או</p>
      <Input
        name="media_url"
        defaultValue={exercise.media_url ?? ""}
        placeholder="קישור לתמונה (ניתן להשאיר ריק)"
        className="h-8 text-xs"
      />
      {state.error && <p className="text-xs text-destructive">{state.error}</p>}
      <div className="flex gap-1.5">
        <Button type="submit" size="sm" disabled={pending}>
          {pending ? "שומר…" : "שמור"}
        </Button>
        <Button type="button" size="sm" variant="outline" onClick={() => setEditing(false)}>
          ביטול
        </Button>
      </div>
    </form>
  );
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

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return exercises.filter((e) => {
      if (group && e.muscle_group !== group) return false;
      if (needle && !e.name.toLowerCase().includes(needle)) return false;
      return true;
    });
  }, [exercises, q, group]);

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
            <Card key={ex.id} className="transition-shadow hover:shadow-sm">
              <CardContent className="flex items-start gap-3 p-4">
                <ExercisePhoto
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
                    <div className="flex flex-wrap items-center gap-3">
                      <ExerciseImageEditor exercise={ex} />
                      <DeleteExerciseButton exercise={ex} />
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
