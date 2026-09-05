"use client";

import { useActionState, useState } from "react";
import Link from "next/link";
import { createProgram, type ActionState } from "../actions";
import { AppShell } from "@/components/app-shell";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { addDays, formatWeekLabel, formatWeekRange, getWeekStart, toDateKey } from "@/lib/week";
import { cn } from "@/lib/utils";

const initialState: ActionState = {};

const today = new Date();
const currentWeekStart = getWeekStart(today);
const weekOptions = [0, 1, 2].map((offset) => {
  const start = addDays(currentWeekStart, offset * 7);
  return {
    key: toDateKey(start),
    label: formatWeekLabel(start, today),
    range: formatWeekRange(start),
  };
});

export function NewProgramForm({
  traineeId,
  traineeName,
}: {
  traineeId: string;
  traineeName: string;
}) {
  const action = createProgram.bind(null, traineeId);
  const [state, formAction, pending] = useActionState(action, initialState);
  const [week, setWeek] = useState(weekOptions[0].key);

  return (
    <AppShell title="תוכנית חדשה" backHref={`/trainer/trainees/${traineeId}`}>
      <div className="mx-auto w-full max-w-lg">
        <Card>
          <CardHeader>
            <CardTitle>תוכנית חדשה עבור {traineeName}</CardTitle>
            <CardDescription>
              תוכנית תמיד שייכת לשבוע קלנדרי מסוים. תוכל להוסיף אימונים
              ולפרסם כשמוכן — המתאמן לא יראה אותה לפני כן.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form action={formAction} className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="title">שם התוכנית</Label>
                <Input
                  id="title"
                  name="title"
                  required
                  placeholder='למשל: "מחזור כוח - ספטמבר"'
                />
              </div>

              <div className="space-y-1.5">
                <Label>שבוע</Label>
                <input type="hidden" name="week_start_date" value={week} />
                <div className="grid gap-2">
                  {weekOptions.map((opt) => (
                    <button
                      key={opt.key}
                      type="button"
                      onClick={() => setWeek(opt.key)}
                      className={cn(
                        "flex items-center justify-between rounded-lg border p-3 text-start transition-colors",
                        week === opt.key
                          ? "border-primary bg-primary/5"
                          : "border-border hover:bg-muted",
                      )}
                    >
                      <span className="font-medium">{opt.label}</span>
                      <span className="text-sm text-muted-foreground">
                        {opt.range}
                      </span>
                    </button>
                  ))}
                </div>
              </div>

              {state.error && (
                <p className="text-sm text-destructive">{state.error}</p>
              )}

              <div className="flex gap-2">
                <Button type="submit" disabled={pending}>
                  {pending ? "יוצר…" : "צור תוכנית"}
                </Button>
                <Link
                  href={`/trainer/trainees/${traineeId}`}
                  className={buttonVariants({ variant: "outline" })}
                >
                  ביטול
                </Link>
              </div>
            </form>
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}
