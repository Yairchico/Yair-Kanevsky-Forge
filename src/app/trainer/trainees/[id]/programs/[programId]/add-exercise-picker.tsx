"use client";

import { useActionState, useMemo, useState } from "react";
import { Plus } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { getExerciseImage } from "@/lib/exercise-image";
import { ExercisePhoto } from "@/components/exercise-photo";
import { MUSCLE_GROUPS } from "@/lib/exercise-constants";
import { createExerciseInline, type CreateExerciseInlineState } from "../../../../exercises/actions";

interface Exercise {
  id: string;
  name: string;
  muscle_group: string | null;
  equipment: string | null;
  media_url?: string | null;
}

type NewExercise = NonNullable<CreateExerciseInlineState["exercise"]>;

const initialCreateState: CreateExerciseInlineState = {};

/**
 * Shown when a search finds nothing — creates the exercise right here
 * (name/muscle group/equipment/instructions/image) instead of sending the
 * trainer to the separate /trainer/exercises/new page, and adds it
 * straight into the current workout on success.
 */
function InlineCreateExercise({
  initialName,
  onCreated,
  onCancel,
}: {
  initialName: string;
  onCreated: (exercise: NonNullable<CreateExerciseInlineState["exercise"]>) => void;
  onCancel: () => void;
}) {
  const [state, formAction, pending] = useActionState(createExerciseInline, initialCreateState);

  const [prevState, setPrevState] = useState(state);
  if (state !== prevState) {
    setPrevState(state);
    if (state.exercise) onCreated(state.exercise);
  }

  return (
    <form action={formAction} className="space-y-2 rounded-lg border border-dashed border-primary/40 bg-primary/5 p-3">
      <div className="space-y-1">
        <Label htmlFor="new-exercise-name" className="text-xs">שם תרגיל</Label>
        <Input id="new-exercise-name" name="name" required defaultValue={initialName} className="h-9 text-sm" />
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div className="space-y-1">
          <Label htmlFor="new-exercise-muscle" className="text-xs">קבוצת שריר</Label>
          <Select id="new-exercise-muscle" name="muscle_group" className="h-9 text-sm" defaultValue="">
            <option value="">—</option>
            {MUSCLE_GROUPS.map((g) => (
              <option key={g} value={g}>{g}</option>
            ))}
          </Select>
        </div>
        <div className="space-y-1">
          <Label htmlFor="new-exercise-equipment" className="text-xs">ציוד</Label>
          <Input id="new-exercise-equipment" name="equipment" className="h-9 text-sm" />
        </div>
      </div>
      <div className="space-y-1">
        <Label htmlFor="new-exercise-instructions" className="text-xs">הנחיות (אופציונלי)</Label>
        <Textarea id="new-exercise-instructions" name="instructions" className="min-h-14 text-sm" />
      </div>
      <div className="space-y-1">
        <Label className="text-xs">תמונה (אופציונלי)</Label>
        <input
          type="file"
          name="image_file"
          accept="image/*"
          className="block w-full text-xs text-muted-foreground file:me-2 file:rounded-md file:border-0 file:bg-secondary file:px-2 file:py-1 file:text-xs file:text-secondary-foreground"
        />
        <p className="text-center text-[10px] text-muted-foreground">או</p>
        <Input name="media_url" placeholder="קישור לתמונה" className="h-8 text-xs" />
      </div>
      {state.error && <p className="text-xs text-destructive">{state.error}</p>}
      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={pending}>
          {pending ? "יוצר…" : "צור והוסף לאימון"}
        </Button>
        <Button type="button" size="sm" variant="outline" onClick={onCancel}>
          ביטול
        </Button>
      </div>
    </form>
  );
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
  onAdd: (exerciseId: string, newExercise?: NewExercise) => void;
}) {
  const [q, setQ] = useState("");
  const [creating, setCreating] = useState(false);

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
          onChange={(e) => {
            setQ(e.target.value);
            setCreating(false);
          }}
          placeholder="חיפוש תרגיל…"
        />

        {creating ? (
          <InlineCreateExercise
            initialName={q}
            onCancel={() => setCreating(false)}
            onCreated={(exercise) => {
              setCreating(false);
              setQ("");
              onAdd(exercise.id, exercise);
            }}
          />
        ) : (
          <div className="space-y-1">
            {filtered.length === 0 ? (
              <div className="space-y-2 text-center">
                <p className="text-sm text-muted-foreground">לא נמצאו תרגילים.</p>
                <button
                  type="button"
                  onClick={() => setCreating(true)}
                  className="inline-flex items-center gap-1 rounded-full bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90"
                >
                  <Plus className="h-3.5 w-3.5" />
                  הוספת תרגיל
                </button>
              </div>
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
        )}
      </CardContent>
    </Card>
  );
}
