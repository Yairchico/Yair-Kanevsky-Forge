"use client";

import { useActionState } from "react";
import Link from "next/link";
import { createExercise, type CreateExerciseState } from "../actions";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { MUSCLE_GROUPS } from "@/lib/exercise-constants";

const initialState: CreateExerciseState = {};

export default function NewExercisePage() {
  const [state, formAction, pending] = useActionState(createExercise, initialState);

  return (
    <main className="mx-auto w-full max-w-lg p-4 sm:p-6">
      <Card>
        <CardHeader>
          <CardTitle>תרגיל חדש</CardTitle>
          <CardDescription>יתווסף לספריית התרגילים המשותפת.</CardDescription>
        </CardHeader>
        <CardContent>
          <form action={formAction} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="name">שם התרגיל</Label>
              <Input id="name" name="name" required />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="muscle_group">קבוצת שרירים</Label>
              <Select id="muscle_group" name="muscle_group" defaultValue="">
                <option value="" disabled>
                  בחר…
                </option>
                {MUSCLE_GROUPS.map((g) => (
                  <option key={g} value={g}>
                    {g}
                  </option>
                ))}
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="equipment">ציוד (אופציונלי)</Label>
              <Input id="equipment" name="equipment" placeholder="למשל: מוט, משקולות, מכונה" />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="instructions">הנחיות (אופציונלי)</Label>
              <Textarea id="instructions" name="instructions" />
            </div>

            {state.error && (
              <p className="text-sm text-destructive">{state.error}</p>
            )}

            <div className="flex gap-2">
              <Button type="submit" disabled={pending}>
                {pending ? "שומר…" : "שמור תרגיל"}
              </Button>
              <Link
                href="/trainer/exercises"
                className={buttonVariants({ variant: "outline" })}
              >
                ביטול
              </Link>
            </div>
          </form>
        </CardContent>
      </Card>
    </main>
  );
}
