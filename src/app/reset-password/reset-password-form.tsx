"use client";

import { useActionState, useState } from "react";
import Link from "next/link";
import { Eye, EyeOff } from "lucide-react";
import { updatePassword, type UpdatePasswordState } from "./actions";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

const initialState: UpdatePasswordState = {};

export function ResetPasswordForm() {
  const [state, formAction, pending] = useActionState(updatePassword, initialState);
  const [showPassword, setShowPassword] = useState(false);

  if (state.success) {
    return (
      <div className="space-y-4 text-center">
        <p className="text-sm text-success">הסיסמה עודכנה בהצלחה.</p>
        <Link href="/" className={cn(buttonVariants(), "w-full")}>
          המשך
        </Link>
      </div>
    );
  }

  return (
    <form action={formAction} className="space-y-4">
      <div className="space-y-1.5">
        <Label htmlFor="password">סיסמה חדשה</Label>
        <div className="relative">
          <Input
            id="password"
            name="password"
            type={showPassword ? "text" : "password"}
            required
            minLength={6}
            autoComplete="new-password"
            className="pe-10"
          />
          <button
            type="button"
            onClick={() => setShowPassword((v) => !v)}
            className="absolute inset-y-0 end-0 flex items-center px-3 text-muted-foreground hover:text-foreground"
            aria-label={showPassword ? "הסתר סיסמה" : "הצג סיסמה"}
            tabIndex={-1}
          >
            {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
          </button>
        </div>
      </div>

      {state.error && <p className="text-sm text-destructive">{state.error}</p>}

      <Button type="submit" className="w-full" disabled={pending}>
        {pending ? "מעדכן…" : "עדכן סיסמה"}
      </Button>
    </form>
  );
}
