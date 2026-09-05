"use client";

import { useActionState, useState, useTransition } from "react";
import {
  updateTrainee,
  resetTraineePassword,
  type ActionState,
} from "../actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const initialState: ActionState = {};

export function TraineeEditForm({
  trainee,
}: {
  trainee: {
    id: string;
    full_name: string;
    username: string;
    phone: string | null;
    email: string | null;
  };
}) {
  const updateAction = updateTrainee.bind(null, trainee.id);
  const [state, formAction, pending] = useActionState(updateAction, initialState);

  const [resetState, setResetState] = useState<ActionState>({});
  const [resetPending, startReset] = useTransition();

  function sendResetEmail() {
    setResetState({});
    startReset(async () => {
      const result = await resetTraineePassword(trainee.id);
      setResetState(result);
    });
  }

  const isPlaceholderEmail = !trainee.email || trainee.email.endsWith("@trainees.local");

  return (
    <div className="space-y-6">
      <form action={formAction} className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="full_name">שם מלא</Label>
          <Input
            id="full_name"
            name="full_name"
            defaultValue={trainee.full_name}
            required
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="username">שם משתמש</Label>
          <Input
            id="username"
            name="username"
            defaultValue={trainee.username}
            required
            pattern="[a-z0-9_.]{3,32}"
            onChange={(e) => {
              e.target.value = e.target.value.toLowerCase();
            }}
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="email">אימייל</Label>
          <Input
            id="email"
            name="email"
            type="email"
            defaultValue={isPlaceholderEmail ? "" : (trainee.email ?? "")}
            placeholder="נדרש כדי לשלוח מייל איפוס סיסמה"
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="phone">טלפון</Label>
          <Input
            id="phone"
            name="phone"
            type="tel"
            defaultValue={trainee.phone ?? ""}
          />
        </div>

        {state.error && <p className="text-sm text-destructive">{state.error}</p>}
        {state.success && (
          <p className="text-sm text-success">הפרטים נשמרו בהצלחה</p>
        )}

        <Button type="submit" disabled={pending}>
          {pending ? "שומר…" : "שמור שינויים"}
        </Button>
      </form>

      <div className="space-y-2 border-t border-border pt-4">
        <Button type="button" variant="outline" onClick={sendResetEmail} disabled={resetPending}>
          {resetPending ? "שולח מייל…" : "שלח מייל איפוס סיסמה"}
        </Button>
        {resetState.error && (
          <p className="text-sm text-destructive">{resetState.error}</p>
        )}
        {resetState.success && (
          <p className="text-sm text-success">מייל איפוס סיסמה נשלח לכתובת {trainee.email}</p>
        )}
      </div>
    </div>
  );
}
