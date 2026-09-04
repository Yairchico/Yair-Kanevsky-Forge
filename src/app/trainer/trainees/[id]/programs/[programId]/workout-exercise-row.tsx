"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ChevronDown, ChevronUp, Copy, Trash2 } from "lucide-react";
import {
  deleteWorkoutExercise,
  duplicateWorkoutExercise,
  moveWorkoutExercise,
  updateWorkoutExercise,
  type WorkoutExerciseFields,
} from "./actions";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";

export function WorkoutExerciseRow({
  traineeId,
  programId,
  workoutId,
  id,
  index,
  count,
  exerciseName,
  muscleGroup,
  sets,
  reps,
  weight,
  rpe,
  restSeconds,
  instructions,
}: {
  traineeId: string;
  programId: string;
  workoutId: string;
  id: string;
  index: number;
  count: number;
  exerciseName: string;
  muscleGroup: string | null;
  sets: number | null;
  reps: string | null;
  weight: string | null;
  rpe: number | null;
  restSeconds: number | null;
  instructions: string | null;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [fields, setFields] = useState<WorkoutExerciseFields>({
    sets,
    reps,
    weight,
    rpe,
    rest_seconds: restSeconds,
    instructions,
  });

  function save(next: WorkoutExerciseFields) {
    startTransition(async () => {
      await updateWorkoutExercise(traineeId, programId, id, next);
      router.refresh();
    });
  }

  function move(direction: "up" | "down") {
    startTransition(async () => {
      await moveWorkoutExercise(traineeId, programId, workoutId, id, direction);
      router.refresh();
    });
  }

  function duplicate() {
    startTransition(async () => {
      await duplicateWorkoutExercise(traineeId, programId, id);
      router.refresh();
    });
  }

  function remove() {
    startTransition(async () => {
      await deleteWorkoutExercise(traineeId, programId, id);
      router.refresh();
    });
  }

  return (
    <Card className={pending ? "opacity-60" : undefined}>
      <CardContent className="space-y-3 p-4">
        <div className="flex items-start justify-between gap-2">
          <div>
            <p className="font-medium">{exerciseName}</p>
            {muscleGroup && (
              <p className="text-xs text-muted-foreground">{muscleGroup}</p>
            )}
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={index === 0}
              onClick={() => move("up")}
              aria-label="הזז למעלה"
            >
              <ChevronUp className="h-4 w-4" />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={index === count - 1}
              onClick={() => move("down")}
              aria-label="הזז למטה"
            >
              <ChevronDown className="h-4 w-4" />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={duplicate}
              aria-label="שכפל"
            >
              <Copy className="h-4 w-4" />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={remove}
              aria-label="מחק"
              className="text-destructive hover:text-destructive"
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          <div className="space-y-1">
            <Label className="text-xs">סטים</Label>
            <Input
              type="number"
              min={0}
              value={fields.sets ?? ""}
              onChange={(e) =>
                setFields((f) => ({
                  ...f,
                  sets: e.target.value === "" ? null : Number(e.target.value),
                }))
              }
              onBlur={() => save(fields)}
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">חזרות</Label>
            <Input
              value={fields.reps ?? ""}
              placeholder="8-10"
              onChange={(e) => setFields((f) => ({ ...f, reps: e.target.value }))}
              onBlur={() => save(fields)}
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">משקל</Label>
            <Input
              value={fields.weight ?? ""}
              placeholder='20 ק"ג'
              onChange={(e) => setFields((f) => ({ ...f, weight: e.target.value }))}
              onBlur={() => save(fields)}
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">RPE</Label>
            <Input
              type="number"
              min={1}
              max={10}
              step={0.5}
              value={fields.rpe ?? ""}
              onChange={(e) =>
                setFields((f) => ({
                  ...f,
                  rpe: e.target.value === "" ? null : Number(e.target.value),
                }))
              }
              onBlur={() => save(fields)}
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">מנוחה (שנ׳)</Label>
            <Input
              type="number"
              min={0}
              value={fields.rest_seconds ?? ""}
              onChange={(e) =>
                setFields((f) => ({
                  ...f,
                  rest_seconds: e.target.value === "" ? null : Number(e.target.value),
                }))
              }
              onBlur={() => save(fields)}
            />
          </div>
        </div>

        <div className="space-y-1">
          <Label className="text-xs">הנחיות</Label>
          <Input
            value={fields.instructions ?? ""}
            placeholder="הערות / הנחיות ביצוע"
            onChange={(e) =>
              setFields((f) => ({ ...f, instructions: e.target.value }))
            }
            onBlur={() => save(fields)}
          />
        </div>
      </CardContent>
    </Card>
  );
}
