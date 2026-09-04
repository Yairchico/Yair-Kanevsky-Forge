"use client";

import { useActionState } from "react";
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

const initialState: ActionState = {};

export function NewProgramForm({
  traineeId,
  traineeName,
}: {
  traineeId: string;
  traineeName: string;
}) {
  const action = createProgram.bind(null, traineeId);
  const [state, formAction, pending] = useActionState(action, initialState);

  return (
    <AppShell title="תוכנית חדשה" backHref={`/trainer/trainees/${traineeId}`}>
      <div className="mx-auto w-full max-w-lg">
        <Card>
          <CardHeader>
            <CardTitle>תוכנית חדשה עבור {traineeName}</CardTitle>
            <CardDescription>
              תיווצר תוכנית שבועית (7 ימים) במצב טיוטה. תוכל להוסיף תרגילים
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
