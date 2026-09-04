"use client";

import { useActionState, useState } from "react";
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
  };
}) {
  const updateAction = updateTrainee.bind(null, trainee.id);
  const resetAction = resetTraineePassword.bind(null, trainee.id);

  const [state, formAction, pending] = useActionState(updateAction, initialState);
  const [resetState, resetFormAction, resetPending] = useActionState(
    resetAction,
    initialState,
  );
  const [newPassword, setNewPassword] = useState("");
  const [resetOpen, setResetOpen] = useState(false);

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

      <div className="border-t border-border pt-4">
        {!resetOpen ? (
          <Button type="button" variant="outline" onClick={() => setResetOpen(true)}>
            איפוס סיסמה
          </Button>
        ) : (
          <form action={resetFormAction} className="space-y-2">
            <Label htmlFor="new_password">סיסמה חדשה</Label>
            <div className="flex gap-2">
              <Input
                id="new_password"
                name="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                minLength={6}
                required
                className="flex-1"
              />
              <Button type="submit" variant="outline" disabled={resetPending}>
                {resetPending ? "מאפס…" : "אפס"}
              </Button>
            </div>
            {resetState.error && (
              <p className="text-sm text-destructive">{resetState.error}</p>
            )}
            {resetState.success && (
              <p className="text-sm text-success">הסיסמה אופסה בהצלחה</p>
            )}
          </form>
        )}
      </div>
    </div>
  );
}
